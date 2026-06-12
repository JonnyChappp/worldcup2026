#!/usr/bin/env node
/* Engine tests: node tests/run-tests.js
 * Uses the real data.json + predictions/*.json, plus synthetic scenarios.
 */
const fs = require('fs');
const path = require('path');
const W = require('../brackets.js');

const root = path.join(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(root, 'data.json'), 'utf8'));
const playersIdx = JSON.parse(fs.readFileSync(path.join(root, 'predictions/players.json'), 'utf8'));
const players = playersIdx.map((f) =>
  JSON.parse(fs.readFileSync(path.join(root, 'predictions', f), 'utf8')));

let failures = 0;
function check(label, cond, extra) {
  if (cond) { console.log('  ok  ' + label); }
  else { failures++; console.log('FAIL  ' + label + (extra ? ' — ' + JSON.stringify(extra) : '')); }
}

// ---------------------------------------------------------------- helpers
function syntheticMatch(over) {
  return Object.assign({
    id: 0, stage: 'GROUP_STAGE', group: 'GROUP_A', status: 'FINISHED',
    utcDate: '2026-06-11T19:00:00Z',
    homeTeam: { tla: 'AAA', name: 'AAA', shortName: 'AAA', crest: null },
    awayTeam: { tla: 'BBB', name: 'BBB', shortName: 'BBB', crest: null },
    score: { winner: null, fullTime: { home: 0, away: 0 }, halfTime: { home: 0, away: 0 } },
  }, over);
}
function gm(g, h, a, hg, ag, status) {
  return syntheticMatch({
    group: 'GROUP_' + g,
    status: status || 'FINISHED',
    homeTeam: { tla: h, name: h, shortName: h, crest: null },
    awayTeam: { tla: a, name: a, shortName: a, crest: null },
    score: {
      winner: hg > ag ? 'HOME_TEAM' : hg < ag ? 'AWAY_TEAM' : 'DRAW',
      fullTime: { home: hg, away: ag }, halfTime: { home: 0, away: 0 },
    },
  });
}
function pipelineFor(matches) {
  const standings = W.calcStandings(matches);
  const thirds = W.rankThirds(standings);
  const actual = W.actualState(matches, standings, thirds);
  return { standings, thirds: actual.thirds, actual };
}

// ------------------------------------------------------- 1. real data load
console.log('\n[1] real data.json + player files');
check('48 teams have TLAs', Object.keys(W.teamMeta(data.matches)).length === 48);
const standings = W.calcStandings(data.matches);
check('12 groups in table', W.GROUPS.every((g) => Array.isArray(standings.table[g])));
const a = standings.table.A.map((r) => r.tla);
check('group A current order MEX,KOR,CZE,RSA (pts then GD)',
  JSON.stringify(a) === JSON.stringify(['MEX', 'KOR', 'CZE', 'RSA']), a);
check('no group complete yet', !standings.allComplete);

for (const p of players) {
  const pred = W.predictedSlots(p);
  check(p.name + ': predictions align with official bracket (0 problems)',
    pred.problems.length === 0, pred.problems);
  const filled = Object.values(pred.slots).filter((s) => s.home && s.away && s.winner);
  check(p.name + ': all 31 slots resolved', filled.length === 31, filled.length);
  check(p.name + ': final winner matches champion field',
    pred.slots[537390].winner === p.champion);
}

const all = W.computeAll(data, players);
for (const row of all.rows) {
  const s = row.score;
  check(row.player.name + ': locked <= projected <= max within bounds',
    s.locked <= s.projected && s.locked <= s.max && s.max <= 161,
    { locked: s.locked, projected: s.projected, max: s.max });
}
check('max possible is 161 while nothing is decided',
  all.rows.every((r) => r.score.max === 161),
  all.rows.map((r) => r.score.max));
check('no broken players from real files', all.broken.length === 0, all.broken);
check('ranks assigned starting at 1', all.rows[0].rank === 1);

// --------------------------------------------- 2. completed-group scoring
console.log('\n[2] synthetic completed group');
const mA = [
  gm('A', 'W1', 'W2', 2, 0), gm('A', 'W1', 'W3', 2, 0), gm('A', 'W1', 'W4', 2, 0),
  gm('A', 'W2', 'W3', 2, 0), gm('A', 'W2', 'W4', 2, 0), gm('A', 'W3', 'W4', 2, 0),
];
{
  const { standings: sA, thirds: tA, actual: aA } = pipelineFor(mA);
  check('group A complete', sA.complete.A === true);
  check('order W1,W2,W3,W4',
    JSON.stringify(sA.table.A.map((r) => r.tla)) === JSON.stringify(['W1', 'W2', 'W3', 'W4']));
  check('no uncertain positions (all distinct)', sA.uncertain.A.size === 0);

  const player = {
    name: 'T', groups: { A: ['W1', 'W2', 'W4', 'W3'] }, thirdPlaceQualifiers: ['W4'],
    knockout: { roundOf32: [] },
  };
  const scoreA = W.scorePlayer(player, { slots: {} }, sA, tA, aA);
  check('2 exact positions locked (W1,W2; W3/W4 swapped)',
    scoreA.cat.groups.locked === 2, scoreA.cat.groups);
  check('swapped positions are dead for max',
    scoreA.cat.groups.max === 2, scoreA.cat.groups);
  check('predicted third W4 marked miss (group done, W4 finished 4th)',
    scoreA.detail.thirds.W4.status === 'miss', scoreA.detail.thirds);
  check('4th-place team eliminated', aA.eliminated.has('W4'));
  check('3rd not eliminated while thirds undecided', !aA.eliminated.has('W3'));
}

// ------------------------------------ 3. FIFA tiebreakers, not UEFA's
console.log('\n[3] FIFA order: overall GD beats head-to-head');
// PPP beat RRR 1-0 head-to-head, but RRR has far better overall GD.
const mF = [
  gm('B', 'PPP', 'RRR', 1, 0), gm('B', 'PPP', 'SSS', 2, 0), gm('B', 'TTT', 'PPP', 1, 0),
  gm('B', 'RRR', 'TTT', 4, 0), gm('B', 'RRR', 'SSS', 4, 0), gm('B', 'SSS', 'TTT', 0, 0),
];
{
  const { standings: sF } = pipelineFor(mF);
  const ord = sF.table.B.map((r) => r.tla);
  check('RRR above PPP on overall GD despite losing the h2h',
    ord[0] === 'RRR' && ord[1] === 'PPP', ord);
}
// Circular 3-way tie where overall pts/GD/GF are IDENTICAL -> h2h applies,
// and since h2h is also circularly identical, positions are uncertain.
const mC = [
  gm('C', 'XX1', 'YY1', 1, 0), gm('C', 'YY1', 'ZZ1', 1, 0), gm('C', 'ZZ1', 'XX1', 1, 0),
  gm('C', 'XX1', 'QQ1', 2, 0), gm('C', 'YY1', 'QQ1', 2, 0), gm('C', 'ZZ1', 'QQ1', 2, 0),
];
{
  const { standings: sC } = pipelineFor(mC);
  const ord = sC.table.C.map((r) => r.tla);
  check('perfect circular tie: Q last, three tied ahead', ord[3] === 'QQ1', ord);
  check('tied trio flagged uncertain (fair play / lots)',
    sC.uncertain.C.has(0) && sC.uncertain.C.has(1) && sC.uncertain.C.has(2) &&
    !sC.uncertain.C.has(3), Array.from(sC.uncertain.C));
  const player = {
    name: 'U', groups: { C: ord.slice() }, thirdPlaceQualifiers: [],
    knockout: { roundOf32: [] },
  };
  const { thirds: tC, actual: aC } = pipelineFor(mC);
  const score = W.scorePlayer(player, { slots: {} }, sC, tC, aC);
  check('uncertain positions do NOT lock (only Q locks)',
    score.cat.groups.locked === 1, score.cat.groups);
  check('uncertain positions still count toward max',
    score.cat.groups.max === 4, score.cat.groups);
  check('4th not eliminated... Q is certain 4th so eliminated',
    aC.eliminated.has('QQ1'));
  check('tied teams not eliminated', !aC.eliminated.has('XX1'));
}

// --------------------------------------------------- 4. knockout scoring
console.log('\n[4] synthetic knockout result');
const ko = [
  syntheticMatch({
    id: 537423, stage: 'LAST_32', group: null, status: 'FINISHED',
    homeTeam: { tla: 'GER', name: 'Germany', shortName: 'Germany', crest: null },
    awayTeam: { tla: 'SUI', name: 'Switzerland', shortName: 'Switzerland', crest: null },
    score: { winner: 'AWAY_TEAM', fullTime: { home: 0, away: 1 }, halfTime: { home: 0, away: 0 } },
  }),
];
{
  const { standings: sK, thirds: tK, actual: aK } = pipelineFor(ko);
  check('SUI reached LAST_16', aK.reached.LAST_16.has('SUI'));
  check('GER eliminated', aK.eliminated.has('GER'));

  const predK = { slots: {
    537423: { home: 'GER', away: 'PAR', winner: 'GER' },
    537376: { home: 'GER', away: 'FRA', winner: 'FRA' },
    537383: { home: 'FRA', away: 'NED', winner: 'FRA' },
  } };
  const pK = { name: 'K', groups: {}, thirdPlaceQualifiers: [], knockout: {} };
  const scoreK = W.scorePlayer(pK, predK, sK, tK, aK);
  check('R32 pick GER is a miss (eliminated)',
    scoreK.detail.picks[537423].status === 'miss');
  check('no knockout points locked', scoreK.cat.knockout.locked === 0);
  check('FRA picks still alive in max',
    scoreK.cat.knockout.max === W.SCORING.reachQF + W.SCORING.reachSF,
    scoreK.cat.knockout);
}
{
  const fin = [syntheticMatch({
    id: 537390, stage: 'FINAL', group: null, status: 'FINISHED',
    homeTeam: { tla: 'ESP', name: 'Spain', shortName: 'Spain', crest: null },
    awayTeam: { tla: 'POR', name: 'Portugal', shortName: 'Portugal', crest: null },
    score: { winner: 'HOME_TEAM', fullTime: { home: 2, away: 1 }, halfTime: { home: 1, away: 0 } },
  })];
  const { standings: sF2, thirds: tF2, actual: aF2 } = pipelineFor(fin);
  check('champion detected', aF2.champion === 'ESP');
  const pK = { name: 'K', groups: {}, thirdPlaceQualifiers: [], knockout: {} };
  const scoreF = W.scorePlayer(pK, { slots: { 537390: { home: 'ESP', away: 'POR', winner: 'ESP' } } }, sF2, tF2, aF2);
  check('champion points locked',
    scoreF.cat.knockout.locked === W.SCORING.champion, scoreF.cat.knockout);
}

// ------------------------------------ 5. real bracket overrides group math
console.log('\n[5] inBracket guard + duplicate dedupe + AWARDED');
{
  // ICC "loses" the alphabetical thirds cut but is in the real R32 lineup
  // and even wins its match: must NOT be eliminated, later picks stay alive.
  const m = [
    gm('A', 'ICC', 'JCC', 1, 1),
    syntheticMatch({
      id: 537423, stage: 'LAST_32', group: null, status: 'FINISHED',
      homeTeam: { tla: 'ICC', name: 'ICC', shortName: 'ICC', crest: null },
      awayTeam: { tla: 'KCC', name: 'KCC', shortName: 'KCC', crest: null },
      score: { winner: 'HOME_TEAM', fullTime: { home: 1, away: 0 }, halfTime: { home: 0, away: 0 } },
    }),
  ];
  const { standings: s, thirds: t, actual: act } = pipelineFor(m);
  check('R32 winner is in reached set', act.reached.LAST_16.has('ICC'));
  check('bracket participant never group-eliminated', !act.eliminated.has('ICC'));
  check('R32 loser eliminated', act.eliminated.has('KCC'));

  // Duplicate team across two predicted slots scores once per milestone.
  const pred = { slots: {
    537423: { home: 'ICC', away: 'KCC', winner: 'ICC' },
    537415: { home: 'ICC', away: 'LCC', winner: 'ICC' },
  } };
  const p = { name: 'D', groups: {}, thirdPlaceQualifiers: [], knockout: {} };
  const score = W.scorePlayer(p, pred, s, t, act);
  check('duplicate pick counted once (2 pts not 4)',
    score.cat.knockout.locked === W.SCORING.reachR16, score.cat.knockout);

  // AWARDED counts as played and final.
  const mAw = [gm('A', 'AAA', 'BBB', 3, 0, 'AWARDED')];
  const sAw = W.calcStandings(mAw);
  check('AWARDED match counts in standings', sAw.table.A[0].pts === 3);
}

// ------------------------------------------- 6. thirds cut + official lineup
console.log('\n[6] thirds boundary tie + official-positions reconciliation');
{
  // Build 12 complete groups: groups A-H thirds get 3 pts (better), groups
  // I-L thirds get identical 3 pts/GD/GF too -> 8/9 boundary tie.
  const m = [];
  for (const g of W.GROUPS) {
    const t = (n) => g + n; // e.g. 'A1'..'A4'
    m.push(
      gm(g, t('1'), t('2'), 1, 0), gm(g, t('1'), t('3'), 1, 0), gm(g, t('1'), t('4'), 1, 0),
      gm(g, t('2'), t('3'), 1, 0), gm(g, t('2'), t('4'), 1, 0), gm(g, t('3'), t('4'), 1, 0),
    );
  }
  const { standings: s, actual: act } = pipelineFor(m);
  check('all groups complete', s.allComplete);
  const rt = W.rankThirds(s);
  check('identical thirds -> cut uncertain, not decided',
    rt.cutUncertain === true && rt.decided === false, rt);
  check('no 3rd-placer eliminated while cut undecided',
    W.GROUPS.every((g) => !act.eliminated.has(g + '3')));

  // Now publish the full R32 lineup; the bracket decides the thirds.
  // Winners/runners-up per official sources; thirds: pick the FIRST group of
  // each pool (pool letters) as the qualifier so all 8 third slots fill.
  const usedThirds = new Set();
  let nextId = 1000;
  const koMatches = [];
  for (const idStr of Object.keys(W.R32_SOURCES)) {
    const [hs, as] = W.R32_SOURCES[idStr];
    const teamFor = (src) => {
      if (src[0] === '1') return src[1] + '1';
      if (src[0] === '2') return src[1] + '2';
      const g = src[1].split('').find((x) => !usedThirds.has(x));
      usedThirds.add(g);
      return g + '3';
    };
    koMatches.push(syntheticMatch({
      id: Number(idStr), stage: 'LAST_32', group: null, status: 'TIMED',
      homeTeam: { tla: teamFor(hs), name: 'x', shortName: 'x', crest: null },
      awayTeam: { tla: teamFor(as), name: 'x', shortName: 'x', crest: null },
      score: { winner: null, fullTime: { home: null, away: null }, halfTime: { home: null, away: null } },
    }));
    nextId++;
  }
  const { thirds: t2, actual: act2 } = pipelineFor(m.concat(koMatches));
  check('official lineup decides the thirds', t2.decided === true);
  check('8 qualifiers from the bracket', t2.qualifiers.length === 8, t2.qualifiers);
  check('non-qualifying thirds eliminated once lineup is known',
    W.GROUPS.filter((g) => t2.qualifiers.indexOf(g + '3') === -1)
      .every((g) => act2.eliminated.has(g + '3')));
  check('official group positions resolved', act2.official != null);
}

// ------------------------------------------------ 7. malformed player files
console.log('\n[7] malformed player files degrade safely');
{
  const noGroups = { name: 'NoGroups', thirdPlaceQualifiers: ['SUI'], knockout: { roundOf32: [] } };
  const out = W.computeAll(data, [noGroups]);
  check('player without groups does not crash computeAll',
    out.rows.length === 1 || out.broken.length === 1);
  if (out.rows.length) {
    check('missing groups produce problems',
      out.rows[0].pred.problems.length > 0);
  }

  // Vacuous-seed bug: missing group E must NOT steal another matchup.
  const jon = JSON.parse(fs.readFileSync(path.join(root, 'predictions/jon.json'), 'utf8'));
  const broken = JSON.parse(JSON.stringify(jon));
  delete broken.groups.E;
  // Move FRA v SWE to the front (array order must not matter).
  const r32 = broken.knockout.roundOf32;
  const fraIdx = r32.findIndex((x) => x.home === 'FRA' && x.away === 'SWE');
  r32.unshift(r32.splice(fraIdx, 1)[0]);
  const pred = W.predictedSlots(broken);
  check('missing group E flags unresolved seeds, no silent theft',
    pred.problems.some((p) => p.indexOf('cannot resolve seeds') !== -1), pred.problems.slice(0, 4));
  check('FRA v SWE still lands on its own slot (M77)',
    pred.slots[537424] && pred.slots[537424].winner === 'FRA',
    pred.slots[537424]);

  // Bogus extra entry must be reported.
  const extra = JSON.parse(JSON.stringify(jon));
  extra.knockout.roundOf32.push({ home: 'QAT', away: 'NZL', winner: 'QAT' });
  const predE = W.predictedSlots(extra);
  check('unused stored matchup is flagged',
    predE.problems.some((p) => p.indexOf('unused roundOf32') !== -1 ||
      p.indexOf('expected 16') !== -1), predE.problems);
}

// ------------------------------------------------- 8. idle groups, feasibility
console.log('\n[8] unstarted groups and mathematically dead positions');
{
  // Only group A has played; everything else idle.
  const m = [gm('A', 'AAA', 'BBB', 1, 0)];
  const { standings: s, thirds: t, actual: act } = pipelineFor(m);
  const p = {
    name: 'I', groups: { A: ['AAA', 'BBB', 'CCC', 'DDD'], B: ['BB1', 'BB2', 'BB3', 'BB4'] },
    thirdPlaceQualifiers: [], knockout: { roundOf32: [] },
  };
  const score = W.scorePlayer(p, { slots: {} }, s, t, act);
  check('idle group contributes 0 projected',
    score.detail.groups.B.every((d) => d.status === 'idle') &&
    score.cat.groups.projected <= 2, score.cat.groups);

  // Feasibility: TTT finished all 3 matches with 0 pts while two teams have 4+.
  const mDead = [
    gm('D', 'TT1', 'TT2', 0, 1), gm('D', 'TT1', 'TT3', 0, 1), gm('D', 'TT1', 'TT4', 0, 1),
    gm('D', 'TT2', 'TT3', 1, 1),
  ];
  const sD = W.calcStandings(mDead);
  const f = sD.feasible.D['TT1'];
  check('0-pt team with 0 games left cannot finish 1st',
    f && !f.has(0), f && Array.from(f));
  const pD = { name: 'F', groups: { D: ['TT1', 'TT2', 'TT3', 'TT4'] }, thirdPlaceQualifiers: [], knockout: { roundOf32: [] } };
  const { thirds: tD, actual: aD } = pipelineFor(mDead);
  const scoreD = W.scorePlayer(pD, { slots: {} }, sD, tD, aD);
  check('impossible position excluded from max',
    scoreD.cat.groups.max < 4, scoreD.cat.groups);
}

// ---------------------------------- 8b. fair-play ties in thirds identity
console.log('\n[8b] thirds identity ties, duplicate thirds, disjoint runs');
{
  // 12 complete groups, but in group A the 2nd/3rd teams are fully tied
  // (identical overall + h2h) — WHICH team is third is fair play / lots.
  const m = [];
  for (const g of W.GROUPS) {
    const t = (n) => g + n;
    if (g === 'A') {
      // A1 beats everyone; AY/AZ draw each other and beat A4 identically.
      m.push(
        gm(g, t('1'), 'AYY', 1, 0), gm(g, t('1'), 'AZZ', 1, 0), gm(g, t('1'), t('4'), 1, 0),
        gm(g, 'AYY', 'AZZ', 1, 1), gm(g, 'AYY', t('4'), 2, 0), gm(g, 'AZZ', t('4'), 2, 0),
      );
    } else {
      m.push(
        gm(g, t('1'), t('2'), 3, 0), gm(g, t('1'), t('3'), 2, 0), gm(g, t('1'), t('4'), 1, 0),
        gm(g, t('2'), t('3'), 2, 0), gm(g, t('2'), t('4'), 3, 0), gm(g, t('3'), t('4'), 4, 0),
      );
    }
  }
  const { standings: s, thirds: t, actual: act } = pipelineFor(m);
  check('all groups complete', s.allComplete);
  check('group A 2nd/3rd flagged uncertain',
    s.uncertain.A.has(1) && s.uncertain.A.has(2), Array.from(s.uncertain.A));
  check('thirds NOT decided while a 3rd-place identity is a lots tie',
    t.decided === false && t.identityUncertain === true, t);
  // Neither tied team may be eliminated.
  check('neither tied team eliminated',
    !act.eliminated.has('AYY') && !act.eliminated.has('AZZ'));
  // Neither player's thirds pick locks.
  for (const pick of ['AYY', 'AZZ']) {
    const p = { name: 'P', groups: {}, thirdPlaceQualifiers: [pick], knockout: { roundOf32: [] } };
    const score = W.scorePlayer(p, { slots: {} }, s, t, act);
    check('pick ' + pick + ' not locked either way, still in max',
      score.cat.thirds.locked === 0 && score.cat.thirds.max === 1,
      score.cat.thirds);
  }

  // Duplicate thirdPlaceQualifiers must not double-count.
  const realThird = 'B3'; // clean group third
  const dup = { name: 'Dup', groups: {}, thirdPlaceQualifiers: [realThird, realThird], knockout: { roundOf32: [] } };
  const scoreDup = W.scorePlayer(dup, { slots: {} }, s, t, act);
  check('duplicate third counted once in projected',
    scoreDup.cat.thirds.projected <= 1, scoreDup.cat.thirds);
  const predDup = W.predictedSlots({ name: 'Dup', groups: {}, thirdPlaceQualifiers: [realThird, realThird], knockout: {} });
  check('duplicate third flagged as a file problem',
    predDup.problems.some((p) => p.indexOf('more than once') !== -1), predDup.problems.slice(0, 3));

  // Disjoint tie runs in one group must not look swappable.
  const mR = [
    gm('E', 'EA1', 'EB1', 1, 1), gm('E', 'EA1', 'EC1', 2, 0), gm('E', 'EA1', 'ED1', 2, 0),
    gm('E', 'EB1', 'EC1', 2, 0), gm('E', 'EB1', 'ED1', 2, 0), gm('E', 'EC1', 'ED1', 1, 1),
  ];
  const sR = W.calcStandings(mR);
  const runE = sR.uncertainRun.E;
  check('two disjoint runs get different ids',
    runE[0] != null && runE[2] != null && runE[0] !== runE[2],
    runE);
  const pR = { name: 'R', groups: { E: ['EC1', 'EA1', 'EB1', 'ED1'] }, thirdPlaceQualifiers: [], knockout: { roundOf32: [] } };
  const { thirds: tR, actual: aR } = pipelineFor(mR);
  const scoreR = W.scorePlayer(pR, { slots: {} }, sR, tR, aR);
  check('cross-run positions cannot swap: max 2 not 4',
    scoreR.cat.groups.max === 2, scoreR.cat.groups);
}

// --------------------------------------------------------- 9. rank ties
console.log('\n[9] leaderboard tie handling');
{
  const jon = players[0];
  const clone = JSON.parse(JSON.stringify(jon));
  clone.name = 'Aaron';
  const out = W.computeAll(data, [jon, clone]);
  check('identical players share rank 1',
    out.rows[0].rank === 1 && out.rows[1].rank === 1 &&
    out.rows[0].tied && out.rows[1].tied,
    out.rows.map((r) => ({ name: r.player.name, rank: r.rank, tied: r.tied })));
}

// ---------------------------------------------------------------- wrap up
console.log('');
if (failures) { console.log(failures + ' FAILURE(S)'); process.exit(1); }
console.log('All tests passed.');

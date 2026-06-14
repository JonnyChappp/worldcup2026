/* Bracket-prediction engine for the friends pool.
 * Pure logic, no DOM — loaded by the pool pages (predictions.html,
 * nextgame.html, brackets.html, picks.html) in the browser and by
 * tests/run-tests.js under node. Works entirely in TLA space (football-data.org
 * three-letter codes); display names/crests come from data.json at render time.
 */
(function (global) {
  'use strict';

  const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

  // Points awarded per correct call. Tweak freely — everything downstream
  // (leaderboard, max-possible, legend) reads from here.
  const SCORING = {
    groupExact: 1,   // team in the exact predicted group position (per team)
    thirdQualifier: 1, // predicted third-place qualifier actually advances
    reachR16: 2,     // per team correctly predicted to win its R32 game
    reachQF: 3,
    reachSF: 5,
    reachFinal: 8,
    champion: 13,
  };

  // Official bracket structure, keyed by football-data.org match id.
  // R32 slot sources: ['1','E'] = winner of group E, ['2','C'] = runner-up C,
  // ['3','ABCDF'] = a third-place team drawn from that pool of groups.
  const R32_SOURCES = {
    537417: [['2', 'A'], ['2', 'B']],
    537423: [['1', 'E'], ['3', 'ABCDF']],
    537415: [['1', 'F'], ['2', 'C']],
    537418: [['1', 'C'], ['2', 'F']],
    537424: [['1', 'I'], ['3', 'CDFGH']],
    537416: [['2', 'E'], ['2', 'I']],
    537425: [['1', 'A'], ['3', 'CEFHI']],
    537426: [['1', 'L'], ['3', 'EHIJK']],
    537422: [['1', 'D'], ['3', 'BEFIJ']],
    537421: [['1', 'G'], ['3', 'AEHIJ']],
    537420: [['2', 'K'], ['2', 'L']],
    537419: [['1', 'H'], ['2', 'J']],
    537429: [['1', 'B'], ['3', 'EFGIJ']],
    537428: [['1', 'J'], ['2', 'H']],
    537427: [['1', 'K'], ['3', 'DEIJL']],
    537430: [['2', 'D'], ['2', 'G']],
  };

  // Later rounds: which two matches feed each slot (winner of each advances).
  const FEEDERS = {
    537376: [537423, 537424], 537375: [537417, 537415],
    537377: [537418, 537416], 537378: [537425, 537426],
    537379: [537420, 537419], 537380: [537422, 537421],
    537381: [537428, 537430], 537382: [537429, 537427],
    537383: [537376, 537375], 537384: [537379, 537380],
    537385: [537377, 537378], 537386: [537381, 537382],
    537387: [537383, 537384], 537388: [537385, 537386],
    537390: [537387, 537388],
  };

  // FIFA match numbers, for compact labels in the UI.
  const MATCH_NUM = {
    537417: 73, 537423: 74, 537415: 75, 537418: 76, 537424: 77, 537416: 78,
    537425: 79, 537426: 80, 537422: 81, 537421: 82, 537420: 83, 537419: 84,
    537429: 85, 537428: 86, 537427: 87, 537430: 88,
    537376: 89, 537375: 90, 537377: 91, 537378: 92, 537379: 93, 537380: 94,
    537381: 95, 537382: 96, 537383: 97, 537384: 98, 537385: 99, 537386: 100,
    537387: 101, 537388: 102, 537389: 103, 537390: 104,
  };

  const ROUNDS = ['LAST_32', 'LAST_16', 'QUARTER_FINALS', 'SEMI_FINALS', 'FINAL'];
  const ROUND_OF = {};
  Object.keys(R32_SOURCES).forEach((id) => { ROUND_OF[id] = 'LAST_32'; });
  [537376, 537375, 537377, 537378, 537379, 537380, 537381, 537382]
    .forEach((id) => { ROUND_OF[id] = 'LAST_16'; });
  [537383, 537384, 537385, 537386].forEach((id) => { ROUND_OF[id] = 'QUARTER_FINALS'; });
  [537387, 537388].forEach((id) => { ROUND_OF[id] = 'SEMI_FINALS'; });
  ROUND_OF[537390] = 'FINAL';

  // Player-file knockout keys, in round order.
  const PRED_ROUND_KEYS = {
    LAST_32: 'roundOf32',
    LAST_16: 'roundOf16',
    QUARTER_FINALS: 'quarterFinals',
    SEMI_FINALS: 'semiFinals',
    FINAL: 'final',
  };

  // AWARDED = walkover/forfeit: counts as played and final.
  const PLAYED = new Set(['FINISHED', 'IN_PLAY', 'PAUSED', 'AWARDED']);
  const isFinal = (status) => status === 'FINISHED' || status === 'AWARDED';

  // ---------------------------------------------------------------- teams

  /** TLA -> {name, crest} from every team object present in data.json. */
  function teamMeta(matches) {
    const meta = {};
    for (const m of matches) {
      for (const t of [m.homeTeam, m.awayTeam]) {
        if (t && t.tla && !meta[t.tla]) {
          meta[t.tla] = { name: t.shortName || t.name, crest: t.crest };
        }
      }
    }
    return meta;
  }

  // ------------------------------------------------------------ standings

  function emptyRow(tla) {
    return { tla, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
  }

  function matchGoals(m) {
    const ft = m.score && m.score.fullTime;
    const ht = m.score && m.score.halfTime;
    const s = (ft && ft.home != null) ? ft : ht;
    if (!s || s.home == null || s.away == null) return null;
    return s;
  }

  /**
   * Live group standings from data.json matches.
   * Returns {
   *   table: {A: [row...sorted]},
   *   complete: {A: bool},             // all 6 matches final
   *   started: {A: bool},              // any match has been played
   *   uncertain: {A: Set<posIdx>},     // order at these positions rests on
   *                                    // fair play / drawing of lots, which
   *                                    // data.json cannot decide
   *   feasible: {A: {TLA: Set<posIdx>}}, // positions still reachable
   *                                      // (incomplete groups only)
   *   allComplete: bool,
   * }
   * Sorting per FIFA World Cup regulations: points, overall GD, overall GF,
   * then head-to-head points/GD/GF among teams still tied on all three.
   * Anything tied beyond that is fair play points / drawing of lots — we
   * order by TLA for display stability but flag the positions as uncertain.
   */
  function calcStandings(matches) {
    const table = {};
    const complete = {};
    const started = {};
    const uncertain = {};
    const feasible = {};
    const results = {}; // 'g|home|away' -> {hg, ag}
    const groupMatches = {};

    for (const g of GROUPS) { table[g] = {}; groupMatches[g] = []; }

    for (const m of matches) {
      if (m.stage !== 'GROUP_STAGE' || !m.group) continue;
      const g = m.group.replace('GROUP_', '');
      if (!table[g]) continue;
      groupMatches[g].push(m);
      const h = m.homeTeam && m.homeTeam.tla;
      const a = m.awayTeam && m.awayTeam.tla;
      if (h && !table[g][h]) table[g][h] = emptyRow(h);
      if (a && !table[g][a]) table[g][a] = emptyRow(a);
      if (!h || !a || !PLAYED.has(m.status)) continue;
      const s = matchGoals(m);
      if (!s) continue;
      results[g + '|' + h + '|' + a] = { hg: s.home, ag: s.away };
      const H = table[g][h]; const A = table[g][a];
      H.p++; A.p++;
      H.gf += s.home; H.ga += s.away;
      A.gf += s.away; A.ga += s.home;
      if (s.home > s.away) { H.w++; A.l++; H.pts += 3; }
      else if (s.home < s.away) { A.w++; H.l++; A.pts += 3; }
      else { H.d++; A.d++; H.pts++; A.pts++; }
    }

    const uncertainRun = {};
    for (const g of GROUPS) {
      const rows = Object.values(table[g]);
      const sorted = sortGroup(rows, results, g);
      table[g] = sorted.order;
      uncertain[g] = sorted.uncertain;
      uncertainRun[g] = sorted.run;
      complete[g] = groupMatches[g].length >= 6 &&
        groupMatches[g].every((m) => isFinal(m.status));
      started[g] = sorted.order.some((r) => r.p > 0);
      // Enumeration is only sound when every fixture's teams are known —
      // a TBD fixture would be invisible to it and could wrongly doom a team.
      const allKnown = sorted.order.length === 4 && groupMatches[g].every((m) =>
        m.homeTeam && m.homeTeam.tla && m.awayTeam && m.awayTeam.tla);
      if (!complete[g] && allKnown) {
        feasible[g] = feasiblePositions(sorted.order, groupMatches[g]);
      }
    }
    return {
      table, complete, started, uncertain, uncertainRun, feasible,
      allComplete: GROUPS.every((g) => complete[g]),
    };
  }

  function h2h(cluster, results, g) {
    const stats = {};
    for (const r of cluster) stats[r.tla] = { pts: 0, gd: 0, gf: 0 };
    for (const a of cluster) {
      for (const b of cluster) {
        if (a.tla === b.tla) continue;
        const r = results[g + '|' + a.tla + '|' + b.tla];
        if (!r) continue;
        stats[a.tla].gd += r.hg - r.ag; stats[a.tla].gf += r.hg;
        stats[b.tla].gd += r.ag - r.hg; stats[b.tla].gf += r.ag;
        if (r.hg > r.ag) stats[a.tla].pts += 3;
        else if (r.hg < r.ag) stats[b.tla].pts += 3;
        else { stats[a.tla].pts++; stats[b.tla].pts++; }
      }
    }
    return stats;
  }

  function sortGroup(rows, results, g) {
    // FIFA order: points, overall GD, overall GF first…
    const gd = (r) => r.gf - r.ga;
    rows.sort((x, y) =>
      y.pts - x.pts || gd(y) - gd(x) || y.gf - x.gf ||
      (x.tla < y.tla ? -1 : 1));
    // …then head-to-head only among teams tied on ALL THREE.
    const out = [];
    const uncertain = new Set();
    const run = {}; // position -> tie-run id; only same-run positions can swap
    let runId = 0;
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j < rows.length && rows[j].pts === rows[i].pts &&
             gd(rows[j]) === gd(rows[i]) && rows[j].gf === rows[i].gf) j++;
      const cluster = rows.slice(i, j);
      if (cluster.length > 1) {
        const hh = h2h(cluster, results, g);
        cluster.sort((x, y) =>
          hh[y.tla].pts - hh[x.tla].pts ||
          hh[y.tla].gd - hh[x.tla].gd ||
          hh[y.tla].gf - hh[x.tla].gf ||
          (x.tla < y.tla ? -1 : 1));
        // Adjacent teams still tied after h2h: order is fair play / lots.
        // Group maximal tied runs so disjoint ties never look swappable.
        let runStart = -1;
        for (let k = 0; k < cluster.length - 1; k++) {
          const a = hh[cluster[k].tla]; const b = hh[cluster[k + 1].tla];
          const tied = a.pts === b.pts && a.gd === b.gd && a.gf === b.gf;
          if (tied) {
            if (runStart === -1) runStart = k;
            uncertain.add(i + k); uncertain.add(i + k + 1);
          }
          if ((!tied || k === cluster.length - 2) && runStart !== -1) {
            const end = tied ? k + 1 : k;
            for (let p = runStart; p <= end; p++) run[i + p] = runId;
            runId++;
            runStart = -1;
          }
        }
      }
      out.push(...cluster);
      i = j;
    }
    return { order: out, uncertain, run };
  }

  /**
   * Which final positions can each team still reach? Enumerates W/D/L
   * outcomes of the group's not-yet-final matches (≤3^6) on points; goal
   * margins are unconstrained, so within a points tie any order is reachable.
   */
  function feasiblePositions(order, groupMatches) {
    const base = {};
    for (const r of order) base[r.tla] = 0;
    const open = [];
    for (const m of groupMatches) {
      const h = m.homeTeam && m.homeTeam.tla;
      const a = m.awayTeam && m.awayTeam.tla;
      if (!h || !a) continue;
      const s = matchGoals(m);
      if (isFinal(m.status) && s) {
        if (s.home > s.away) base[h] += 3;
        else if (s.home < s.away) base[a] += 3;
        else { base[h]++; base[a]++; }
      } else {
        open.push([h, a]);
      }
    }
    const tlas = Object.keys(base);
    const feas = {};
    for (const t of tlas) feas[t] = new Set();
    const combos = Math.pow(3, open.length);
    for (let mask = 0; mask < combos; mask++) {
      const pts = { ...base };
      let m = mask;
      for (const [h, a] of open) {
        const o = m % 3; m = (m - o) / 3;
        if (o === 0) pts[h] += 3;
        else if (o === 1) { pts[h]++; pts[a]++; }
        else pts[a] += 3;
      }
      for (const t of tlas) {
        let above = 0; let tied = 0;
        for (const u of tlas) {
          if (pts[u] > pts[t]) above++;
          else if (pts[u] === pts[t]) tied++;
        }
        for (let p = above; p < above + tied; p++) feas[t].add(p);
      }
    }
    return feas;
  }

  /**
   * Rank the 12 third-place teams; top 8 advance.
   * FIFA breaks pts/GD/GF ties with fair play then lots — undecidable here,
   * so a tie that straddles the 8/9 cut leaves `decided` false even when all
   * groups are complete. (actualState supersedes this with the real R32
   * lineup once FIFA publishes it in data.json.)
   */
  function rankThirds(standings) {
    const thirds = [];
    for (const g of GROUPS) {
      const row = standings.table[g][2];
      if (row) thirds.push({ ...row, group: g });
    }
    const gd = (r) => r.gf - r.ga;
    thirds.sort((x, y) =>
      y.pts - x.pts || gd(y) - gd(x) || y.gf - x.gf ||
      (x.tla < y.tla ? -1 : 1));
    let cutUncertain = false;
    if (thirds.length === 12) {
      const a = thirds[7]; const b = thirds[8];
      cutUncertain = a.pts === b.pts && gd(a) === gd(b) && a.gf === b.gf;
    }
    // If WHICH team finishes 3rd in some group is itself a fair-play/lots
    // question, the composition of the thirds field is unknown too.
    const identityUncertain = GROUPS.some((g) =>
      standings.uncertain[g] && standings.uncertain[g].has(2));
    return {
      ranked: thirds,
      qualifiers: thirds.slice(0, 8).map((t) => t.tla),
      decided: standings.allComplete && !cutUncertain && !identityUncertain,
      cutUncertain,
      identityUncertain,
    };
  }

  // -------------------------------------------------- predicted bracket

  /**
   * Map a player's predictions onto official slot ids.
   * Returns { slots: {id: {home, away, winner}}, problems: [string] }.
   *
   * R32: deterministic seeds (group winner / runner-up) come straight from the
   * player's predicted group order; the matching stored matchup supplies the
   * third-place opponent and the picked winner. Later rounds chain through
   * FEEDERS and are cross-checked against the stored matchups.
   */
  function predictedSlots(player) {
    const problems = [];
    const slots = {};
    const seed = {}; // '1E' -> 'GER'
    const groupsObj = player.groups || {};
    for (const g of GROUPS) {
      const order = groupsObj[g] || [];
      if (order.length !== 4) problems.push('group ' + g + ': expected 4 teams');
      if (order[0]) seed['1' + g] = order[0];
      if (order[1]) seed['2' + g] = order[1];
      if (order[2]) seed['3' + g] = order[2];
    }

    const tqAll = player.thirdPlaceQualifiers || [];
    if (tqAll.length !== 8) {
      problems.push('thirdPlaceQualifiers: expected 8 teams, found ' + tqAll.length);
    }
    for (const d of new Set(tqAll.filter((t, i) => tqAll.indexOf(t) !== i))) {
      problems.push('thirdPlaceQualifiers: ' + d + ' listed more than once');
    }

    const stored32 = (player.knockout && player.knockout.roundOf32) || [];
    if (stored32.length !== 16) {
      problems.push('roundOf32: expected 16 matchups, found ' + stored32.length);
    }
    const used = new Set();
    const slotOfTeam = {}; // R32 duplicate detection

    for (const idStr of Object.keys(R32_SOURCES)) {
      const id = Number(idStr);
      const [hs, as] = R32_SOURCES[id];
      const resolve = (src) => (src[0] === '3' ? null : seed[src[0] + src[1]] || null);
      let home = resolve(hs);
      let away = resolve(as);
      // Find the stored matchup containing the deterministic seed(s).
      const det = [home, away].filter(Boolean);
      const found = det.length
        ? stored32.find((mu, idx) => !used.has(idx) &&
            det.every((t) => mu && (mu.home === t || mu.away === t)))
        : null;
      if (!det.length) {
        problems.push('M' + MATCH_NUM[id] + ': cannot resolve seeds (missing group predictions)');
      }
      if (found) {
        used.add(stored32.indexOf(found));
        // Fill the third-place side from the stored pair.
        if (home == null) home = (found.home === away) ? found.away : found.home;
        if (away == null) away = (found.home === home) ? found.away : found.home;
        // Validate third-place pool membership.
        const third = hs[0] === '3' ? home : (as[0] === '3' ? away : null);
        const pool = hs[0] === '3' ? hs[1] : (as[0] === '3' ? as[1] : null);
        if (third && pool) {
          const grp = GROUPS.find((g) => seed['3' + g] === third);
          if (!grp) {
            problems.push('M' + MATCH_NUM[id] + ': ' + third +
              ' is not predicted to finish 3rd in any group');
          } else if (pool.indexOf(grp) === -1) {
            problems.push('M' + MATCH_NUM[id] + ': third-place team ' + third +
              ' (group ' + grp + ') not from pool ' + pool);
          }
          const tq = player.thirdPlaceQualifiers || [];
          if (tq.length && tq.indexOf(third) === -1) {
            problems.push('M' + MATCH_NUM[id] + ': ' + third +
              ' missing from thirdPlaceQualifiers');
          }
        }
        slots[id] = { home, away, winner: found.winner };
        if (found.winner !== home && found.winner !== away) {
          problems.push('M' + MATCH_NUM[id] + ': winner ' + found.winner +
            ' is not one of ' + home + '/' + away);
          slots[id].winner = null;
        }
      } else {
        slots[id] = { home, away, winner: null };
        if (det.length) {
          problems.push('M' + MATCH_NUM[id] + ': no stored R32 matchup for seeds ' +
            det.join('/'));
        }
      }
      // One team cannot appear in two R32 slots.
      for (const t of [slots[id].home, slots[id].away]) {
        if (!t) continue;
        if (slotOfTeam[t] != null) {
          problems.push(t + ' appears in two R32 matchups (M' +
            MATCH_NUM[slotOfTeam[t]] + ' and M' + MATCH_NUM[id] + ')');
        } else {
          slotOfTeam[t] = id;
        }
      }
    }

    // Transcription safety: every stored R32 entry must have been consumed.
    stored32.forEach((mu, idx) => {
      if (!used.has(idx) && mu) {
        problems.push('unused roundOf32 entry ' + mu.home + ' v ' + mu.away +
          ' — duplicate team or wrong codes?');
      }
    });

    // Later rounds: participants are the predicted winners of the feeders.
    for (const round of ROUNDS.slice(1)) {
      const stored = (player.knockout && player.knockout[PRED_ROUND_KEYS[round]]) || [];
      for (const idStr of Object.keys(FEEDERS)) {
        const id = Number(idStr);
        if (ROUND_OF[id] !== round) continue;
        const [fa, fb] = FEEDERS[id];
        const home = slots[fa] && slots[fa].winner;
        const away = slots[fb] && slots[fb].winner;
        const mu = stored.find((s) => s &&
          ((s.home === home && s.away === away) ||
           (s.home === away && s.away === home)));
        let winner = mu ? mu.winner : null;
        if (winner && winner !== home && winner !== away) {
          problems.push('M' + MATCH_NUM[id] + ': winner ' + winner +
            ' is not one of ' + home + '/' + away);
          winner = null;
        }
        if (!mu && home && away) {
          problems.push('M' + MATCH_NUM[id] + ': no stored matchup for ' +
            home + ' v ' + away + ' — check ' + PRED_ROUND_KEYS[round]);
        }
        slots[id] = { home, away, winner };
      }
    }

    const champ = slots[537390] && slots[537390].winner;
    if (player.champion && champ && player.champion !== champ) {
      problems.push('champion field (' + player.champion +
        ') disagrees with final pick (' + champ + ')');
    }
    return { slots, problems };
  }

  // ------------------------------------------------------ actual results

  /**
   * Official group positions derived from the real R32 lineup in data.json.
   * Once FIFA publishes all 16 R32 fixtures, each team's slot type reveals
   * whether it won its group ('1'), finished second ('2'), or advanced as a
   * third ('3') — this bakes in FIFA's fair-play/lots tiebreaks that the raw
   * results can't reproduce. Returns null until all 16 fixtures have teams.
   */
  function officialPositions(slots, standings) {
    const groupOf = {};
    for (const g of GROUPS) {
      for (const r of standings.table[g]) groupOf[r.tla] = g;
    }
    const order = {};
    const posUncertain = {};
    for (const g of GROUPS) { order[g] = [null, null, null, null]; posUncertain[g] = new Set(); }
    const thirdQualifiers = [];

    for (const idStr of Object.keys(R32_SOURCES)) {
      const s = slots[Number(idStr)];
      if (!s || !s.home || !s.away) return null; // lineup not fully published
      for (const t of [s.home, s.away]) {
        const g = groupOf[t];
        if (!g) return null; // unknown team — bail out, don't guess
        const src = R32_SOURCES[idStr].find((x) =>
          x[0] === '3' ? x[1].indexOf(g) !== -1 : x[1] === g);
        if (!src) return null;
        if (src[0] === '1') order[g][0] = t;
        else if (src[0] === '2') order[g][1] = t;
        else { order[g][2] = t; thirdQualifiers.push(t); }
      }
    }

    for (const g of GROUPS) {
      const assigned = order[g].filter(Boolean);
      const rest = standings.table[g].map((r) => r.tla)
        .filter((t) => assigned.indexOf(t) === -1);
      if (order[g][2]) {
        order[g][3] = rest[0] || null;
      } else {
        // Group's third didn't qualify: 3rd vs 4th comes from the computed
        // table; if that pair was an uncertain (fair-play/lots) tie, keep
        // the flag so those two positions never lock.
        order[g][2] = rest[0] || null;
        order[g][3] = rest[1] || null;
        const idx2 = standings.table[g].findIndex((r) => r.tla === rest[0]);
        const idx3 = standings.table[g].findIndex((r) => r.tla === rest[1]);
        const run = standings.uncertainRun[g] || {};
        if (idx2 !== -1 && idx3 !== -1 &&
            run[idx2] != null && run[idx2] === run[idx3]) {
          posUncertain[g].add(2); posUncertain[g].add(3);
        }
      }
      if (order[g].some((t) => !t)) return null;
    }
    return { order, posUncertain, thirdQualifiers };
  }

  /**
   * Outcomes of real knockout matches, per-round reach sets, the eliminated
   * set, official positions when known, and resolved thirds.
   */
  function actualState(matches, standings, thirds) {
    const slots = {};
    const problems = [];
    for (const m of matches) {
      if (!ROUND_OF[m.id] && m.stage !== 'THIRD_PLACE') continue;
      const home = m.homeTeam && m.homeTeam.tla;
      const away = m.awayTeam && m.awayTeam.tla;
      let winner = null;
      if (isFinal(m.status)) {
        const w = m.score && m.score.winner;
        if (w === 'HOME_TEAM') winner = home;
        else if (w === 'AWAY_TEAM') winner = away;
        else {
          const s = matchGoals(m);
          if (s && s.home !== s.away) winner = s.home > s.away ? home : away;
        }
        if (!winner && ROUND_OF[m.id]) {
          problems.push('M' + MATCH_NUM[m.id] +
            ' is final but no winner could be derived from the data');
        }
      }
      slots[m.id] = {
        home, away, winner,
        finished: isFinal(m.status),
        live: m.status === 'IN_PLAY' || m.status === 'PAUSED',
        utcDate: m.utcDate,
      };
    }

    // Official group positions / thirds from the real bracket, if published.
    const official = officialPositions(slots, standings);
    const resolvedThirds = official
      ? { ranked: thirds.ranked, qualifiers: official.thirdQualifiers,
          decided: true, cutUncertain: false }
      : thirds;

    // Teams that actually reached each round.
    const reached = { LAST_16: new Set(), QUARTER_FINALS: new Set(), SEMI_FINALS: new Set(), FINAL: new Set() };
    let champion = null;
    const NEXT = { LAST_32: 'LAST_16', LAST_16: 'QUARTER_FINALS', QUARTER_FINALS: 'SEMI_FINALS', SEMI_FINALS: 'FINAL' };
    for (const idStr of Object.keys(ROUND_OF)) {
      const id = Number(idStr);
      const s = slots[id];
      if (!s || !s.winner) continue;
      const next = NEXT[ROUND_OF[id]];
      if (next) reached[next].add(s.winner);
      else champion = s.winner; // FINAL
    }

    // Per-round completion (used for max-possible; based on match status so a
    // winnerless data glitch can't freeze a round open forever).
    const roundDone = {};
    for (const round of ROUNDS) {
      const ids = Object.keys(ROUND_OF).filter((id) => ROUND_OF[id] === round);
      roundDone[round] = ids.every((id) => slots[Number(id)] && slots[Number(id)].finished);
    }

    // Anyone already named in a real knockout fixture is alive by definition —
    // group-table reasoning must never override the published bracket.
    const inBracket = new Set();
    for (const idStr of Object.keys(ROUND_OF)) {
      const s = slots[Number(idStr)];
      if (s) { if (s.home) inBracket.add(s.home); if (s.away) inBracket.add(s.away); }
    }

    // Eliminated teams: group-derived first (guarded by inBracket)…
    const eliminated = new Set();
    const elimFromGroups = (t) => { if (t && !inBracket.has(t)) eliminated.add(t); };
    for (const g of GROUPS) {
      const rows = standings.table[g];
      if (official) {
        for (const t of official.order[g].slice(2)) {
          if (resolvedThirds.qualifiers.indexOf(t) === -1) elimFromGroups(t);
        }
        continue;
      }
      if (standings.complete[g]) {
        if (rows[3] && !standings.uncertain[g].has(3)) elimFromGroups(rows[3].tla);
        if (rows[2] && !standings.uncertain[g].has(2) && resolvedThirds.decided &&
            resolvedThirds.qualifiers.indexOf(rows[2].tla) === -1) {
          elimFromGroups(rows[2].tla);
        }
      } else if (standings.feasible[g]) {
        // Mathematically out: cannot finish 1st, 2nd or 3rd any more.
        for (const r of rows) {
          const f = standings.feasible[g][r.tla];
          if (f && !f.has(0) && !f.has(1) && !f.has(2)) elimFromGroups(r.tla);
        }
      }
    }
    // …then knockout losers (these stand regardless of inBracket).
    for (const idStr of Object.keys(ROUND_OF)) {
      const s = slots[Number(idStr)];
      if (s && s.finished && s.winner) {
        const loser = s.winner === s.home ? s.away : s.home;
        if (loser) eliminated.add(loser);
      }
    }
    return {
      slots, reached, champion, eliminated, roundDone, inBracket,
      official, thirds: resolvedThirds, problems,
    };
  }

  // ------------------------------------------------------------- scoring

  /**
   * Score one player. Returns locked points (only what's mathematically
   * decided), projected points (as if today's standings froze), max possible,
   * per-category breakdown, and per-pick detail for the UI.
   * `thirds` should be the resolved version from actualState.
   */
  function scorePlayer(player, pred, standings, thirds, actual) {
    const cat = {
      groups: { locked: 0, projected: 0, max: 0 },
      thirds: { locked: 0, projected: 0, max: 0 },
      knockout: { locked: 0, projected: 0, max: 0 },
    };
    const detail = { groups: {}, thirds: {}, picks: {} };
    const groupsObj = player.groups || {};
    const official = actual.official;

    // Group positions.
    for (const g of GROUPS) {
      const predOrder = groupsObj[g] || [];
      const actOrder = official ? official.order[g]
        : standings.table[g].map((r) => r.tla);
      const done = official ? true : standings.complete[g];
      const unc = official ? official.posUncertain[g] : standings.uncertain[g];
      const idle = !official && !standings.started[g];
      detail.groups[g] = predOrder.map((tla, pos) => {
        const exactNow = actOrder[pos] === tla;
        const lockable = done && !unc.has(pos);
        if (exactNow && !idle) {
          cat.groups.projected += SCORING.groupExact;
          if (lockable) cat.groups.locked += SCORING.groupExact;
        }
        // Max: decided positions only count if correct; undecided positions
        // count while the team can still mathematically land there.
        if (lockable) {
          if (exactNow) cat.groups.max += SCORING.groupExact;
        } else if (done) {
          // Fair-play/lots tie: only teams inside the SAME tied run can swap.
          const posOf = actOrder.indexOf(tla);
          const run = official ? null : (standings.uncertainRun[g] || {});
          const swappable = official
            ? (unc.has(pos) && posOf !== -1 && unc.has(posOf))
            : (posOf !== -1 && run[pos] != null && run[pos] === run[posOf]);
          if (exactNow || swappable) {
            cat.groups.max += SCORING.groupExact;
          }
        } else {
          const f = standings.feasible[g] && standings.feasible[g][tla];
          if (!f || f.has(pos)) cat.groups.max += SCORING.groupExact;
        }
        const status = idle ? 'idle'
          : lockable ? (exactNow ? 'hit' : 'miss')
          : (exactNow ? 'on' : 'off');
        return { tla, status };
      });
    }

    // Third-place qualifiers. Deduped — a copy-paste duplicate must not
    // double-count (predictedSlots flags the file problem separately).
    const predThirds = Array.from(new Set(player.thirdPlaceQualifiers || []));
    for (const tla of predThirds) {
      const inNow = thirds.qualifiers.indexOf(tla) !== -1;
      const grp = GROUPS.find((g) => (groupsObj[g] || []).indexOf(tla) !== -1);
      const actualGrp = GROUPS.find((g) =>
        standings.table[g].some((r) => r.tla === tla));
      const idle = actualGrp ? !standings.started[actualGrp] : false;
      let status;
      if (inNow && !idle) {
        cat.thirds.projected += SCORING.thirdQualifier;
        if (thirds.decided) cat.thirds.locked += SCORING.thirdQualifier;
      }
      if (thirds.decided) {
        status = inNow ? 'hit' : 'miss';
        if (inNow) cat.thirds.max += SCORING.thirdQualifier;
      } else {
        // Can the team still finish 3rd (or is it already locked as 3rd)?
        let canBeThird = true;
        if (actualGrp) {
          if (standings.complete[actualGrp]) {
            const idx = standings.table[actualGrp].findIndex((r) => r.tla === tla);
            const run = standings.uncertainRun[actualGrp] || {};
            canBeThird = idx === 2 ||
              (idx !== -1 && run[2] != null && run[2] === run[idx]);
          } else if (standings.feasible[actualGrp]) {
            const f = standings.feasible[actualGrp][tla];
            canBeThird = !f || f.has(2);
          }
        }
        status = !canBeThird ? 'miss' : idle ? 'idle' : (inNow ? 'on' : 'off');
        if (canBeThird) cat.thirds.max += SCORING.thirdQualifier;
      }
      detail.thirds[tla] = { status, group: grp };
    }

    // Knockout: team-identity scoring — points when a team the player
    // advanced actually advances, regardless of which slot it happens in.
    // Each unique team scores at most once per milestone (duplicate teams in
    // a malformed file are flagged by predictedSlots and never double-count).
    const ROUND_PTS = {
      LAST_32: SCORING.reachR16,
      LAST_16: SCORING.reachQF,
      QUARTER_FINALS: SCORING.reachSF,
      SEMI_FINALS: SCORING.reachFinal,
      FINAL: SCORING.champion,
    };
    const NEXT = { LAST_32: 'LAST_16', LAST_16: 'QUARTER_FINALS', QUARTER_FINALS: 'SEMI_FINALS', SEMI_FINALS: 'FINAL' };

    for (const round of ROUNDS) {
      const pts = ROUND_PTS[round];
      const ids = Object.keys(ROUND_OF).map(Number)
        .filter((id) => ROUND_OF[id] === round);
      const counted = new Set();
      for (const id of ids) {
        const pick = pred.slots[id] && pred.slots[id].winner;
        if (!pick) continue;
        const milestone = NEXT[round]; // undefined for FINAL -> champion
        const achieved = milestone
          ? actual.reached[milestone].has(pick)
          : actual.champion === pick;
        const dead = actual.eliminated.has(pick) ||
          (actual.roundDone[round] && !achieved);
        if (!counted.has(pick)) {
          counted.add(pick);
          if (achieved) {
            cat.knockout.locked += pts;
            cat.knockout.projected += pts;
            cat.knockout.max += pts;
          } else if (!dead) {
            cat.knockout.max += pts; // still alive
          }
        }
        detail.picks[id] = {
          pick,
          round,
          points: pts,
          status: achieved ? 'hit' : dead ? 'miss' : 'open',
        };
      }
    }

    const locked = cat.groups.locked + cat.thirds.locked + cat.knockout.locked;
    const projected = cat.groups.projected + cat.thirds.projected + cat.knockout.projected;
    const max = cat.groups.max + cat.thirds.max + cat.knockout.max;
    return { locked, projected, max, cat, detail };
  }

  // ---------------------------------------------------- per-game match picks

  /* Players can also call every individual game: `matchPicks` in the player
   * file maps a football-data match id to the winning TLA, or 'DRAW' for a
   * group-stage stalemate. These helpers power the Next Game page and the
   * per-game Brackets pool. */

  /**
   * Schedule split for "what's on": live games, the next kickoff, and the
   * ordered queue of everything still to play. Postponed/cancelled games
   * carry stale dates, so they never block the front of the queue.
   */
  function upcomingMatches(matches) {
    const sorted = matches.slice().sort((x, y) =>
      x.utcDate < y.utcDate ? -1 : x.utcDate > y.utcDate ? 1 : x.id - y.id);
    const live = sorted.filter((m) => m.status === 'IN_PLAY' || m.status === 'PAUSED');
    const queue = sorted.filter((m) => !isFinal(m.status) &&
      m.status !== 'IN_PLAY' && m.status !== 'PAUSED' &&
      m.status !== 'POSTPONED' && m.status !== 'CANCELLED');
    return { live, next: queue[0] || null, queue };
  }

  /**
   * Judge one per-game pick against a match: 'hit'/'miss' once the game is
   * final, 'live'/'open' before that, 'none' without a pick. Knockout games
   * decided on penalties resolve through score.winner, which football-data
   * sets even when fullTime is level.
   */
  function judgePick(match, pick) {
    if (!pick) return 'none';
    if (!isFinal(match.status)) {
      return (match.status === 'IN_PLAY' || match.status === 'PAUSED')
        ? 'live' : 'open';
    }
    const home = match.homeTeam && match.homeTeam.tla;
    const away = match.awayTeam && match.awayTeam.tla;
    const w = match.score && match.score.winner;
    let outcome = w === 'HOME_TEAM' ? home : w === 'AWAY_TEAM' ? away :
      w === 'DRAW' ? 'DRAW' : null;
    if (!outcome) {
      const s = matchGoals(match);
      if (s) outcome = s.home === s.away ? 'DRAW' : s.home > s.away ? home : away;
    }
    if (!outcome) return 'open'; // final but the data yields no outcome
    return pick === outcome ? 'hit' : 'miss';
  }

  /** Running tally of one player's per-game picks across `matches`. */
  function pickRecord(matches, picks) {
    const rec = { hits: 0, misses: 0, open: 0, picked: 0 };
    if (!picks) return rec;
    for (const m of matches) {
      const v = judgePick(m, picks[m.id]);
      if (v === 'none') continue;
      rec.picked++;
      if (v === 'hit') rec.hits++;
      else if (v === 'miss') rec.misses++;
      else rec.open++;
    }
    return rec;
  }

  /**
   * Sanity-check a matchPicks object against the schedule (hand-edited files):
   * ids must exist, picks must be a fixture team, DRAW is group-stage only.
   * Unknown-team fixtures (knockout TBD slots) skip the team check.
   */
  function validateMatchPicks(picks, matches) {
    const problems = [];
    if (!picks || typeof picks !== 'object') return problems;
    const byId = {};
    for (const m of matches) byId[m.id] = m;
    for (const key of Object.keys(picks)) {
      const m = byId[key];
      const pick = picks[key];
      const label = MATCH_NUM[key] ? 'M' + MATCH_NUM[key] : 'match ' + key;
      if (!m) { problems.push('matchPicks: unknown match id ' + key); continue; }
      if (pick === 'DRAW') {
        if (m.stage !== 'GROUP_STAGE') {
          problems.push('matchPicks: ' + label +
            ' is a knockout game — DRAW is not a valid pick');
        }
        continue;
      }
      const h = m.homeTeam && m.homeTeam.tla;
      const a = m.awayTeam && m.awayTeam.tla;
      if (h && a && pick !== h && pick !== a) {
        problems.push('matchPicks: ' + label + ' pick ' + pick +
          ' is not ' + h + ' or ' + a);
      }
    }
    return problems;
  }

  // ---------------------------------------------- bracket builder (picks.html)

  /* Per R32 slot that takes a third-place team, the pool of groups that third
   * may come from — derived straight from R32_SOURCES, paired with the group
   * winner that occupies the other side of the slot. */
  const THIRD_SLOTS = (function () {
    const out = {};
    for (const idStr of Object.keys(R32_SOURCES)) {
      const [hs, as] = R32_SOURCES[idStr];
      const third = hs[0] === '3' ? hs : as[0] === '3' ? as : null;
      if (!third) continue;
      const winner = hs[0] === '1' ? hs : as[0] === '1' ? as : null;
      out[idStr] = { pool: third[1], thirdSide: hs[0] === '3' ? 'home' : 'away',
        winnerGroup: winner ? winner[1] : null };
    }
    return out;
  })();

  /** Teams in each group, in the order football-data first lists them. */
  function groupTeams(matches) {
    const out = {};
    for (const g of GROUPS) out[g] = [];
    for (const m of matches) {
      if (m.stage !== 'GROUP_STAGE' || !m.group) continue;
      const g = m.group.replace('GROUP_', '');
      if (!out[g]) continue;
      for (const t of [m.homeTeam, m.awayTeam]) {
        if (t && t.tla && out[g].indexOf(t.tla) === -1) out[g].push(t.tla);
      }
    }
    return out;
  }

  /**
   * Assign each qualifying third-place GROUP to a distinct R32 third-slot whose
   * pool contains it (bipartite matching, augmenting-path). Returns
   * { slotOfGroup: {G: slotId} } or null if no perfect matching exists — the
   * exact assignment is scoring-irrelevant (knockout scoring is team-identity),
   * it only has to respect the pools so predictedSlots validates cleanly.
   */
  function matchThirds(groups) {
    const slotIds = Object.keys(THIRD_SLOTS);
    const want = groups.slice().sort(); // stable, deterministic output
    const slotTaken = {};            // slotId -> group
    const tryAssign = (grp, seen) => {
      for (const id of slotIds) {
        if (THIRD_SLOTS[id].pool.indexOf(grp) === -1 || seen.has(id)) continue;
        seen.add(id);
        if (slotTaken[id] == null || tryAssign(slotTaken[id], seen)) {
          slotTaken[id] = grp;
          return true;
        }
      }
      return false;
    };
    for (const grp of want) {
      if (!tryAssign(grp, new Set())) return null;
    }
    const slotOfGroup = {};
    for (const id of Object.keys(slotTaken)) slotOfGroup[slotTaken[id]] = id;
    return { slotOfGroup };
  }

  /**
   * Resolve a full predicted bracket structure from group orders + the eight
   * third-place qualifiers, for the on-site builder. Fills every slot's
   * participants (R32 from seeds + matched thirds, later rounds left for the
   * caller to chain as winners are picked). Returns
   * { r32: [{id, home, away, thirdSide}], problems }.
   */
  function resolveBracketStructure(groupsObj, thirdQualifiers) {
    const problems = [];
    const seed = {};
    for (const g of GROUPS) {
      const order = (groupsObj && groupsObj[g]) || [];
      if (order.length !== 4) problems.push('Group ' + g + ' needs all 4 teams ordered');
      if (order[0]) seed['1' + g] = order[0];
      if (order[1]) seed['2' + g] = order[1];
      if (order[2]) seed['3' + g] = order[2];
    }
    const tq = thirdQualifiers || [];
    if (tq.length !== 8) problems.push('Pick exactly 8 third-place teams (have ' + tq.length + ')');

    // Which group does each qualified third belong to (by predicted 3rd place)?
    const qualGroups = [];
    for (const tla of tq) {
      const g = GROUPS.find((x) => seed['3' + x] === tla);
      if (!g) problems.push(tla + ' is not predicted to finish 3rd in any group');
      else qualGroups.push(g);
    }
    let slotOfGroup = {};
    if (qualGroups.length === 8 && new Set(qualGroups).size === 8) {
      const m = matchThirds(qualGroups);
      if (!m) {
        problems.push('These 8 third-place teams can’t be slotted into the ' +
          'bracket together — swap one out (each R32 third-place spot only takes ' +
          'certain groups).');
      } else {
        slotOfGroup = m.slotOfGroup;
      }
    }

    const r32 = [];
    for (const idStr of Object.keys(R32_SOURCES)) {
      const id = Number(idStr);
      const [hs, as] = R32_SOURCES[idStr];
      const resolveSide = (src) => {
        if (src[0] === '3') {
          const grp = Object.keys(slotOfGroup).find((g) => slotOfGroup[g] === idStr);
          return grp ? seed['3' + grp] || null : null;
        }
        return seed[src[0] + src[1]] || null;
      };
      r32.push({
        id, home: resolveSide(hs), away: resolveSide(as),
        thirdSide: hs[0] === '3' ? 'home' : as[0] === '3' ? 'away' : null,
      });
    }
    return { r32, problems };
  }

  /**
   * Build the `knockout` object + champion from a structure and the caller's
   * winner picks (slotId -> winning TLA). Later-round participants are chained
   * through FEEDERS from the winners, so a half-finished bracket serializes
   * with nulls rather than throwing. Mirrors the player-file schema that
   * predictedSlots consumes.
   */
  function serializeBracket(r32, winners) {
    const slotTeams = {};
    for (const s of r32) slotTeams[s.id] = { home: s.home, away: s.away };
    const mk = (id) => ({
      home: slotTeams[id] ? slotTeams[id].home : null,
      away: slotTeams[id] ? slotTeams[id].away : null,
      winner: winners[id] || null,
    });
    const byRound = { LAST_32: [], LAST_16: [], QUARTER_FINALS: [], SEMI_FINALS: [], FINAL: [] };
    for (const s of r32) byRound.LAST_32.push(mk(s.id));
    for (const round of ROUNDS.slice(1)) {
      for (const idStr of Object.keys(FEEDERS)) {
        const id = Number(idStr);
        if (ROUND_OF[id] !== round) continue;
        const [fa, fb] = FEEDERS[id];
        slotTeams[id] = { home: winners[fa] || null, away: winners[fb] || null };
        byRound[round].push(mk(id));
      }
    }
    return {
      knockout: {
        roundOf32: byRound.LAST_32,
        roundOf16: byRound.LAST_16,
        quarterFinals: byRound.QUARTER_FINALS,
        semiFinals: byRound.SEMI_FINALS,
        final: byRound.FINAL,
      },
      champion: winners[537390] || null,
    };
  }

  /**
   * Everything the page needs, in one call. A malformed player file degrades
   * to an error row instead of taking the whole pool down.
   */
  function computeAll(data, players) {
    const matches = data.matches || [];
    const meta = teamMeta(matches);
    const standings = calcStandings(matches);
    const rawThirds = rankThirds(standings);
    const actual = actualState(matches, standings, rawThirds);
    const thirds = actual.thirds;
    const rows = [];
    const broken = [];
    for (const p of players) {
      try {
        const pred = predictedSlots(p);
        const score = scorePlayer(p, pred, standings, thirds, actual);
        const championPick = (pred.slots[537390] && pred.slots[537390].winner) ||
          p.champion || null;
        rows.push({ player: p, pred, score, championPick });
      } catch (e) {
        broken.push({ name: (p && p.name) || '(unnamed file)', error: e.message });
      }
    }
    rows.sort((a, b) =>
      b.score.locked - a.score.locked ||
      b.score.projected - a.score.projected ||
      b.score.max - a.score.max ||
      (a.player.name < b.player.name ? -1 : 1));
    // Competition ranking: ties on LOCKED points share a rank.
    let lastLocked = null; let lastRank = 0;
    rows.forEach((r, i) => {
      if (r.score.locked !== lastLocked) { lastRank = i + 1; lastLocked = r.score.locked; }
      r.rank = lastRank;
      r.tied = false;
    });
    rows.forEach((r) => {
      r.tied = rows.filter((o) => o.rank === r.rank).length > 1;
    });
    return { meta, standings, thirds, actual, rows, broken };
  }

  const api = {
    GROUPS, SCORING, R32_SOURCES, FEEDERS, MATCH_NUM, ROUNDS, ROUND_OF,
    PRED_ROUND_KEYS,
    teamMeta, calcStandings, rankThirds, predictedSlots, actualState,
    scorePlayer, computeAll, officialPositions, feasiblePositions,
    upcomingMatches, judgePick, pickRecord, validateMatchPicks,
    THIRD_SLOTS, groupTeams, matchThirds, resolveBracketStructure, serializeBracket,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.WCBrackets = api;
})(typeof window !== 'undefined' ? window : globalThis);

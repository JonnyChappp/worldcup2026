/* Shared UI helpers for the per-game pool pages (nextgame.html,
 * brackets.html, picks.html): HTML-string builders and the per-device draft
 * store that bridges picks.html and the display pages. Sits on top of the
 * engine in brackets.js (window.WCBrackets); predictions.html predates this
 * file and keeps its own copies.
 */
(function (global) {
  'use strict';
  const W = global.WCBrackets;

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Player files are friend-supplied: never let their color reach a style
  // attribute raw.
  function safeColor(c) {
    return /^#[0-9a-fA-F]{3,8}$/.test(c || '') ? c : '#888';
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function fmtDate(utc) {
    const d = new Date(utc);
    return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
  }

  // Kickoff in the viewer's local time: "Sat 13 Jun · 7:00 PM".
  function fmtKickoff(utc) {
    const d = new Date(utc);
    if (isNaN(d)) return 'TBD';
    let h = d.getHours();
    const ap = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    const mins = String(d.getMinutes()).padStart(2, '0');
    return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] +
      ' · ' + h + ':' + mins + ' ' + ap;
  }

  function untilKickoff(utc) {
    const ms = new Date(utc) - new Date();
    if (isNaN(ms) || ms <= 0) return '';
    const mins = Math.round(ms / 60000);
    if (mins < 60) return 'in ' + mins + 'm';
    const hrs = Math.floor(mins / 60);
    if (hrs < 48) return 'in ' + hrs + 'h ' + (mins % 60) + 'm';
    return 'in ' + Math.floor(hrs / 24) + 'd ' + (hrs % 24) + 'h';
  }

  function crest(meta, tla) {
    const m = meta[tla];
    if (m && m.crest) return '<img src="' + esc(m.crest) + '" alt="" loading="lazy">';
    return '';
  }
  function tname(meta, tla) {
    const m = meta[tla];
    return m ? m.name : (tla || 'TBD');
  }

  const STAGE_LABEL = {
    LAST_32: 'Round of 32', LAST_16: 'Round of 16',
    QUARTER_FINALS: 'Quarter-finals', SEMI_FINALS: 'Semi-finals',
    THIRD_PLACE: 'Third place', FINAL: 'Final',
  };
  function stageLabel(m) {
    if (m.stage === 'GROUP_STAGE') {
      return 'Group ' + String(m.group || '').replace('GROUP_', '');
    }
    return STAGE_LABEL[m.stage] || m.stage;
  }

  // ----------------------------------------------- per-device submissions
  // picks.html saves a whole player object per submission here, so this device
  // sees a new entry immediately; the downloaded JSON committed to
  // predictions/ (+ players.json) is what publishes it for everyone. A
  // submission is a COMPLETE object — never merged key-by-key — so it can
  // faithfully represent "no pick here" without an old value resurrecting.

  const INDEX_KEY = 'wc2026_submissions';
  const subKey = (slug) => 'wc2026_sub_' + slug;

  // Filename-safe slug from a display name; also the download filename stem.
  function slugify(name) {
    return String(name || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'player';
  }

  function listSubmissionSlugs() {
    try {
      const a = JSON.parse(localStorage.getItem(INDEX_KEY));
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function getSubmission(slug) {
    try {
      const obj = JSON.parse(localStorage.getItem(subKey(slug)));
      return (obj && typeof obj === 'object') ? obj : null;
    } catch (e) { return null; }
  }

  /** All local submissions: [{slug, player, savedAt}], newest-saved first. */
  function listSubmissions() {
    return listSubmissionSlugs().map((slug) => {
      const obj = getSubmission(slug);
      return obj ? { slug, player: obj.player, savedAt: obj.savedAt } : null;
    }).filter(Boolean).sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));
  }

  function saveSubmission(slug, player, savedAt) {
    try {
      localStorage.setItem(subKey(slug),
        JSON.stringify({ player, savedAt: savedAt || new Date().toISOString() }));
      const idx = listSubmissionSlugs().filter((s) => s !== slug);
      idx.push(slug);
      localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
      return true;
    } catch (e) { return false; }
  }

  function deleteSubmission(slug) {
    try {
      localStorage.removeItem(subKey(slug));
      localStorage.setItem(INDEX_KEY,
        JSON.stringify(listSubmissionSlugs().filter((s) => s !== slug)));
    } catch (e) {}
  }

  /**
   * The roster a display page should render: committed players plus this
   * device's local submissions. Match by name (case-insensitive). A local
   * submission with the same name as a committed file overrides it field-by-
   * field at the TOP level (whole `matchPicks`/`knockout`/etc. objects replace,
   * never per-key merge), tagging `_unpublished`. A local-only name is added,
   * tagged `_local`. Committed players with no local match pass through clean.
   */
  function mergedPlayers(committed) {
    const byName = {};
    const order = [];
    for (const p of committed) {
      const k = String(p.name || '').toLowerCase();
      byName[k] = Object.assign({}, p);
      order.push(k);
    }
    for (const sub of listSubmissions()) {
      const p = sub.player;
      if (!p || !p.name) continue;
      const k = String(p.name).toLowerCase();
      if (byName[k]) {
        const merged = Object.assign({}, byName[k]);
        for (const f of Object.keys(p)) {
          if (p[f] != null) merged[f] = p[f]; // top-level wholesale override
        }
        merged._unpublished = true;
        byName[k] = merged;
      } else {
        byName[k] = Object.assign({}, p, { _local: true });
        order.push(k);
      }
    }
    return order.map((k) => byName[k]);
  }

  // ------------------------------------------------------------ pick chips

  /**
   * One player's call on one game. `pick` is a TLA, 'DRAW', or falsy for no
   * pick; `status` comes from W.judgePick. `tag` annotates the source
   * ('draft' for unpublished device picks, 'bracket' for original-bracket
   * fallbacks).
   */
  function pickChip(meta, playerName, pick, status, tag) {
    const owner = '<span class="owner">' + esc(playerName) +
      (tag ? ' · ' + tag : '') + '</span>';
    if (!pick) {
      return '<span class="chip none" aria-label="' + esc(playerName) +
        ' has no pick yet"><span class="tla">—</span>' + owner + '</span>';
    }
    const cls = status === 'hit' ? ' hit' : status === 'miss' ? ' miss' : '';
    const mark = status === 'hit' ? ' <span aria-hidden="true">✓</span>' : '';
    const body = pick === 'DRAW'
      ? '<span class="tla">\u{1F91D} Draw</span>'
      : crest(meta, pick) + '<span class="tla">' + esc(pick) + '</span>';
    const sr = status === 'hit' ? 'correct' : status === 'miss' ? 'wrong' : 'pending';
    return '<span class="chip' + cls + (tag === 'draft' || tag === 'unpublished' ? ' draft' : '') +
      '" aria-label="' + esc(playerName) + ' picked ' +
      esc(pick === 'DRAW' ? 'a draw' : pick) + ' — ' + sr + '">' +
      body + mark + owner + '</span>';
  }

  // ------------------------------------------------------------ match cards

  /**
   * A fixture card. `picks` is [{name, pick, status, tag}]; `opts.hero`
   * renders the big next-game treatment, otherwise a compact row.
   */
  function matchCard(meta, m, picks, opts) {
    opts = opts || {};
    const live = m.status === 'IN_PLAY' || m.status === 'PAUSED';
    const done = m.status === 'FINISHED' || m.status === 'AWARDED';
    const ft = m.score && m.score.fullTime;
    const h = m.homeTeam && m.homeTeam.tla;
    const a = m.awayTeam && m.awayTeam.tla;
    const score = (live || done) && ft && ft.home != null
      ? '<span class="vs sc' + (live ? ' live' : '') + '">' +
        ft.home + ' – ' + ft.away + '</span>'
      : '<span class="vs">v</span>';
    const when = live
      ? '<span class="lv">LIVE</span>'
      : done ? 'Full time'
      : fmtKickoff(m.utcDate) +
        (opts.hero && untilKickoff(m.utcDate)
          ? ' · <b>' + untilKickoff(m.utcDate) + '</b>' : '');
    const team = (tla, name) =>
      '<span class="team">' + crest(meta, tla) +
      '<span class="nm">' + esc(name) + '</span></span>';
    const chips = picks.map((p) =>
      pickChip(meta, p.name, p.pick, p.status, p.tag)).join('');
    return '<div class="mcard' + (opts.hero ? ' hero' : '') +
      (live ? ' islive' : '') + '">' +
      '<div class="meta">' + esc(stageLabel(m)) + ' · ' + when + '</div>' +
      '<div class="fixture">' +
      team(h, h ? tname(meta, h) : (m.homeTeam && m.homeTeam.name) || 'TBD') +
      score +
      team(a, a ? tname(meta, a) : (m.awayTeam && m.awayTeam.name) || 'TBD') +
      '</div>' +
      '<div class="wpicks">' + chips + '</div></div>';
  }

  // -------------------------------------- mirrored bracket grid (ported from
  // predictions.html: the final's two semi-final feeders define the left and
  // right halves; every box spans its two feeders' rows and centers between
  // them).

  const FINAL_ID = 537390;

  const BRACKET_HALVES = (function () {
    const half = (sfId) => {
      const qf = W.FEEDERS[sfId].slice();
      const r16 = qf.flatMap((id) => W.FEEDERS[id]);
      return {
        SEMI_FINALS: [sfId],
        QUARTER_FINALS: qf,
        LAST_16: r16,
        LAST_32: r16.flatMap((id) => W.FEEDERS[id]),
      };
    };
    const sf = W.FEEDERS[FINAL_ID];
    return { left: half(sf[0]), right: half(sf[1]) };
  })();
  const HALF_SPAN = { LAST_32: 2, LAST_16: 4, QUARTER_FINALS: 8, SEMI_FINALS: 16, FINAL: 16 };
  const ROUND_LABEL = {
    LAST_32: 'Round of 32', LAST_16: 'Round of 16',
    QUARTER_FINALS: 'Quarter-finals', SEMI_FINALS: 'Semi-finals', FINAL: 'Final',
  };

  /** Emit all label + match cells for the 9-column grid; renderBox(id, round)
   * supplies each box's inner HTML. */
  function mirroredCells(renderBox) {
    const L = BRACKET_HALVES.left, R = BRACKET_HALVES.right;
    const cols = [
      { col: 1, round: 'LAST_32', ids: L.LAST_32 },
      { col: 2, round: 'LAST_16', ids: L.LAST_16 },
      { col: 3, round: 'QUARTER_FINALS', ids: L.QUARTER_FINALS },
      { col: 4, round: 'SEMI_FINALS', ids: L.SEMI_FINALS },
      { col: 5, round: 'FINAL', ids: [FINAL_ID] },
      { col: 6, round: 'SEMI_FINALS', ids: R.SEMI_FINALS },
      { col: 7, round: 'QUARTER_FINALS', ids: R.QUARTER_FINALS },
      { col: 8, round: 'LAST_16', ids: R.LAST_16 },
      { col: 9, round: 'LAST_32', ids: R.LAST_32 },
    ];
    const cells = [];
    for (const c of cols) {
      cells.push('<div class="blab" style="grid-column:' + c.col + ';grid-row:1">' +
        ROUND_LABEL[c.round] + '</div>');
      const span = HALF_SPAN[c.round];
      c.ids.forEach((id, i) => {
        cells.push('<div class="bm" style="grid-column:' + c.col + ';grid-row:' +
          (2 + i * span) + '/span ' + span + '">' + renderBox(id, c.round) + '</div>');
      });
    }
    return cells.join('');
  }

  /** Placeholder text for knockout slots whose real teams aren't known yet. */
  function slotPlaceholder(id) {
    const src = W.R32_SOURCES[id];
    if (src) {
      const part = (s) => s[0] === '1' ? 'Win ' + s[1] : s[0] === '2' ? '2nd ' + s[1] : '3rd pool';
      return part(src[0]) + ' v ' + part(src[1]);
    }
    const f = W.FEEDERS[id];
    if (f) return 'Win M' + W.MATCH_NUM[f[0]] + ' v Win M' + W.MATCH_NUM[f[1]];
    return 'TBD';
  }

  global.PoolUI = {
    esc, safeColor, fmtDate, fmtKickoff, untilKickoff, crest, tname,
    stageLabel, slugify, listSubmissions, getSubmission, saveSubmission,
    deleteSubmission, mergedPlayers,
    pickChip, matchCard, mirroredCells, slotPlaceholder, FINAL_ID,
  };
})(window);

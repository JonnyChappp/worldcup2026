# World Cup 2026 — pool tracker

Live World Cup 2026 tracker plus a bracket-prediction pool for friends.

Based on [kingdoggydog/worldcup2026](https://github.com/Kingdoggydog/worldcup2026)
(schedule, groups, and knockout pages). Added here:

- **`predictions.html`** ("Group + Brackets" in the nav) — the original
  pool page, scoring the full-tournament brackets everyone drew before
  kickoff: leaderboard with locked / projected / max-possible points, a
  per-game "who called it" grid for every knockout match, live group tables
  vs each player's predicted order, and a viewer for each player's full
  predicted bracket with hits and busts marked.
- **`nextgame.html`** ("Next Game") — what's live and what kicks off next,
  with every player's call on it, the on-deck queue, and per-game pick
  records. Group-stage calls come from `matchPicks` (below); knockout games
  fall back to the original brackets until per-game picks exist.
- **`brackets.html`** ("Brackets") — the second pool: once the group stage
  decides the real Round-of-32 matchups, everyone calls every knockout game
  fresh. Same who-called-it grid and per-player viewer, driven by
  `matchPicks` instead of the pre-tournament brackets.
- **`picks.html`** ("Picks") — the entry wizard where anyone adds themselves
  (name + colour) and makes picks in any of three modes: **every game**
  (home/draw/away on all 72 group games), **full bracket** (tap-to-rank each
  group, choose 8 third-place qualifiers, then tap winners through an
  interactive bracket to the trophy), or **knockout only** (unlocks once the
  real Round-of-32 is set). Save writes the whole player object to this
  device's localStorage (so it shows immediately, tagged "unpublished") and
  downloads a ready-to-commit `<name>.json`. The full-bracket builder slots
  third-place teams with a pool-respecting matching (`matchThirds`), not
  FIFA's allocation table — harmless because knockout scoring is team-identity.
- **`brackets.js`** — the scoring engine (pure logic, no DOM). Encodes the
  official bracket structure (which group positions feed each Round-of-32
  slot, and the feeder chain through the final), computes live group
  standings with FIFA tiebreakers, aligns each player's predictions to real
  match slots, and scores them. Also the per-game pick helpers
  (`upcomingMatches`, `judgePick`, `pickRecord`, `validateMatchPicks`).
- **`pool-ui.js`** — shared HTML builders + the draft-pick store for the
  per-game pages.
- **`predictions/`** — one JSON file per player (see the README in there for
  how to add a friend), plus `players.json` listing the files to load.
- **`tests/run-tests.js`** — engine tests: `node tests/run-tests.js`.

## Scoring

Weights live in `SCORING` at the top of `brackets.js`:

| Call | Points |
|---|---|
| Team in exact predicted group position | 1 each (48 max) |
| Correct third-place qualifier | 1 each (8 max) |
| Team you advanced wins its R32 game | 2 each |
| ...reaches the quarter-finals | 3 each |
| ...reaches the semi-finals | 5 each |
| ...reaches the final | 8 each |
| Champion | 13 |

Knockout points are team-based: if your team gets there by a different path
than you drew, it still counts. Maximum 161.

## Running it

It's a static site — any web server works:

```sh
python3 -m http.server 8456
# open http://localhost:8456/
```

## Live data

`data.json` is the football-data.org `/v4/competitions/WC/matches` response.
The GitHub Action (`.github/workflows/fetch-scores.yml`) refreshes it every
5 minutes. To make that work on your own GitHub repo:

1. Register a free API key at <https://www.football-data.org/client/register>
   (the free tier includes the World Cup).
2. Add it as an Actions secret named `FOOTBALL_DATA_TOKEN`
   (repo Settings → Secrets and variables → Actions).
3. Enable GitHub Pages (Settings → Pages → deploy from branch `main`).

## Adding a friend's bracket

See `predictions/README.md`. Short version: copy their picks into a new
JSON file, add the filename to `predictions/players.json`, done — every
page section picks them up automatically.

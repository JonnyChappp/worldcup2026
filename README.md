# World Cup 2026 — pool tracker

Live World Cup 2026 tracker plus a bracket-prediction pool for friends.

Based on [kingdoggydog/worldcup2026](https://github.com/Kingdoggydog/worldcup2026)
(schedule, groups, and knockout pages). Added here:

- **`predictions.html`** ("Brackets" in the nav) — the pool page:
  leaderboard with locked / projected / max-possible points, a per-game
  "who called it" grid for every knockout match, live group tables vs each
  player's predicted order, and a viewer for each player's full predicted
  bracket with hits and busts marked.
- **`brackets.js`** — the scoring engine (pure logic, no DOM). Encodes the
  official bracket structure (which group positions feed each Round-of-32
  slot, and the feeder chain through the final), computes live group
  standings with FIFA tiebreakers, aligns each player's predictions to real
  match slots, and scores them.
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

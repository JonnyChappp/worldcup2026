# Bracket predictions

One JSON file per player, listed in `players.json` in this folder.

**Easiest way to add a friend:** open **`picks.html`** ("Picks" in the nav)
in the site, add a person by name, make their picks (any of: every group game,
a full groups-and-knockout bracket, or knockout-only), and hit **Save** — it
downloads a ready-to-commit `<name>.json`. Drop that file in this folder and
add its filename to `players.json`. Until it's committed, the picks show only
on the device they were made on (tagged "unpublished").

You can still hand-author a file by copying `_template.json` to `<name>.json`.
Picks transcribed from play.fifa.com's Bracket Challenge (print the groups +
knockout pages to PDF, or screenshot them) drop straight into the bracket
fields.

## Team codes

Use the codes from `data.json` (football-data.org TLAs). Watch out — a few
differ from FIFA's:

| Team | Code here | FIFA shows |
|---|---|---|
| Uruguay | URY | URU |
| Saudi Arabia | KSA | SAU |
| Cape Verde | CPV | CPV/CV |
| Congo DR | COD | COD |
| South Africa | RSA | RSA |

Full list: ALG ARG AUS AUT BEL BIH BRA CAN CIV COD COL CPV CRO CUW CZE ECU
EGY ENG ESP FRA GER GHA HAI IRN IRQ JOR JPN KOR KSA MAR MEX NED NOR NZL PAN
PAR POR QAT RSA SCO SEN SUI SWE TUN TUR URY USA UZB

## Fields

- `groups` — predicted finish order (1st → 4th) for each group A–L
- `thirdPlaceQualifiers` — the 8 third-place teams picked to advance
- `knockout` — predicted matchups and winner for each round; `venue`/`date`
  are display labels from the bracket printout
- `champion` — predicted winner
- `color` — accent color for this player in charts/leaderboard
- `matchPicks` — per-game calls, keyed by football-data match id: the
  picked winner's TLA, or `"DRAW"` (group stage only). Don't fill this by
  hand — `picks.html` ("Picks" in the nav) has the full fixture list with
  buttons and a Save that downloads this file updated; just drop the
  download back in this folder. Knockout games go in here too once the
  bracket is set (the "Brackets" page reads them).

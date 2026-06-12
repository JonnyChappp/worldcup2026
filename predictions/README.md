# Bracket predictions

One JSON file per player. Add a friend by copying `_template.json` to
`<name>.json`, filling in their picks, and adding the filename to
`players.json` in this folder.

Where to get the picks: on play.fifa.com Bracket Challenge, print/save the
bracket pages to PDF (groups page + knockout page) or take full screenshots —
the picks can be transcribed straight from those.

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

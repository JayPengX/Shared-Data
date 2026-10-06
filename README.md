# Shared-Data

The family's nightly data packs on GitHub Pages: what doesn't change in a
day, read from here instead of through the data proxy.

## Sports (every night at midnight, Taiwan time)

Every league's season from ESPN (`sports.mjs`), for Orbit Sports and Quadra
Play: the whole year from its month pages, without what no app reads.

- `https://jaypengx.github.io/Shared-Data/sports/<league>/<year>.json`
  (the league keys of the shared kit's catalog: `nba`, `epl`, `f1`…)
- `https://jaypengx.github.io/Shared-Data/sports/index.json`

Locally: `node sports.mjs [league …]` (no keys; `KIT` is the shared kit's
folder, `../Shared-Proxy/kit` by default).

## The mirror (every night, after the seasons)

Copies of the reads Orbit Sports and Quadra Play would ask the data proxy
for (`mirror.mjs`): a day's and a month's games, finished box scores, every
league's tables, teams, squads and players' season numbers, players' pages,
F1's results and official pages, Asia's baseball months. A finished game's
box score is carried over from the last published site, not asked of ESPN
again. Each is good until
the first moment it could change (a team's next game, a day's first
kickoff) and never past the next build; the shared kit's `proxyJson` reads
it when `mirror/index.json` says it's held, at the kit's `mirrorPath(url)`.

Locally: `node mirror.mjs` after `node sports.mjs` (`MIRROR_MINUTES`: time
for players' pages, 25 by default; `MIRROR_MB`: room, 450 MB by default).

## Win probability (every night, kept for good)

A finished game's win probability line where ESPN draws none (soccer, CPBL,
an MLB game ESPN left without one): Polymarket's market on it, read once by
`winprob.mjs` and committed here (`winprob/`), never read again. Orbit Sports
reads a past game's line from here; one on now from Polymarket through the
proxy. The matching is Orbit Sports' `public/lib/winprob.mjs` (checked out
beside the kit by the workflow).

- `https://jaypengx.github.io/Shared-Data/winprob/<league>/<game>.json`:
  `{ source, market, points: [{ t, home, draw? }] }`, or `{ none }` (ESPN
  draws its own, or Polymarket had no market). ESPN's games by their id,
  CPBL's by the day and the home side (`2026-09-27-lions`).

Locally: `node winprob.mjs` after `node sports.mjs` (`WINPROB_DAYS`: how far
back, 4 by default; `SPORTS_LIB`: Orbit Sports' `public/lib`,
`../Orbit-Sports/public/lib` by default).

## Buses (Mondays)

Taiwan's bus routes and timetables from [TDX](https://tdx.transportdata.tw),
packed small and published every Monday at 02:00 (Taiwan time) on GitHub
Pages, for [Orbit Transit](https://github.com/JayPengX/Orbit-Transit) to keep
on the phone: a trip's buses (which way a route goes, its stops, its times at
each) are worked out there without asking TDX line by line. Where the buses
are right now stays live.

- `https://jaypengx.github.io/Shared-Data/bus/<City>.json`: a city's routes
  (`Hsinchu`, `HsinchuCounty`, `Taipei`…)
- `https://jaypengx.github.io/Shared-Data/bus/InterCity/<lat>_<lon>.json`:
  the 公路客運, cut into squares of 0.25° (a route in every square it stops in)
- `https://jaypengx.github.io/Shared-Data/index.json`: when it was built, and
  each pack's size
- `https://jaypengx.github.io/Shared-Data/where.json` (every night,
  `where.mjs`): Taiwan in cells of 0.02°, each listing the bus packs with a
  stop in it and the cities with a YouBike station in it, so the app finds a
  place's stops and bikes on the phone instead of asking TDX around each point

The format is at the top of `build.mjs`.

## Running it

- Every Monday by itself (`.github/workflows/build.yml`; the other nights
  `carry.mjs` keeps the week's packs on the site), or now: Actions → Build →
  Run workflow, with "buses" ticked. Needs the repo secrets `TDX_CLIENT_ID` and
  `TDX_CLIENT_SECRET` (tdx.transportdata.tw → 會員中心 → API 金鑰).
- Locally: `node build.mjs [City …]` with those two in the environment, or
  `node build.mjs --proxy [City …]` through Orbit Transit's proxy (its dev
  door for localhost), no keys needed.

A city that fails one week is left out of that week's site; the app keeps
the pack it already has until the next good build.

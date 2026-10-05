# Transit-Data

The family's nightly data packs on GitHub Pages: what doesn't change in a
day, read from here instead of through the data proxy.

## Sports (every night at midnight, Taiwan time)

Every league's season from ESPN (`sports.mjs`), for Orbit Sports and Quadra
Play: the whole year from its month pages, without what no app reads.

- `https://jaypengx.github.io/Transit-Data/sports/<league>/<year>.json`
  (the league keys of the shared kit's catalog: `nba`, `epl`, `f1`…)
- `https://jaypengx.github.io/Transit-Data/sports/index.json`

Locally: `node sports.mjs [league …]` (no keys; `KIT` is the shared kit's
folder, `../Shared-Proxy/kit` by default).

## Buses (Mondays)

Taiwan's bus routes and timetables from [TDX](https://tdx.transportdata.tw),
packed small and published every Monday at 02:00 (Taiwan time) on GitHub
Pages, for [Orbit Transit](https://github.com/JayPengX/Orbit-Transit) to keep
on the phone: a trip's buses (which way a route goes, its stops, its times at
each) are worked out there without asking TDX line by line. Where the buses
are right now stays live.

- `https://jaypengx.github.io/Transit-Data/bus/<City>.json`: a city's routes
  (`Hsinchu`, `HsinchuCounty`, `Taipei`…)
- `https://jaypengx.github.io/Transit-Data/bus/InterCity/<lat>_<lon>.json`:
  the 公路客運, cut into squares of 0.25° (a route in every square it stops in)
- `https://jaypengx.github.io/Transit-Data/index.json`: when it was built, and
  each pack's size

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

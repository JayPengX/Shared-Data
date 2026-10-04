# Transit-Data

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

- Every Monday by itself (`.github/workflows/build.yml`), or now: Actions →
  Build → Run workflow. Needs the repo secrets `TDX_CLIENT_ID` and
  `TDX_CLIENT_SECRET` (tdx.transportdata.tw → 會員中心 → API 金鑰).
- Locally: `node build.mjs [City …]` with those two in the environment, or
  `node build.mjs --proxy [City …]` through Orbit Transit's proxy (its dev
  door for localhost), no keys needed.

A city that fails one week is left out of that week's site; the app keeps
the pack it already has until the next good build.

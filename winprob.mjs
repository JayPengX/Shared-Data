// Past games' win probability (and F1 races' chances by lap), while Orbit
// Sports can show them: a game
// over doesn't change, so its line is read once (Polymarket's market on it,
// where ESPN draws none: soccer, CPBL, an MLB or NBA game ESPN left without
// one) and carried over each night from the published site (a Pages deploy
// replaces the whole site), never read again. Kept while its league's
// current season runs, and before the next one's regular season its
// playoffs (the bracket shows them); anything older is let go.
//
//   node winprob.mjs      (after sports.mjs; KIT: the shared kit's folder,
//                          ../Shared-Proxy/kit by default; SPORTS_LIB: Orbit
//                          Sports' public/lib, ../Orbit-Sports/public/lib)
//
// → site/winprob/<league>/<YYYY-MM>.json ({ games: { key: line | { none } } },
// the format at Orbit Sports' lib/winprob.mjs, which reads it) and
// site/winprob/index.json ({ built, leagues: { key: { months, kept } } }).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const ROOT = resolve(KIT, '..');
const LIB = resolve(process.env.SPORTS_LIB || '../Orbit-Sports/public/lib');
const { CATALOG, asiaMonthUrl, asiaMonthOf } = await import(pathToFileURL(`${KIT}/catalog.mjs`).href);
const { trimPolymarketGames } = await import(pathToFileURL(`${ROOT}/sports-proxy-worker.js`).href);
const { asiaBaseballResponse } = await import(pathToFileURL(`${ROOT}/asia-baseball.js`).href);
const { polymarketLine, packLine, gameKey, PM_LEAGUE, PM_PACK, GAMES_TRIM, raceLine, raceLaps, raceEvents, packRace, raceKey } = await import(pathToFileURL(`${LIB}/winprob.mjs`).href);

const PUBLISHED = process.env.PUBLISHED || 'https://jaypengx.github.io/Shared-Data/';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.now();
// A game's market can take a while to settle; two days on without one, none.
const GIVE_UP = 2 * DAY;
// Where ESPN draws its own (all but a game now and then), only the last week is looked at.
const ESPN_DRAWS = new Set(['baseball', 'basketball', 'football', 'hockey']);
const month = ms => new Date(ms).toISOString().slice(0, 7);

async function get(url, { trim = '', missing = null } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (orbit-winprob)' }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) {
        const data = await res.json();
        return trim === GAMES_TRIM ? trimPolymarketGames(data) : data;
      }
      if (res.status === 404) return missing;
      if (res.status === 400) return null;
    } catch {}
    if (attempt >= 3) throw new Error(`${url}: unread`);
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
}

// ---- What's kept: the league's season now, and its last playoffs before the next regular season ----
// ESPN's leagues: the season its scoreboard is on ({ start, phase }); CPBL's: the calendar year.
async function seasonOf(key, l) {
  if (l.data === 'asia') {
    const y = new Date(NOW).getUTCFullYear();
    return { start: Date.UTC(y, 0, 1), phase: null };
  }
  const data = await get(`${SITE}/${l.espn}/scoreboard`).catch(() => null);
  const s = data?.leagues?.[0]?.season;
  const t = s?.type?.type;
  return { start: Date.parse(s?.startDate || '') || NOW - 180 * DAY, phase: t === 1 ? 'pre' : t === 4 ? 'off' : t === 2 ? 'regular' : t === 3 ? 'post' : null };
}
// Kept: a game of this season; before this season's regular season (or, for
// CPBL, before its first game this year), last season's playoffs too.
function keeps(season, entry, cpblStarted) {
  if (entry.t >= season.start) return true;
  const before = season.phase === 'pre' || season.phase === 'off' || (season.phase === null && !cpblStarted);
  return before && Boolean(entry.post) && entry.t >= season.start - 365 * DAY;
}

// ---- The games over: tonight's season packs (sports.mjs), CPBL from its months ----
async function finishedGames(key, l, from) {
  if (l.data === 'asia') {
    const months = [...new Set([asiaMonthOf(from), asiaMonthOf(NOW - 31 * DAY), asiaMonthOf(NOW)])];
    const lists = await Promise.all(months.map(async ym => (await (await asiaBaseballResponse(new URL(asiaMonthUrl(l.asia, ym)))).json().catch(() => null))?.games || []));
    // CPBL's playoffs: from October on.
    return lists.flat().filter(g => g.state === 'post').map(g => ({ id: g.id, start: g.start, home: g.home, away: g.away, post: new Date(g.start).getUTCMonth() >= 9 }));
  }
  const games = [];
  for (const y of new Set([new Date(from).getUTCFullYear(), new Date(NOW).getUTCFullYear()])) {
    let pack;
    try {
      pack = JSON.parse(await readFile(`site/sports/${key}/${y}.json`, 'utf8'));
    } catch {
      continue;
    }
    for (const e of pack.events || []) {
      const comp = e.competitions?.[0];
      if ((e.status?.type?.state || comp?.status?.type?.state) !== 'post') continue;
      const team = h => comp?.competitors?.find(c => c.homeAway === h)?.team;
      const [home, away] = [team('home'), team('away')];
      if (home && away) games.push({ id: String(e.id), start: comp?.date || e.date, home: { en: home.displayName || home.name }, away: { en: away.displayName || away.name }, post: e.season?.type === 3 || /post|playoff|play-in/i.test(e.season?.slug || '') });
    }
  }
  return games;
}

// ---- The store as last published ----
async function published() {
  const index = await get(`${PUBLISHED}${PM_PACK}/index.json`, { missing: { leagues: {} } });
  const store = new Map();
  for (const [key, { months = [] } = {}] of Object.entries(index.leagues || {})) {
    const games = new Map();
    for (const m of months) {
      const file = await get(`${PUBLISHED}${PM_PACK}/${key}/${m}.json`, { missing: { games: {} } });
      for (const [k, v] of Object.entries(file.games || {})) games.set(k, v);
    }
    store.set(key, games);
  }
  return store;
}

const stats = { carried: 0, lines: 0, espn: 0, none: 0, later: 0, dropped: 0 };
async function league(key, l, games) {
  const season = await seasonOf(key, l);
  const espnDraws = l.data === 'espn' && ESPN_DRAWS.has(l.sport);
  const from = espnDraws ? NOW - 7 * DAY : season.start - 365 * DAY;
  const finished = (await finishedGames(key, l, from)).filter(g => Date.parse(g.start) >= from && Date.parse(g.start) < NOW - 3 * HOUR);
  const cpblStarted = l.data === 'asia' && finished.some(g => Date.parse(g.start) >= season.start);
  const todo = finished.filter(g => keeps(season, { t: Date.parse(g.start), post: g.post }, cpblStarted) && !games.has(gameKey(key, g)));
  // Six games at a time (a first night reads a whole season's).
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let g; (g = todo.shift()); ) {
        const t = Date.parse(g.start);
        const entry = { t, post: g.post ? 1 : 0 };
        const k = gameKey(key, g);
        // ESPN's own line where it draws one.
        if (espnDraws) {
          const summary = await get(`${SITE}/${l.espn}/summary?event=${g.id}`).catch(() => null);
          if ((summary?.winprobability || []).length > 3) {
            stats.espn++;
            games.set(k, { ...entry, none: 'espn' });
            continue;
          }
        }
        const line = await polymarketLine(key, { start: g.start, home: g.home.en, away: g.away.en }, (url, { trim = '' }) => get(url, { trim })).catch(() => null);
        if (line) {
          stats.lines++;
          games.set(k, { ...entry, ...packLine(line) });
        } else if (NOW - t > GIVE_UP) {
          stats.none++;
          games.set(k, { ...entry, none: 'polymarket' });
        } else stats.later++;
      }
    })
  );
  // Let go of what the app no longer shows.
  for (const [k, v] of games) if (!keeps(season, v, cpblStarted)) games.delete(k), stats.dropped++;
  return season;
}

// What a race's turns hold (4: the safety car's cause, every read answered, who led away); one kept with less is read again once.
const TURNS = 4;

// ---- F1: each race's chances by lap (OpenF1's laps once it has them) ----
// Kept: this year's races; until this year's first, last year's too (the
// app shows the last season then).
async function f1(games) {
  const year = new Date(NOW).getUTCFullYear();
  const races = [];
  for (const y of [year - 1, year]) races.push(...((await get(`https://api.openf1.org/v1/sessions?year=${y}&session_name=Race`).catch(() => null)) || []));
  const started = races.some(r => new Date(r.date_start).getUTCFullYear() === year && Date.parse(r.date_start) < NOW);
  const keep = t => new Date(t).getUTCFullYear() === year || (!started && new Date(t).getUTCFullYear() === year - 1);
  // OpenF1 lets some 30 reads a minute: its reads two seconds apart, the same one never twice.
  const seen = new Map();
  let next = 0;
  const read = (url, { trim = '' }) => {
    if (!url.startsWith('https://api.openf1.org/')) return get(url, { trim });
    if (!seen.has(url))
      seen.set(
        url,
        (async () => {
          const wait = Math.max(0, next - Date.now());
          next = Math.max(next, Date.now()) + 2100;
          await new Promise(r => setTimeout(r, wait));
          return get(url);
        })()
      );
    return seen.get(url);
  };
  for (const r of races) {
    const t = Date.parse(r.date_start);
    const k = raceKey(r.date_start);
    let kept = games.get(k);
    // Marked without a market before older races' markets were read whole: looked for again, once.
    if (kept?.none && kept.nv !== TURNS) games.delete(k), (kept = undefined);
    // A race kept before its turns were as now (the safety car and its cause, stops, leads): those alone, once.
    if (keep(t) && kept?.by === 'lap' && kept.bv !== TURNS) {
      const laps = await raceLaps(r.date_start, read).catch(() => null);
      const ev = laps && (await raceEvents(r.date_start, read, laps, kept.d).catch(() => null));
      if (ev) Object.assign(kept, { b: ev.bands, e: ev.events, bv: TURNS }), stats.lines++;
      continue;
    }
    if (!keep(t) || kept || t > NOW - 4 * HOUR || r.is_cancelled) continue;
    const laps = await raceLaps(r.date_start, read).catch(() => null);
    // OpenF1's laps come in a little after the race; two days on without them, by the clock.
    if (!laps && NOW - t < GIVE_UP) {
      stats.later++;
      continue;
    }
    const line = await raceLine(r.date_start, read, laps).catch(() => null);
    if (line && laps) Object.assign(line, (await raceEvents(r.date_start, read, laps, line.drivers).catch(() => null)) || {});
    if (line) stats.lines++, games.set(k, { t, ...packRace(line), ...(line.bands ? { bv: TURNS } : {}) });
    else if (NOW - t > GIVE_UP) stats.none++, games.set(k, { t, none: 'polymarket', nv: TURNS });
    else stats.later++;
  }
  for (const [k, v] of games) if (!keep(v.t)) games.delete(k), stats.dropped++;
}

const store = await published();
for (const games of store.values()) stats.carried += games.size;
const index = { built: new Date(NOW).toISOString(), leagues: {} };
for (const [key, l] of [...Object.entries(CATALOG).filter(([k]) => PM_LEAGUE[k]), ['f1', null]]) {
  const games = store.get(key) || new Map();
  const before = { ...stats };
  if (key === 'f1') await f1(games);
  else await league(key, l, games);
  const months = new Map();
  for (const [k, v] of games) {
    const m = month(v.t);
    if (!months.has(m)) months.set(m, {});
    months.get(m)[k] = v;
  }
  await mkdir(`site/${PM_PACK}/${key}`, { recursive: true });
  for (const [m, list] of months) await writeFile(`site/${PM_PACK}/${key}/${m}.json`, JSON.stringify({ games: list }));
  index.leagues[key] = { months: [...months.keys()].sort(), kept: games.size };
  console.log(`${key}: ${games.size} kept in ${months.size} months (${stats.lines - before.lines} new lines, ${stats.espn - before.espn} ESPN's, ${stats.none - before.none} none, ${stats.later - before.later} later, ${stats.dropped - before.dropped} let go)`);
}
await writeFile(`site/${PM_PACK}/index.json`, JSON.stringify(index));
console.log(`winprob: ${stats.carried} carried over, ${stats.lines} new lines, ${stats.dropped} let go`);

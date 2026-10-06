// Past games' win probability, kept for good: a game over doesn't change, so
// its line is read once (Polymarket's market on it, where ESPN draws none:
// soccer, CPBL, an MLB game ESPN left without one) and kept in this repo at
// winprob/<league>/<game>.json, published with the site. Each night only the
// games over since are read; Orbit Sports reads a past game's line from here
// (lib/winprob.mjs there: the matching, the line and the file's name, shared).
//
//   node winprob.mjs      (KIT: the shared kit's folder, ../Shared-Proxy/kit by default;
//                          SPORTS_LIB: Orbit Sports' public/lib, ../Orbit-Sports/public/lib;
//                          WINPROB_DAYS: how far back to look, 4 days by default)
//
// A file is { source: 'polymarket', points: [{ t, home, draw? }] }, or
// { none: 'espn' | 'polymarket' }: ESPN draws its own, or no market was found
// two days on (none is asked about again).
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const ROOT = resolve(KIT, '..');
const LIB = resolve(process.env.SPORTS_LIB || '../Orbit-Sports/public/lib');
const { CATALOG, asiaMonthUrl, asiaMonthOf } = await import(pathToFileURL(`${KIT}/catalog.mjs`).href);
const { trimPolymarketGames } = await import(pathToFileURL(`${ROOT}/sports-proxy-worker.js`).href);
const { asiaBaseballResponse } = await import(pathToFileURL(`${ROOT}/asia-baseball.js`).href);
const { polymarketLine, packPath, PM_LEAGUE, GAMES_TRIM } = await import(pathToFileURL(`${LIB}/winprob.mjs`).href);

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const HOUR = 3_600_000;
const NOW = Date.now();
const FROM = NOW - Number(process.env.WINPROB_DAYS || 4) * 24 * HOUR;
// A game's market can take a while to settle; after two days without one, none.
const GIVE_UP = 2 * 24 * HOUR;

async function get(url, trim = '') {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (orbit-winprob)' }, signal: AbortSignal.timeout(30_000) });
      if (res.status === 200) {
        const data = await res.json();
        return trim === GAMES_TRIM ? trimPolymarketGames(data) : data;
      }
      if (res.status === 404 || res.status === 400 || attempt >= 2) return null;
    } catch {
      if (attempt >= 2) return null;
    }
    await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
  }
}
const have = path => access(path).then(() => true, () => false);

// The games over in the window: from tonight's season packs (sports.mjs), CPBL from its months.
async function finishedGames(key, l) {
  if (l.data === 'asia') {
    const months = [...new Set([asiaMonthOf(FROM), asiaMonthOf(NOW)])];
    const lists = await Promise.all(months.map(async ym => (await (await asiaBaseballResponse(new URL(asiaMonthUrl(l.asia, ym)))).json().catch(() => null))?.games || []));
    return lists.flat().filter(g => g.state === 'post').map(g => ({ id: g.id, start: g.start, home: g.home, away: g.away }));
  }
  const years = [...new Set([new Date(FROM).getUTCFullYear(), new Date(NOW).getUTCFullYear()])];
  const games = [];
  for (const y of years) {
    let pack;
    try {
      pack = JSON.parse(await readFile(`site/sports/${key}/${y}.json`, 'utf8'));
    } catch {
      continue;
    }
    for (const e of pack.events || []) {
      const comp = e.competitions?.[0];
      if ((e.status?.type?.state || comp?.status?.type?.state) !== 'post') continue;
      const side = h => comp?.competitors?.find(c => c.homeAway === h)?.team;
      const [home, away] = [side('home'), side('away')];
      if (home && away) games.push({ id: String(e.id), start: comp?.date || e.date, home: { en: home.displayName || home.name }, away: { en: away.displayName || away.name } });
    }
  }
  return games;
}

const stats = { kept: 0, lines: 0, espn: 0, none: 0, later: 0 };
async function league(key, l) {
  const sport = l.sport;
  const games = (await finishedGames(key, l)).filter(g => Date.parse(g.start) >= FROM && Date.parse(g.start) < NOW - 3 * HOUR);
  for (const g of games) {
    const file = packPath(key, g);
    if (await have(file)) {
      stats.kept++;
      continue;
    }
    const write = async data => {
      await mkdir(resolve(file, '..'), { recursive: true });
      await writeFile(file, JSON.stringify(data));
    };
    // ESPN's own line where it draws one (never for soccer).
    if (l.espn && sport !== 'soccer') {
      const summary = await get(`${SITE}/${l.espn}/summary?event=${g.id}`);
      if ((summary?.winprobability || []).length > 3) {
        stats.espn++;
        await write({ none: 'espn' });
        continue;
      }
    }
    const line = await polymarketLine(key, { start: g.start, home: g.home.en, away: g.away.en }, (url, { trim = '' }) => get(url, trim)).catch(() => null);
    if (line) {
      stats.lines++;
      await write(line);
    } else if (NOW - Date.parse(g.start) > GIVE_UP) {
      stats.none++;
      await write({ none: 'polymarket' });
    } else stats.later++;
  }
}

const leagues = Object.entries(CATALOG).filter(([key]) => PM_LEAGUE[key]);
for (const [key, l] of leagues) {
  const before = { ...stats };
  await league(key, l);
  console.log(`${key}: ${stats.lines - before.lines} lines, ${stats.espn - before.espn} ESPN's, ${stats.none - before.none} none, ${stats.later - before.later} later, ${stats.kept - before.kept} kept`);
}
console.log(`winprob: ${stats.lines} new lines, ${stats.kept} kept from before`);

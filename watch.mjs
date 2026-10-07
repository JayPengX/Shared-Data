// What each recent game can be watched as, for Orbit Sports: its official
// highlights on YouTube and whether ELTA.tv has its whole game, worked out
// here every few hours (the night's build and the day's runs) and read once
// by every phone, so a game's sheet has its video the moment it opens and
// its card says where to watch it again, without each phone asking YouTube
// and ELTA game by game.
//
// The picking is the app's own (its lib/highlights.mjs and lib/broadcast.mjs,
// loaded alone); the reads go through the sports proxy's dev door (YouTube's
// search and ELTA.tv's season pages, trimmed and cached there).
//
//   node watch.mjs     (KIT: the shared kit's folder, ../Shared-Proxy/kit by
//                       default; SPORTS_LIB: Orbit Sports' public/lib)
//
// → site/sports/watch.json: { built, games: { '<league>:<id>:<session>':
// { hl?: { id, channel, channelId, length, official }, elta?: 1 } } }. Games
// of the last ten days, carried from the published copy; a game's
// highlights looked for while it's four days old at most, ELTA's video ten.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const LIB = resolve(process.env.SPORTS_LIB || '../Orbit-Sports/public/lib');
const { CATALOG, asiaMonthOf } = await import(pathToFileURL(`${KIT}/catalog.mjs`).href);
const { teamNameZh } = await import(pathToFileURL(`${KIT}/names.mjs`).href);
const HL = await import(pathToFileURL(`${LIB}/highlights.mjs`).href);
const { BROADCAST, eltaVodOf, eltaVodUrl, eltaEpisode, eltaSessionEpisode } = await import(pathToFileURL(`${LIB}/broadcast.mjs`).href);

const PUBLISHED = process.env.PUBLISHED || 'https://jaypengx.github.io/Shared-Data/';
const PROXY = 'https://sports-proxy.pengzjay.workers.dev/sports-proxy';
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const DAY = 86_400_000;
const NOW = Date.now();
const KEEP = 10 * DAY;
const HL_DAYS = 4 * DAY;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function json(url, { proxy = false } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(proxy ? `${PROXY}?url=${encodeURIComponent(url)}&app=match` : url, { headers: proxy ? { Origin: 'http://localhost:8123' } : { 'User-Agent': 'Mozilla/5.0 (orbit-watch)' }, signal: AbortSignal.timeout(30_000) });
      if (res.ok) return await res.json();
      if (res.status === 404 || res.status === 400) return null;
    } catch {}
    if (attempt >= 2) throw new Error(`${url.slice(0, 120)}: unread`);
    await sleep(1500 * (attempt + 1));
  }
}

// ---- The games: the app's shape, as far as the picking reads it ----------------------

const side = c => ({ id: String(c?.team?.id ?? c?.athlete?.id ?? ''), en: c?.team?.displayName || c?.athlete?.displayName || '', name: c?.team?.displayName || c?.athlete?.displayName || '', short: c?.team?.shortDisplayName || '', score: c?.score?.displayValue ?? (typeof c?.score === 'string' ? c.score : '') });
export function espnGames(data, league) {
  const out = [];
  for (const ev of data?.events || []) {
    if (league === 'f1') {
      // A race weekend's sessions, each its own (the app's `<event>~<FP1>`).
      for (const c of ev.competitions || []) {
        const abbr = c.type?.abbreviation;
        if (!abbr || c.status?.type?.state !== 'post') continue;
        out.push({ id: `${ev.id}~${abbr}`, league, kind: 'field', sessionKey: abbr, name: ev.name, enName: ev.name, start: c.date, official: c.date, status: { state: 'post' } });
      }
      continue;
    }
    const c = ev.competitions?.[0];
    const st = c?.status?.type || ev.status?.type || {};
    if (st.state !== 'post' || /postponed|canceled|cancelled/i.test(st.name || '')) continue;
    const home = c.competitors?.find(x => x.homeAway === 'home');
    const away = c.competitors?.find(x => x.homeAway === 'away');
    if (!home || !away) continue;
    out.push({ id: String(ev.id), league, kind: 'match', start: ev.date, status: { state: 'post' }, home: side(home), away: side(away), note: c.notes?.[0]?.headline || '', series: c.series?.type === 'playoff' ? { summary: c.series.summary || '' } : null });
  }
  return out;
}
// CPBL's from the mirror's months (the proxy's copy of the league's lists).
async function cpblGames() {
  const months = [...new Set([NOW, NOW - KEEP].map(asiaMonthOf))];
  const lists = await Promise.all(months.map(m => json(`${PUBLISHED}mirror/_/asia-baseball.quadra/cpbl/${m}.json.json`).catch(() => null)));
  return lists
    .flatMap(x => x?.data?.games || [])
    .filter(g => g.state === 'post')
    .map(g => ({ id: g.id, league: 'cpbl', kind: 'match', start: g.start, status: { state: 'post' }, home: { id: g.home.en, en: g.home.en, name: g.home.zh, zh: g.home.zh, score: String(g.homeScore ?? '') }, away: { id: g.away.en, en: g.away.en, name: g.away.zh, zh: g.away.zh, score: String(g.awayScore ?? '') } }));
}
const usDate = ms => new Date(ms - 5 * 3_600_000).toISOString().slice(0, 10).replaceAll('-', '');

// A game's sides in Chinese, every way they're written ([home's, away's]), as the app's tv.mjs.
const zhSides = e => {
  const l = CATALOG[e.league];
  return [e.home, e.away].map(s => {
    const zh = teamNameZh(l?.bet ?? e.league, s?.en || s?.name, l?.sport);
    return [s?.name, s?.short, s?.zh, zh?.full, zh?.short].filter(Boolean);
  });
};

async function main() {
  const leagues = Object.keys(BROADCAST).filter(k => CATALOG[k]);
  const old = (await json(`${PUBLISHED}sports/watch.json`).catch(() => null))?.games || {};
  // Every recent game over: ESPN's leagues day by day (US days, from ten days back), CPBL's from the mirror.
  const days = Array.from({ length: Math.ceil(KEEP / DAY) + 1 }, (_, i) => usDate(NOW - i * DAY));
  const games = [];
  for (const key of leagues) {
    const l = CATALOG[key];
    if (l.data === 'asia') {
      games.push(...(await cpblGames()));
      continue;
    }
    if (l.data !== 'espn' || !l.espn) continue;
    if (key === 'f1') {
      // A race weekend: its event's page has every session.
      games.push(...espnGames(await json(`${SITE}/${l.espn}/scoreboard`).catch(() => null), key));
      continue;
    }
    for (const d of days) {
      games.push(...espnGames(await json(`${SITE}/${l.espn}/scoreboard?dates=${d}`).catch(() => null), key));
      await sleep(150);
    }
  }
  const recent = games.filter(e => NOW - Date.parse(e.start) < KEEP && Date.parse(e.start) < NOW);
  const out = {};
  for (const e of recent) {
    const k = HL.watchKey(e);
    if (old[k]) out[k] = old[k];
  }
  // Highlights: each game not yet found, four days at most after it.
  let found = 0;
  let failed = 0;
  const read = (url, _o) => json(url, { proxy: true });
  const todo = recent.filter(e => !out[HL.watchKey(e)]?.hl && NOW - Date.parse(e.start) < HL_DAYS);
  for (const e of todo) {
    try {
      const v = await HL.findHighlights(e, read, NOW);
      if (v) {
        out[HL.watchKey(e)] = { ...out[HL.watchKey(e)], hl: v };
        found++;
      }
    } catch {
      failed++;
    }
    await sleep(400);
  }
  // ELTA's whole game: each season page read once, each game not yet found matched as the app does.
  const pages = new Map();
  let elta = 0;
  for (const e of recent.filter(e => !out[HL.watchKey(e)]?.elta)) {
    const sides = zhSides(e);
    const vod = eltaVodOf(e, sides[0]);
    if (!vod) continue;
    if (!pages.has(vod)) pages.set(vod, await json(eltaVodUrl(vod), { proxy: true }).then(d => d?.episodes || [], () => []));
    const episodes = pages.get(vod);
    const hit = e.kind === 'match' ? eltaEpisode(episodes, e, sides) : eltaSessionEpisode(episodes, e);
    if (hit) {
      out[HL.watchKey(e)] = { ...out[HL.watchKey(e)], elta: 1 };
      elta++;
    }
  }
  const pack = { built: new Date(NOW).toISOString(), games: out };
  await mkdir('site/sports', { recursive: true });
  await writeFile('site/sports/watch.json', JSON.stringify(pack));
  console.log(`watch: ${recent.length} recent games, ${Object.keys(out).length} kept; highlights ${found} found of ${todo.length} looked for (${failed} unread); ELTA ${elta} found`);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

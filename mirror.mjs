// The nightly mirror: copies of the reads Orbit Sports and Quadra Play would
// otherwise ask the data proxy for, built each night after the season packs
// (sports.mjs) and published on GitHub Pages. The shared kit's proxyJson
// reads a copy from here when mirror/index.json says it holds that read and
// the copy is still good, and asks the proxy otherwise (see kit/quadra.mjs,
// mirrored).
//
//   node mirror.mjs        (KIT: the shared kit's folder, ../Shared-Proxy/kit by default;
//                           MIRROR_MINUTES: how long players' pages may take, 25 by default)
//
// What's held, each good until the first moment it could change:
//   - a day's and a month's games: until the first game in it not over yet starts
//   - a game that's over, its box score: until the next build
//   - a league's tables, its players' season numbers: until its next game
//   - last season's tables and numbers, a league's teams: until the next build
//   - a team's page, its games, its squad, its players' pages: until its next game
//   - F1's calendar, drivers, results and official pages: until the next race weekend
//   - Asia's baseball months: like a month of games
// and none of it past the next build (+6 hours, if a build fails).
//
// → site/mirror/<trim or _>/<host><path>[/<query>].json ({ until, data }) at
// the kit's mirrorPath; site/mirror/index.json ({ built, until, match, counts }).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const ROOT = resolve(KIT, '..');
const kitFile = f => import(pathToFileURL(`${KIT}/${f}`).href);
const { CATALOG, asiaMonthUrl, asiaMonthOf } = await kitFile('catalog.mjs');
const { mirrorPath } = await kitFile('quadra.mjs');
const { F1_TEAMS, F1_PAGE } = await kitFile('logos.mjs');
const { trimEspnRoster, trimEspnAthletes, trimF1Page } = await import(pathToFileURL(`${ROOT}/sports-proxy-worker.js`).href);
const { asiaBaseballResponse } = await import(pathToFileURL(`${ROOT}/asia-baseball.js`).href);

const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const STANDINGS = 'https://site.api.espn.com/apis/v2/sports';
const COMMON = 'https://site.api.espn.com/apis/common/v3/sports';
const JOLPICA = 'https://api.jolpi.ca/ergast/f1';
const F1 = 'https://www.formula1.com/en';
const HOUR = 3_600_000;
const NOW = Date.now();
// The next build is in a day: a copy is never good past that (and 6 hours more for a build that fails).
const LAST = NOW + 30 * HOUR;
const PLAYERS_BY = NOW + Number(process.env.MIRROR_MINUTES || 25) * 60_000;
// Room on GitHub Pages (a site of 1 GB at most, with the buses and seasons beside it).
const ROOM = Number(process.env.MIRROR_MB || 450) * 1e6;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// What no app reads (checked against Sports' and Play's parsers): the heavy
// part of ESPN's answers. Each kind may keep only the top-level parts its
// parser reads.
const DROP = new Set(['links', 'news', 'videos', 'article', 'articles', 'ticketsInfo', 'quicklinks', 'playerSwitcher', 'guid', 'alternateIds', 'geoBroadcasts', 'fantasy', 'commentary', 'headlines', '$ref', 'college', 'birthCountry', 'experience', 'lastUpdated', 'parent', 'contracts', 'draft']);
export function slim(x, keep = null) {
  if (Array.isArray(x)) return x.map(v => slim(v));
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) {
    if (DROP.has(k) || (keep && !keep.includes(k))) continue;
    // A team's logos: the apps read the first one's address only.
    out[k] = k === 'logos' && Array.isArray(v) ? v.slice(0, 1).map(l => ({ href: l?.href })) : slim(v);
  }
  return out;
}

// ---- Reading, a few at a time ------------------------------------------------------------
let running = 0;
const waiting = [];
const AT_ONCE = 8;
async function slot(fn) {
  if (running >= AT_ONCE) await new Promise(r => waiting.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    waiting.shift()?.();
  }
}
const stats = { asked: 0, failed: 0, written: 0, bytes: 0, kinds: {} };
function get(url, { text = false } = {}) {
  return slot(async () => {
    for (let attempt = 0; ; attempt++) {
      stats.asked++;
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (orbit-mirror)', Accept: text ? 'text/html' : 'application/json' }, signal: AbortSignal.timeout(30_000) });
        if (res.status === 200) return text ? await res.text() : await res.json();
        if (res.status === 404 || res.status === 400) throw Object.assign(new Error(`HTTP ${res.status}`), { final: true });
        throw new Error(`HTTP ${res.status}`);
      } catch (error) {
        if (error.final || attempt >= 2) {
          stats.failed++;
          return null;
        }
        await sleep(1500 * (attempt + 1));
      }
    }
  });
}

// ---- Writing -------------------------------------------------------------------------------
const kinds = new Map();
// kind: a name and the pattern of '<trim>!<url>' its reads have (index.match).
function kind(name, pattern) {
  if (!kinds.has(name)) kinds.set(name, pattern.source);
  return name;
}
const written = new Set();
async function put(kindName, url, trim, until, data) {
  const at = Math.min(until, LAST);
  const key = `${trim}!${url}`;
  if (data == null || at <= Date.now() + 10 * 60_000 || written.has(key)) return false;
  written.add(key);
  const text = JSON.stringify({ until: at, data });
  const file = `site/${mirrorPath(url, trim)}`;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text);
  stats.written++;
  stats.bytes += text.length;
  const k = (stats.kinds[kindName] ||= { files: 0, bytes: 0 });
  k.files++;
  k.bytes += text.length;
  return true;
}

// ---- When things change: the games ------------------------------------------------------
const startOf = e => Date.parse(e?.competitions?.[0]?.date || e?.date || '') || 0;
const over = e => (e?.status?.type?.state || e?.competitions?.[0]?.status?.type?.state) === 'post';
// The first moment a list of games changes: the start of the first not over
// (one on now: already), or the next build (all over).
function nextOf(events) {
  let t = LAST;
  for (const e of events || []) if (!over(e) && startOf(e)) t = Math.min(t, startOf(e));
  return t;
}
// Each team's (and each league's) next game, from tonight's season packs;
// and each league's teams that play in it this season (a league's list of
// teams has every one ESPN knows: college football's hundreds).
const teamNext = new Map();
const teamSeen = new Map();
const leagueNext = new Map();
const teamKey = (espn, id) => `${espn.startsWith('soccer/') ? 'soccer' : espn}:${id}`;
async function readSeasons() {
  const year = new Date().getUTCFullYear();
  for (const [key, l] of Object.entries(CATALOG)) {
    if (l.data !== 'espn' || !l.espn) continue;
    let next = LAST;
    for (const y of [year - 1, year, year + 1]) {
      let pack;
      try {
        pack = JSON.parse(await readFile(`site/sports/${key}/${y}.json`, 'utf8'));
      } catch {
        continue;
      }
      const seen = teamSeen.get(key) || teamSeen.set(key, new Set()).get(key);
      for (const e of pack.events || []) {
        for (const c of e.competitions?.[0]?.competitors || []) seen.add(String(c.id ?? c.team?.id));
        if (over(e) || !startOf(e)) continue;
        next = Math.min(next, startOf(e));
        for (const c of e.competitions?.[0]?.competitors || []) {
          const k = teamKey(l.espn, c.id ?? c.team?.id);
          teamNext.set(k, Math.min(teamNext.get(k) ?? LAST, startOf(e)));
        }
      }
    }
    leagueNext.set(key, next);
  }
}
const untilTeam = (espn, id) => teamNext.get(teamKey(espn, id)) ?? LAST;

// ---- Dates (the apps' days are Taiwan's) ------------------------------------------------
const taiwanDay = ms => new Date(ms + 8 * HOUR).toISOString().slice(0, 10).replace(/-/g, '');
const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => taiwanDay(NOW + (from + i) * 86_400_000));
const months = () => [...new Set([-35, -1, 0, 20, 40, 60].map(d => taiwanDay(NOW + d * 86_400_000).slice(0, 6)))];

// ---- Each kind ------------------------------------------------------------------------------
const ESPN_LEAGUES = Object.entries(CATALOG).filter(([, l]) => l.data === 'espn' && l.espn);
const US = new Set(['baseball', 'basketball', 'football', 'hockey']);
const finished = new Map(); // espn → [event ids over in the last days]

async function dayPages(key, l) {
  const k = kind('days', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/scoreboard\?dates=\d{8}(&limit=200)?$/);
  await Promise.all(
    days(-7, 7).map(async d => {
      const url = `${SITE}/${l.espn}/scoreboard?dates=${d}&limit=200`;
      const data = await get(url);
      if (!data) return;
      const until = nextOf(data.events);
      const s = slim(data);
      await put(k, url, '', until, s);
      // Quadra Play's settling reads the plain one (fewer than ESPN's default page: the same games).
      if ((data.events || []).length < 50) await put(k, `${SITE}/${l.espn}/scoreboard?dates=${d}`, '', until, s);
      if (d < taiwanDay(NOW + 86_400_000)) (finished.get(l.espn) || finished.set(l.espn, []).get(l.espn)).push(...(data.events || []).filter(over).map(e => String(e.id)));
    })
  );
}
async function monthPages(key, l) {
  const k = kind('months', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/scoreboard\?dates=\d{6}(&limit=1000)?$/);
  await Promise.all(
    months().flatMap(m =>
      [`${SITE}/${l.espn}/scoreboard?dates=${m}`, `${SITE}/${l.espn}/scoreboard?dates=${m}&limit=1000`].map(async url => {
        const data = await get(url);
        if (data) await put(k, url, '', nextOf(data.events), slim(data));
      })
    )
  );
}
async function boxScores(key, l) {
  const k = kind('games', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/summary\?event=\d+$/);
  await Promise.all(
    [...new Set(finished.get(l.espn) || [])].map(async id => {
      const url = `${SITE}/${l.espn}/summary?event=${id}`;
      const data = await get(url);
      if (data && over(data.header?.competitions?.[0] ? { status: data.header.competitions[0].status } : null)) await put(k, url, '', LAST, slim(data));
    })
  );
}
async function tables(key, l) {
  const k = kind('tables', /^!https:\/\/site\.api\.espn\.com\/apis\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/standings(\?(seasontype=2|season=\d{4}))?$/);
  const until = leagueNext.get(key) ?? LAST;
  const base = `${STANDINGS}/${l.espn}/standings`;
  const now = await get(base);
  if (now) await put(k, base, '', until, slim(now));
  if (US.has(l.espn.split('/')[0])) {
    const regular = await get(`${base}?seasontype=2`);
    if (regular) await put(k, `${base}?seasontype=2`, '', until, slim(regular));
  }
  const year = Number(now?.seasons?.[0]?.year ?? now?.season?.year ?? now?.children?.[0]?.standings?.season);
  if (year > 2000) {
    const before = await get(`${base}?season=${year - 1}`);
    if (before) await put(k, `${base}?season=${year - 1}`, '', LAST, slim(before));
  }
}
// Quadra Play's players: a league's season numbers (every page; last season's too).
async function seasonNumbers(key, l) {
  if (l.espn.startsWith('soccer/') || l.espn.startsWith('racing/')) return;
  const k = kind('numbers', /^espn-athletes!https:\/\/site\.api\.espn\.com\/apis\/common\/v3\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/statistics\/byathlete\?/);
  const url = (season, page) => `${COMMON}/${l.espn}/statistics/byathlete?limit=1000&isqualified=false&seasontype=2${season ? `&season=${season}` : ''}${page > 1 ? `&page=${page}` : ''}`;
  const first = await get(url(null, 1));
  if (!first) return;
  const year = Number(first.requestedSeason?.year);
  for (const [season, until] of [[null, leagueNext.get(key) ?? LAST], ...(year > 2000 ? [[year - 1, LAST]] : [])]) {
    const one = season ? await get(url(season, 1)) : first;
    if (!one) continue;
    const pages = Math.min(3, Number(one.pagination?.pages) || 1);
    await put(k, url(season, 1), 'espn-athletes', until, trimEspnAthletes(one));
    for (let p = 2; p <= pages; p++) {
      const more = await get(url(season, p));
      if (more) await put(k, url(season, p), 'espn-athletes', until, trimEspnAthletes(more));
    }
  }
}
// A league's teams, each team's page, games and squad; its players for later.
const players = []; // [[league espn, athlete id, until]…] per league, for the round after
async function teams(key, l) {
  const kTeams = kind('teams', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/teams\?limit=1000$/);
  const kTeam = kind('team', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/teams\/\d+(\/schedule(\?(seasontype=2|fixture=true))?)?$/);
  const kSquad = kind('squads', /^(espn-roster)?!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/teams\/\d+\/roster$/);
  const list = await get(`${SITE}/${l.espn}/teams?limit=1000`);
  if (!list) return;
  await put(kTeams, `${SITE}/${l.espn}/teams?limit=1000`, '', LAST, slim(list));
  const seen = teamSeen.get(key);
  const ids = (list.sports?.[0]?.leagues?.[0]?.teams || []).map(t => String(t.team?.id ?? '')).filter(id => id && (!seen?.size || seen.has(id)));
  const soccer = l.espn.startsWith('soccer/');
  const club = soccer ? 'soccer/all' : l.espn;
  const mine = [];
  await Promise.all(
    ids.map(async id => {
      if (untilTeam(l.espn, id) <= Date.now() + 10 * 60_000) return;
      const page = `${SITE}/${club}/teams/${id}`;
      const sched = `${SITE}/${club}/teams/${id}/schedule`;
      const squad = `${SITE}/${l.espn}/teams/${id}/roster`;
      const [p, s, r, f] = await Promise.all([written.has(`!${page}`) ? null : get(page), written.has(`!${sched}`) ? null : get(sched), get(squad), soccer && !written.has(`!${sched}?fixture=true`) ? get(`${sched}?fixture=true`) : null]);
      // Its next game in any competition (a cup no app follows too): from its own games.
      const until = Math.min(untilTeam(l.espn, id), nextOf(s?.events), nextOf(f?.events), ...(p?.team?.nextEvent || []).map(e => (over(e) ? LAST : Date.parse(e.date) || LAST)));
      if (p) await put(kTeam, page, '', until, slim(p));
      if (s) await put(kTeam, sched, '', until, slim(s));
      if (f) await put(kTeam, `${sched}?fixture=true`, '', until, slim(f));
      if (!soccer && s?.requestedSeason?.type === 3) {
        const reg = await get(`${sched}?seasontype=2`);
        if (reg) await put(kTeam, `${sched}?seasontype=2`, '', until, slim(reg));
      }
      if (r) {
        await put(kSquad, squad, '', until, slim(r));
        await put(kSquad, squad, 'espn-roster', until, trimEspnRoster(r));
        for (const a of (r.athletes || []).flatMap(x => (Array.isArray(x?.items) ? x.items : [x]))) if (a?.id) mine.push([l.espn, String(a.id), until]);
      }
    })
  );
  players.push(mine);
}
// Players' pages: every league's in turn, until the time for them runs out.
async function playerPages() {
  const kBio = kind('players', /^!https:\/\/site\.api\.espn\.com\/apis\/common\/v3\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/athletes\/\d+(\/overview)?$/);
  const turns = [];
  for (let i = 0; players.some(list => i < list.length); i++) for (const list of players) if (list[i]) turns.push(list[i]);
  let done = 0;
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item; (item = turns.shift()) && Date.now() < PLAYERS_BY && stats.bytes < ROOM; ) {
        const [espn, id, until] = item;
        const bio = `${COMMON}/${espn}/athletes/${id}`;
        if (written.has(`!${bio}`)) continue;
        const [a, o] = await Promise.all([get(bio), get(`${bio}/overview`)]);
        if (a) await put(kBio, bio, '', until, slim(a, ['athlete']));
        if (o) await put(kBio, `${bio}/overview`, '', until, slim(o, ['statistics', 'gameLog', 'rotowire', 'awards', 'seasonRankings', 'nextGame']));
        done++;
      }
    })
  );
  return { done, left: turns.length, why: Date.now() >= PLAYERS_BY ? 'time' : 'room' };
}
// F1: Jolpica's calendar, drivers and every result; formula1.com's pages.
async function f1() {
  const k = kind('f1', /^!https:\/\/(api\.jolpi\.ca\/ergast\/f1\/|www\.formula1\.com\/en\/(drivers|teams)\/)/);
  const until = leagueNext.get('f1') ?? LAST;
  const year = new Date(NOW).getUTCFullYear();
  const keep = async (url, at = until) => {
    const data = await get(url);
    if (data) await put(k, url, '', at, data);
    return data;
  };
  const sched = await keep(`${JOLPICA}/${year}.json?limit=40`);
  const drivers = await keep(`${JOLPICA}/${year}/drivers.json?limit=60`);
  const teamsList = await get(`${JOLPICA}/${year}/constructors.json?limit=40`);
  const ids = [...(drivers?.MRData?.DriverTable?.Drivers || []).map(d => ['drivers', d.driverId]), ...(teamsList?.MRData?.ConstructorTable?.Constructors || []).map(c => ['constructors', c.constructorId])];
  await Promise.all(ids.flatMap(([kindOf, id]) => [keep(`${JOLPICA}/${year}/${kindOf}/${id}/results.json?limit=100`), keep(`${JOLPICA}/${year}/${kindOf}/${id}/sprint.json?limit=100`)]));
  const past = (sched?.MRData?.RaceTable?.Races || []).filter(r => Date.parse(`${r.date}T${r.time || '00:00:00Z'}`) < NOW);
  await Promise.all(past.flatMap(r => [keep(`${JOLPICA}/${year}/${r.round}/results.json?limit=40`, LAST), keep(`${JOLPICA}/${year}/${r.round}/qualifying.json?limit=40`, LAST), ...(r.Sprint ? [keep(`${JOLPICA}/${year}/${r.round}/sprint.json?limit=40`, LAST)] : [])]));
  const pages = [...Object.values(F1_PAGE).map(p => ['drivers', p]), ...Object.values(F1_TEAMS).map(t => ['teams', t.page])].filter(([, p]) => p);
  await Promise.all(
    pages.map(async ([kindOf, slug]) => {
      const url = `${F1}/${kindOf}/${slug}`;
      const html = await get(url, { text: true });
      if (html) await put(k, url, '', until, trimF1Page(html));
    })
  );
}
// Asia's baseball months (the proxy's own route, made here the same way).
async function asia() {
  const k = kind('asia', /^!https:\/\/asia-baseball\.quadra\/[a-z]+\/\d{4}-\d{2}\.json$/);
  const now = asiaMonthOf(NOW);
  const [y, m] = now.split('-').map(Number);
  const list = [-2, -1, 0, 1].map(d => new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7));
  await Promise.all(
    Object.entries(CATALOG)
      .filter(([, l]) => l.asia)
      .flatMap(([, l]) =>
        list.map(ym =>
          slot(async () => {
            const url = asiaMonthUrl(l.asia, ym);
            try {
              const res = await asiaBaseballResponse(new URL(url));
              if (res.status !== 200) return;
              const data = await res.json();
              if (!data.games?.length) return;
              const until = Math.min(LAST, ...data.games.filter(g => g.state !== 'post' && g.state !== 'void').map(g => Date.parse(g.start) || LAST));
              await put(k, url, '', until, data);
            } catch {}
          })
        )
      )
  );
}

// A league's own photos (this season's team; ESPN's can be a year old): its
// players' names and ids, for the kit's ownPhoto. NBA.com's players page
// carries its whole list.
async function leaguePhotos() {
  const html = await get('https://www.nba.com/players', { text: true });
  const players = [...String(html || '').matchAll(/"PERSON_ID":(\d+),"PLAYER_LAST_NAME":"([^"]*)","PLAYER_FIRST_NAME":"([^"]*)"/g)].map(([, id, last, first]) => [`${first} ${last}`.trim(), Number(id)]);
  if (players.length < 300) return console.log(`nba photos: left out (${players.length} players)`);
  await mkdir('site/sports/nba', { recursive: true });
  await writeFile('site/sports/nba/photos.json', JSON.stringify({ built: NOW, players }));
  console.log(`nba photos: ${players.length} players`);
}

async function main() {
  await readSeasons();
  await leaguePhotos();
  const t0 = Date.now();
  const leagueQueue = [...ESPN_LEAGUES];
  await Promise.all(
    [0, 1, 2].map(async () => {
      for (let item; (item = leagueQueue.shift()); ) {
        const [key, l] = item;
        const t = Date.now();
        await Promise.all([dayPages(key, l).then(() => boxScores(key, l)), monthPages(key, l), tables(key, l), seasonNumbers(key, l), teams(key, l)]);
        console.log(`${key}: ${((Date.now() - t) / 1000).toFixed(0)} s`);
      }
    })
  );
  await Promise.all([f1(), asia()]);
  console.log(`leagues ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  const p = await playerPages();
  console.log(`players: ${p.done} pages${p.left ? `, ${p.left} left for lack of ${p.why}` : ''}`);
  const index = { built: NOW, until: LAST, match: [...kinds.values()], counts: stats };
  await mkdir('site/mirror', { recursive: true });
  await writeFile('site/mirror/index.json', JSON.stringify(index));
  console.log(`mirror: ${stats.written} copies, ${(stats.bytes / 1e6).toFixed(1)} MB; ${stats.asked} asked, ${stats.failed} failed; ${((Date.now() - NOW) / 60_000).toFixed(1)} min`);
  for (const [name, v] of Object.entries(stats.kinds)) console.log(`  ${name}: ${v.files} files, ${(v.bytes / 1e6).toFixed(1)} MB`);
  // Most of it unread: something's wrong (ESPN down); the build fails and the last site stays.
  if (stats.written < 100) process.exit(1);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

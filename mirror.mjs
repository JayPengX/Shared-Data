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
//   - a game that's over, its box score, a past day of them: until the next
//     build (carried over from the last published site, ESPN asked only
//     for what's newly over)
//   - before a season's regular season, last season's playoffs (MLB, NBA,
//     MLS: Sports' bracket): carried over the same way, none once it's on
//   - last season's players' numbers (Play) only while this one is young
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
// Orbit Sports' leagues (its broadcast list: what it shows). Its own reads
// (a team's page and games, the plain squad, players' pages) are made for
// these only; every league is Play's (its tables, squads trimmed, numbers,
// days, months, box scores). Without the file, every league as Sports'.
const SPORTS_LIB = resolve(process.env.SPORTS_LIB || '../Orbit-Sports/public/lib');
const SPORTS = await import(pathToFileURL(`${SPORTS_LIB}/broadcast.mjs`).href)
  .then(m => new Set(Object.keys(m.BROADCAST)))
  .catch(() => null);
const forSports = key => !SPORTS || SPORTS.has(key);

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
export const stats = { asked: 0, failed: 0, written: 0, bytes: 0, kinds: {} };
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
const teamLast = new Map();
const teamSeen = new Map();
const leagueNext = new Map();
const teamKey = (espn, id) => `${espn.startsWith('soccer/') ? 'soccer' : espn}:${id}`;
export async function readSeasons() {
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
        if (startOf(e) && startOf(e) <= NOW)
          for (const c of e.competitions?.[0]?.competitors || []) {
            const k = teamKey(l.espn, c.id ?? c.team?.id);
            teamLast.set(k, Math.max(teamLast.get(k) ?? 0, startOf(e)));
          }
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

// What's over doesn't change (a game, a day of them): its copy as last
// published is carried over (a Pages deploy replaces the whole site), ESPN
// asked only for what's new.
const PUBLISHED = 'https://jaypengx.github.io/Shared-Data/';
function published(url, trim = '') {
  return slot(async () => {
    try {
      const res = await fetch(`${PUBLISHED}${mirrorPath(url, trim)}`, { signal: AbortSignal.timeout(15_000) });
      return res.ok ? ((await res.json())?.data ?? null) : null;
    } catch {
      return null;
    }
  });
}
const allOver = data => (data?.events || []).every(over);
// A team quiet since the last build (its last game started before that
// build's read less 5 hours: over by then): its squad, page and players'
// pages are as published. Each is still read again every few nights (a
// signing, a trade, an injury list), the teams spread over the nights.
export let lastBuilt = 0;
export const setLastBuilt = t => (lastBuilt = t);
const nightNo = Math.floor(NOW / 86_400_000);
const stagger = (id, every) => [...String(id)].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % every === nightNo % every;
const quiet = (espn, id) => lastBuilt > 0 && (teamLast.get(teamKey(espn, id)) ?? 0) < lastBuilt - 5 * HOUR;
const carry = kindName => {
  const c = (stats.carriedKinds ||= {});
  c[kindName] = (c[kindName] || 0) + 1;
};
// The published copy of `url` (with `trim`) put again, or null when there is none.
async function carried(kindName, url, trim, until) {
  const kept = await published(url, trim);
  if (kept == null) return null;
  if (await put(kindName, url, trim, until, kept)) carry(kindName);
  return kept;
}
async function dayPages(key, l) {
  const k = kind('days', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/scoreboard\?dates=\d{8}(&limit=200)?$/);
  await Promise.all(
    days(-7, 7).map(async d => {
      const url = `${SITE}/${l.espn}/scoreboard?dates=${d}&limit=200`;
      // A day before yesterday with every game over: as published.
      const kept = d < taiwanDay(NOW - 86_400_000) ? await published(url) : null;
      const data = kept && allOver(kept) ? (stats.carried = (stats.carried || 0) + 1, kept) : await get(url);
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
        // A month over (every game in it): as published.
        const kept = m < taiwanDay(NOW).slice(0, 6) ? await published(url) : null;
        const data = kept && allOver(kept) ? (carry(k), kept) : await get(url);
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
      const kept = await published(url);
      if (kept && over(kept.header?.competitions?.[0] ? { status: kept.header.competitions[0].status } : null)) {
        stats.carried = (stats.carried || 0) + 1;
        return put(k, url, '', LAST, kept);
      }
      const data = await get(url);
      if (data && over(data.header?.competitions?.[0] ? { status: data.header.competitions[0].status } : null)) await put(k, url, '', LAST, slim(data));
    })
  );
}
// Sports' bracket before a season's regular season (Orbit Sports' app.js
// lastSeason, for its FORMATS' leagues that aren't cups): last season's
// calendar, then its game days a week at a time from its end back to a
// week without playoff games. Over, so as published once read; none once
// the regular season is on.
const BRACKETS = new Set(['mlb', 'nba', 'mls']);
const ymd = ms => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
export function phaseOf(type = {}) {
  const name = `${type.name || ''} ${type.abbreviation || ''}`;
  return type.type === 3 || /post|playoff|final|knockout/i.test(name) ? 'post' : type.type === 2 || /regular|league phase|group/i.test(name) ? 'regular' : type.type === 1 || /^\s*pre/i.test(name) ? 'pre' : type.type === 4 || /off/i.test(name) ? 'off' : '';
}
// A season's game days (Orbit Sports' parseCalendar): ESPN's list, or every day but those listed.
export function calendarDays(data) {
  const L = data?.leagues?.[0];
  const cal = L?.calendar;
  if (!Array.isArray(cal) || !cal.length || typeof cal[0] === 'object') return [];
  const us = iso => String(iso).slice(0, 10).replaceAll('-', '');
  if (L.calendarIsWhitelist !== false) return cal.map(us);
  const off = new Set(cal.map(us));
  const days = [];
  for (let t = Date.parse(L.calendarStartDate), end = Date.parse(L.calendarEndDate); t <= end && days.length < 400; t += 86_400_000) if (!off.has(us(new Date(t).toISOString()))) days.push(us(new Date(t).toISOString()));
  return days;
}
const playoffGame = e => e?.season?.type === 3 || /post|playoff/i.test(e?.season?.slug || '');
export async function lastPlayoffs(key, l) {
  if (!BRACKETS.has(key)) return;
  const k = kind('days', /^!https:\/\/site\.api\.espn\.com\/apis\/site\/v2\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/scoreboard\?dates=\d{8}(&limit=200)?$/);
  const now = await get(`${SITE}/${l.espn}/scoreboard`);
  const season = now?.leagues?.[0]?.season;
  if (!['pre', 'off'].includes(phaseOf(season?.type)) || !Date.parse(season?.startDate)) return;
  const asOf = async url => {
    const kept = await published(url);
    return kept && allOver(kept) ? kept : get(url);
  };
  const calUrl = `${SITE}/${l.espn}/scoreboard?dates=${ymd(Date.parse(season.startDate) - 3 * 86_400_000)}`;
  const cal = await asOf(calUrl);
  if (!cal) return;
  await put(k, calUrl, '', LAST, slim(cal));
  const days = calendarDays(cal).slice(-90).reverse();
  const ms = d => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6));
  const today = ymd(NOW);
  for (let i = 0; i < days.length; ) {
    let j = i;
    while (j < days.length && ms(days[j]) > ms(days[i]) - 7 * 86_400_000) j++;
    const week = days.slice(i, (i = j));
    const pages = await Promise.all(week.map(async d => [`${SITE}/${l.espn}/scoreboard?dates=${d}&limit=200`, await asOf(`${SITE}/${l.espn}/scoreboard?dates=${d}&limit=200`)]));
    for (const [url, data] of pages) if (data) await put(k, url, '', LAST, slim(data));
    if (!pages.some(([, data]) => (data?.events || []).some(playoffGame)) && week[0] < today) break;
  }
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
  const read = async (season, until) => {
    const one = season ? await get(url(season, 1)) : first;
    if (!one) return [];
    const pages = [one];
    await put(k, url(season, 1), 'espn-athletes', until, trimEspnAthletes(one));
    for (let p = 2; p <= Math.min(3, Number(one.pagination?.pages) || 1); p++) {
      const more = await get(url(season, p));
      if (more) pages.push(more), await put(k, url(season, p), 'espn-athletes', until, trimEspnAthletes(more));
    }
    return pages;
  };
  const now = await read(null, leagueNext.get(key) ?? LAST);
  // Last season's, only while this one is young: Play reads it only then
  // (its 31st most-played regular under 15 games, players.mjs YOUNG_GAMES).
  if (year > 2000 && youngSeason(now)) await read(year - 1, LAST);
}
// The games each player has played this season, most first; young when the 31st has fewer than 15.
export function youngSeason(pages) {
  const gps = pages
    .flatMap(page => {
      const cats = page.categories || [];
      return (page.athletes || []).map(a => {
        for (const [ci, c] of cats.entries()) {
          const i = (c.names || []).indexOf('gamesPlayed');
          const v = Number(a.categories?.[ci]?.totals?.[i]);
          if (i >= 0 && Number.isFinite(v)) return v;
        }
        return 0;
      });
    })
    .sort((a, b) => b - a);
  return (gps[Math.min(gps.length - 1, 30)] ?? 0) < 15;
}
// A league's teams, each team's page, games and squad; its players for later.
const players = []; // [[league espn, athlete id, until]…] per league, for the round after
export async function teams(key, l) {
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
  const sports = forSports(key);
  await Promise.all(
    ids.map(async id => {
      if (untilTeam(l.espn, id) <= Date.now() + 10 * 60_000) return;
      const page = `${SITE}/${club}/teams/${id}`;
      const sched = `${SITE}/${club}/teams/${id}/schedule`;
      const squad = `${SITE}/${l.espn}/teams/${id}/roster`;
      const still = quiet(l.espn, id) && !stagger(id, 3);
      // Play's squad (trimmed), and Sports' plain one: as published while the team's quiet.
      const squadUntil = untilTeam(l.espn, id);
      let r = null;
      if (still) {
        const t = await carried(kSquad, squad, 'espn-roster', squadUntil);
        r = sports ? await carried(kSquad, squad, '', squadUntil) : t;
        if (!t || !r) r = null;
      }
      const fresh = !r;
      if (fresh) r = await get(squad);
      if (!sports) {
        if (r && fresh) await put(kSquad, squad, 'espn-roster', squadUntil, trimEspnRoster(r));
        return;
      }
      // Sports' own: the team's page (as published while quiet) and its games (always read: a kickoff moved).
      const [p, s, f] = await Promise.all([
        written.has(`!${page}`) ? null : still ? published(page).then(x => x ?? get(page)) : get(page),
        written.has(`!${sched}`) ? null : get(sched),
        soccer && !written.has(`!${sched}?fixture=true`) ? get(`${sched}?fixture=true`) : null
      ]);
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
        if (fresh) {
          await put(kSquad, squad, '', until, slim(r));
          await put(kSquad, squad, 'espn-roster', until, trimEspnRoster(r));
        }
        // Players' pages: as published while the team's quiet (each still read a night in seven).
        const team = quiet(l.espn, id);
        for (const a of (r.athletes || []).flatMap(x => (Array.isArray(x?.items) ? x.items : [x]))) if (a?.id) mine.push([l.espn, String(a.id), until, team && !stagger(a.id, 7)]);
      }
    })
  );
  players.push(mine);
}
// Players' pages: every league's in turn, until the time for them runs out.
export async function playerPages() {
  const kBio = kind('players', /^!https:\/\/site\.api\.espn\.com\/apis\/common\/v3\/sports\/[a-z0-9._-]+\/[a-z0-9._-]+\/athletes\/\d+(\/overview)?$/);
  const turns = [];
  for (let i = 0; players.some(list => i < list.length); i++) for (const list of players) if (list[i]) turns.push(list[i]);
  let done = 0;
  await Promise.all(
    Array.from({ length: AT_ONCE }, async () => {
      for (let item; (item = turns.shift()) && Date.now() < PLAYERS_BY && stats.bytes < ROOM; ) {
        const [espn, id, until, still] = item;
        const bio = `${COMMON}/${espn}/athletes/${id}`;
        if (written.has(`!${bio}`)) continue;
        if (still && (await carried(kBio, bio, '', until)) && (await carried(kBio, `${bio}/overview`, '', until))) {
          done++;
          continue;
        }
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
  // NBA.com answers a player it has no photo of with its grey silhouette (a
  // 200, not a 404), so the app would never fall back to their initials or
  // look further: those players are left out of the list.
  const tag = async id => (await fetch(NBA_PHOTO(id), { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null))?.headers.get('etag') || '';
  const silhouette = await tag('fallback');
  if (!silhouette) return console.log('nba photos: left out (no silhouette to compare)');
  const kept = await withPhotos(players, tag, silhouette);
  if (kept.length < 300) return console.log(`nba photos: left out (${kept.length} with photos)`);
  await mkdir('site/sports/nba', { recursive: true });
  await writeFile('site/sports/nba/photos.json', JSON.stringify({ built: NOW, players: kept }));
  console.log(`nba photos: ${kept.length} of ${players.length} players have one`);
}
const NBA_PHOTO = id => `https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`;

// The Premier League's own photos (ESPN has none for footballers: its soccer
// headshots answer 404). The league's API lists this season's players with
// their Opta ids; a photo is on its current path, or its older one ('o').
// Each player under every name ESPN may use (the display name, first and
// last, with the middle name too), so the kit finds them by ESPN's.
const PL_API = 'https://footballapi.pulselive.com/football';
const PL_HEADERS = { Origin: 'https://www.premierleague.com', Referer: 'https://www.premierleague.com/', 'User-Agent': 'Mozilla/5.0 (orbit-mirror)' };
export const PL_PHOTO = (id, old) => (old ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${id}.png` : `https://resources.premierleague.com/premierleague25/photos/players/110x140/${id}.png`);
export function plNames(list, clubs = new Set()) {
  const out = [];
  for (const x of list || []) {
    const id = String(x?.altIds?.opta || '').replace(/^p/, '');
    const n = x?.name || {};
    if (!/^\d+$/.test(id) || /trialist/i.test(n.display || '')) continue;
    const full = [n.first, n.last].filter(Boolean).join(' ').trim();
    const words = full.split(/\s+/);
    const names = new Set([n.display, full, [n.first, n.middle, n.last].filter(Boolean).join(' '), words.length > 2 ? `${words[0]} ${words.at(-1)}` : ''].map(v => String(v || '').trim()).filter(Boolean));
    const here = clubs.has(x?.currentTeam?.name);
    for (const name of names) out.push([name, Number(id), here]);
  }
  // A name two players share: the one at a club in the league this season
  // (the list keeps players who've left); still two ("Gabriel"), neither: no
  // face is better than a wrong one.
  const ids = new Map();
  for (const [name, id, here] of out) {
    const k = name.toLowerCase();
    if (!ids.has(k)) ids.set(k, { all: new Set(), here: new Set() });
    ids.get(k).all.add(id);
    if (here) ids.get(k).here.add(id);
  }
  const pick = k => (ids.get(k).all.size === 1 ? [...ids.get(k).all][0] : ids.get(k).here.size === 1 ? [...ids.get(k).here][0] : null);
  const seen = new Set();
  return out.filter(([name, id]) => pick(name.toLowerCase()) === id && !seen.has(`${name}|${id}`) && seen.add(`${name}|${id}`)).map(([name, id]) => [name, id]);
}
async function plJson(path) {
  const res = await fetch(`${PL_API}${path}`, { headers: PL_HEADERS, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return res?.ok ? res.json() : null;
}
export async function plPhotos() {
  const season = (await plJson('/competitions/1/compseasons?page=0&pageSize=1'))?.content?.[0]?.id;
  if (!season) return console.log('epl photos: left out (no season)');
  // Each club's squad this season (the league's paged list of players stops short of its own count).
  const teams = (await plJson(`/teams?pageSize=40&compSeasons=${season}&comps=1&page=0`))?.content || [];
  if (teams.length < 18) return console.log(`epl photos: left out (${teams.length} clubs)`);
  const squads = await Promise.all(teams.map(t => plJson(`/teams/${Number(t.id)}/compseasons/${season}/staff?pageSize=100&altIds=true&type=player`)));
  if (squads.some(x => !x?.players)) return console.log('epl photos: left out (a squad failed)');
  const all = squads.flatMap((x, i) => x.players.map(p => ({ ...p, currentTeam: { name: teams[i].name } })));
  const named = plNames(all, new Set(teams.map(t => t.name)));
  const ids = [...new Set(named.map(([, id]) => id))];
  const status = async u => (await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null))?.status || 0;
  // Which path has each photo: 'n' (current), 'o' (older), '' none; a failed read (0) keeps the current.
  const where = new Map();
  let next = 0;
  await Promise.all(
    Array.from({ length: 16 }, async () => {
      while (next < ids.length) {
        const id = ids[next++];
        const now = await status(PL_PHOTO(id));
        where.set(id, now === 200 || now === 0 ? 'n' : (await status(PL_PHOTO(id, true))) === 200 ? 'o' : '');
      }
    })
  );
  const players = named.filter(([, id]) => where.get(id)).map(([name, id]) => (where.get(id) === 'o' ? [name, id, 'o'] : [name, id]));
  if (ids.length < 400) return console.log(`epl photos: left out (${ids.length} players)`);
  await mkdir('site/sports/epl', { recursive: true });
  await writeFile('site/sports/epl/photos.json', JSON.stringify({ built: NOW, players }));
  console.log(`epl photos: ${[...where.values()].filter(Boolean).length} of ${ids.length} players have one`);
}
// The players whose photo isn't the silhouette. A failed read (no tag) keeps
// the player: a photo that may be there isn't dropped for a failed read.
export async function withPhotos(players, tag, silhouette, at = 16) {
  const out = new Array(players.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: at }, async () => {
      while (next < players.length) {
        const i = next++;
        out[i] = (await tag(players[i][1])) !== silhouette;
      }
    })
  );
  return players.filter((_, i) => out[i]);
}

async function main() {
  // When the published copies were read (none: everything read afresh).
  lastBuilt = Number((await fetch(`${PUBLISHED}mirror/index.json`, { signal: AbortSignal.timeout(15_000) }).then(r => (r.ok ? r.json() : null)).catch(() => null))?.built) || 0;
  await readSeasons();
  await leaguePhotos();
  await plPhotos();
  const t0 = Date.now();
  const leagueQueue = [...ESPN_LEAGUES];
  await Promise.all(
    [0, 1, 2].map(async () => {
      for (let item; (item = leagueQueue.shift()); ) {
        const [key, l] = item;
        const t = Date.now();
        await Promise.all([dayPages(key, l).then(() => boxScores(key, l)), monthPages(key, l), tables(key, l), seasonNumbers(key, l), teams(key, l), lastPlayoffs(key, l)]);
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
  console.log(`  carried as published: ${JSON.stringify({ days: stats.carried || 0, ...(stats.carriedKinds || {}) })}`);
  for (const [name, v] of Object.entries(stats.kinds)) console.log(`  ${name}: ${v.files} files, ${(v.bytes / 1e6).toFixed(1)} MB`);
  // Most of it unread: something's wrong (ESPN down); the build fails and the last site stays.
  if (stats.written < 100) process.exit(1);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

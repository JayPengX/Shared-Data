// Every league's season from ESPN, built each night at midnight (Taiwan
// time) and published on GitHub Pages beside the bus packs, for Orbit Sports
// and Quadra Play: a season's games come from here, not through the data
// proxy (a season's page is 6 MB: a few at once ran the proxy out of memory,
// and parsing them froze the phone). Only what's live (today's scores, a
// game on now) is still asked of the proxy.
//
//   node sports.mjs [league …]     (KIT: the shared kit's folder, ../Shared-Proxy/kit by default)
//
// → site/sports/<league>/<year>.json: ESPN's scoreboard as the apps read it
// ({ leagues: [the league, its calendar], events }), the whole year from its
// month pages (ESPN's year page stops at 500 games: MLS, the NBA), without
// what no app reads of it (links, logo variants, odds, leaders…); and
// site/sports/index.json ({ built, leagues: { key: { espn, years: { year:
// { events, bytes } } } } }).
//
// A league-year with a month that can't be read isn't written: the apps ask
// the proxy for it as before. The months over (all their games too) are
// carried from last night's pack, not read from ESPN again.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const { CATALOG } = await import(pathToFileURL(`${KIT}/catalog.mjs`).href);
const SITE = 'https://site.api.espn.com/apis/site/v2/sports';
const only = process.argv.slice(2).filter(a => !a.startsWith('--'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

// What no app reads of a scoreboard (the heavy part of it).
const DROP = new Set(['links', 'logos', 'leaders', 'statistics', 'headlines', 'odds', 'tickets', 'geoBroadcasts', 'uid', '$ref', 'guid', 'format', 'situation', 'recent', 'alternateIds', 'playByPlayAvailable', 'wasSuspended', 'highlights']);
export function slim(x) {
  if (Array.isArray(x)) return x.map(slim);
  if (!x || typeof x !== 'object') return x;
  const out = {};
  for (const [k, v] of Object.entries(x)) if (!DROP.has(k)) out[k] = slim(v);
  // A team's logo kept as the one the apps use (logo, else the first of logos).
  if (!out.logo && Array.isArray(x.logos) && x.logos[0]?.href) out.logo = x.logos[0].href;
  return out;
}

async function page(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (orbit-sports-pack)' }, signal: AbortSignal.timeout(60_000) });
      if (res.status === 200) return await res.json();
      throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      if (attempt >= 3) throw new Error(`${url}: ${error.message}`);
      await sleep(2000 * (attempt + 1));
    }
  }
}

// The years a league's packs cover now: this one and the next; and the last
// only while the league's season began in it (the NBA's, Europe's football's
// until summer: Sports counts a matchweek from the season's start). `start`:
// the season's start (ESPN's scoreboard), unknown → until July as before.
export function yearsAt(now = new Date(), start = NaN) {
  const y = now.getUTCFullYear();
  const last = Number.isFinite(start) ? start < Date.UTC(y, 0, 1) : now.getUTCMonth() < 6;
  return [...(last ? [y - 1] : []), y, y + 1];
}

// Last night's pack, as published: its months over are carried, not read again.
const PUBLISHED = process.env.PUBLISHED || 'https://jaypengx.github.io/Shared-Data/';
async function publishedPack(key, year) {
  try {
    const res = await fetch(`${PUBLISHED}sports/${key}/${year}.json`, { signal: AbortSignal.timeout(60_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
// The first month (1-12) to read again: the one ten days back, or an earlier
// one with a game not over (put back, or yet to be played). 1 without a pack.
const DAY = 86_400_000;
export function firstUnsettled(old, year, now = Date.now()) {
  if (!old?.events) return 1;
  const recent = new Date(now - 10 * DAY);
  let first = recent.getUTCFullYear() > year ? 13 : recent.getUTCFullYear() < year ? 1 : recent.getUTCMonth() + 1;
  for (const e of old.events) {
    const state = e.status?.type?.state || e.competitions?.[0]?.status?.type?.state;
    const d = new Date(e.date);
    if (state !== 'post' && d.getUTCFullYear() === year) first = Math.min(first, d.getUTCMonth() + 1);
  }
  return first;
}

async function leagueYear(espn, year, old = null) {
  const head = await page(`${SITE}/${espn}/scoreboard?dates=${year}&limit=1`);
  const seen = new Map();
  const from = firstUnsettled(old, year);
  for (let m = from; m <= 12; m++) {
    const data = await page(`${SITE}/${espn}/scoreboard?dates=${year}${String(m).padStart(2, '0')}&limit=1000`);
    for (const e of data.events || []) if (!seen.has(e.id)) seen.set(e.id, slim(e));
  }
  // The months before, as last night (a day's grace past the first month read:
  // a late game there is on its US day's page, the month before's).
  const carryTo = from > 12 ? Infinity : Date.UTC(year, from - 1, 2);
  let carried = 0;
  if (from > 1) for (const e of old.events) if (!seen.has(e.id) && Date.parse(e.date) < carryTo) seen.set(e.id, e), carried++;
  const events = [...seen.values()].filter(e => String(e.date || '').startsWith(String(year)) || !e.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { leagues: slim((head.leagues || []).slice(0, 1)), events, carried, read: Math.max(0, 13 - from) };
}

// This season's game days as Taipei dates ('YYYY-MM-DD'), from its start
// (ESPN's season start; unknown: every day given); a game called off left out.
export function seasonDays(events, start = NaN) {
  const from = Number.isFinite(start) ? start - DAY : -Infinity;
  const days = new Set();
  for (const e of events) {
    const t = Date.parse(e.date || '');
    const state = e.status?.type || e.competitions?.[0]?.status?.type || {};
    if (!Number.isFinite(t) || t < from || /postponed|canceled|cancelled|abandoned/i.test(state.name || state.description || '')) continue;
    days.add(new Date(t + 8 * 3_600_000).toISOString().slice(0, 10));
  }
  return [...days].sort();
}

async function main() {
  const leagues = Object.entries(CATALOG).filter(([key, l]) => l.data === 'espn' && l.espn && (!only.length || only.includes(key)));
  const index = { built: new Date().toISOString(), leagues: {} };
  const failed = [];
  // Two leagues at a time (ESPN turns a burst away).
  const queue = [...leagues];
  await Promise.all(
    [0, 1].map(async () => {
      for (let item; (item = queue.shift()); ) {
        const [key, l] = item;
        const entry = (index.leagues[key] = { espn: l.espn, years: {} });
        const all = [];
        const start = Date.parse((await page(`${SITE}/${l.espn}/scoreboard?limit=1`).catch(() => null))?.leagues?.[0]?.season?.startDate || '');
        for (const year of yearsAt(new Date(), start)) {
          try {
            const { carried, read, ...pack } = await leagueYear(l.espn, year, await publishedPack(key, year));
            const text = JSON.stringify(pack);
            await mkdir(`site/sports/${key}`, { recursive: true });
            await writeFile(`site/sports/${key}/${year}.json`, text);
            entry.years[year] = { events: pack.events.length, bytes: text.length };
            all.push(...pack.events);
            console.log(`${key} ${year}: ${pack.events.length} events (${carried} carried, ${read} months read), ${(text.length / 1e6).toFixed(2)} MB`);
          } catch (error) {
            failed.push(`${key} ${year}`);
            console.log(`${key} ${year}: left out (${error.message})`);
          }
        }
        // The season's game days, small, for the apps' date strips (the year
        // packs are calendar years, a few MB each: a season over two of them).
        const days = seasonDays(all, start);
        if (days.length) await writeFile(`site/sports/${key}/days.json`, JSON.stringify({ built: index.built, start: Number.isFinite(start) ? new Date(start).toISOString() : null, days }));
      }
    })
  );
  await mkdir('site/sports', { recursive: true });
  await writeFile('site/sports/index.json', JSON.stringify(index));
  if (failed.length) console.log(`left out: ${failed.join(', ')}`);
  // Most of it missing: something's wrong (ESPN down), the build fails and the last site stays.
  if (failed.length > leagues.length) process.exit(1);
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

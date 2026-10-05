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
// the proxy for it as before.
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
// until July (a season that began last autumn: the NBA, Europe's football).
export function yearsAt(now = new Date()) {
  const y = now.getUTCFullYear();
  return [...(now.getUTCMonth() < 6 ? [y - 1] : []), y, y + 1];
}

async function leagueYear(espn, year) {
  const head = await page(`${SITE}/${espn}/scoreboard?dates=${year}&limit=1`);
  const seen = new Map();
  for (let m = 1; m <= 12; m++) {
    const data = await page(`${SITE}/${espn}/scoreboard?dates=${year}${String(m).padStart(2, '0')}&limit=1000`);
    for (const e of data.events || []) if (!seen.has(e.id)) seen.set(e.id, e);
  }
  const events = [...seen.values()].filter(e => String(e.date || '').startsWith(String(year)) || !e.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { leagues: slim((head.leagues || []).slice(0, 1)), events: slim(events) };
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
        for (const year of yearsAt()) {
          try {
            const pack = await leagueYear(l.espn, year);
            const text = JSON.stringify(pack);
            await mkdir(`site/sports/${key}`, { recursive: true });
            await writeFile(`site/sports/${key}/${year}.json`, text);
            entry.years[year] = { events: pack.events.length, bytes: text.length };
            console.log(`${key} ${year}: ${pack.events.length} events, ${(text.length / 1e6).toFixed(2)} MB`);
          } catch (error) {
            failed.push(`${key} ${year}`);
            console.log(`${key} ${year}: left out (${error.message})`);
          }
        }
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

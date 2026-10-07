// CPBL's table as the league publishes it (cpbl.com.tw/standings/season: the
// half-season on now, 上半季 or 下半季), built each night after the night's
// games, for Orbit Sports' 排名 tab and its match sheets. ESPN has no CPBL,
// and a table counted from the games the apps can read would be wrong (the
// league's own lists stopped answering; TheSportsDB's give a few months).
//
//   node cpbl.mjs        (KIT: the shared kit's folder, ../Shared-Proxy/kit by default)
//
// → site/sports/cpbl/standings.json: { built, title ('2026年 下半季'), year,
// half ('first' | 'second' | ''), rows: [{ rank, en, zh, gp, w, t, l, pct,
// gb, magic, home, away, streak, last10 }] }. A night it can't be read, last
// night's is carried (never an empty table).
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const { CPBL_CLUBS } = await import(pathToFileURL(`${KIT}/catalog.mjs`).href);
const PAGE = 'https://www.cpbl.com.tw/standings/season';
const PUBLISHED = 'https://jaypengx.github.io/Shared-Data/sports/cpbl/standings.json';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const text = s =>
  String(s || '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
// The page's table (its first, 球隊對戰戰績): a row a club, its cells in the
// order of the header (排名・球隊, 出賽數, 勝-和-敗, 勝率, 勝差, 淘汰指數,
// one for each club against it, 主場戰績, 客場戰績, 連勝/連敗, 近十場戰績).
export function parseStandings(html) {
  const s = String(html || '');
  const title = text(/<h3>([\s\S]*?)<\/h3>/.exec(s.slice(s.indexOf('DistTitle')))?.[1] || '');
  const table = /<div class="RecordTable">([\s\S]*?)<\/table>/.exec(s)?.[1] || '';
  const [head, ...rows] = table.split(/<tr>/).slice(1);
  const cols = [...(head || '').matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => text(m[1]));
  const at = name => cols.findIndex(c => c.includes(name));
  const byZh = Object.fromEntries(CPBL_CLUBS.map(([en, zh]) => [zh, en]));
  const out = [];
  for (const r of rows) {
    const cells = [...r.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => m[1]);
    if (cells.length < 6) continue;
    const zh = text(/<a[^>]*>([\s\S]*?)<\/a>/.exec(cells[0])?.[1] || '');
    const rank = Number(text(/class="rank">([\s\S]*?)<\/div>/.exec(cells[0])?.[1])) || out.length + 1;
    const cell = name => (at(name) >= 0 ? text(cells[at(name)]) : '');
    const [w, t, l] = cell('勝-和-敗').split('-').map(Number);
    if (!zh || ![w, t, l].every(Number.isFinite)) continue;
    out.push({ rank, en: byZh[zh] || zh, zh, gp: Number(cell('出賽數')) || w + t + l, w, t, l, pct: cell('勝率'), gb: cell('勝差') || '-', magic: cell('淘汰指數'), home: cell('主場'), away: cell('客場'), streak: cell('連勝'), last10: cell('近十場') });
  }
  const year = Number(/(\d{4})年/.exec(title)?.[1]) || null;
  const half = /上半季/.test(title) ? 'first' : /下半季/.test(title) ? 'second' : '';
  return { title, year, half, rows: out };
}

// The page, past its CDN's first answer (a 308 to itself that sets a cookie).
async function page() {
  let cookie = '';
  for (let i = 0; i < 4; i++) {
    const res = await fetch(PAGE, { headers: { 'User-Agent': UA, 'Accept-Language': 'zh-TW,zh;q=0.9', ...(cookie ? { Cookie: cookie } : {}) }, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    const set = (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).filter(Boolean);
    if (set.length) cookie = [...new Set([...cookie.split('; ').filter(Boolean), ...set])].join('; ');
    if (res.status === 200) return res.text();
    if (res.status < 300 || res.status >= 400) throw new Error(`HTTP ${res.status}`);
  }
  throw new Error('redirected too often');
}

async function main() {
  let pack = null;
  try {
    const got = parseStandings(await page());
    if (got.rows.length < 4) throw new Error(`${got.rows.length} rows`);
    pack = { built: new Date().toISOString(), ...got };
    console.log(`cpbl standings: ${pack.title}, ${pack.rows.map(r => `${r.zh} ${r.w}-${r.t}-${r.l}`).join(', ')}`);
  } catch (error) {
    console.log(`cpbl standings: not read (${error.message}), last night's carried`);
    pack = await fetch(PUBLISHED, { signal: AbortSignal.timeout(20_000) })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  if (!pack) return console.log('cpbl standings: none to write');
  await mkdir('site/sports/cpbl', { recursive: true });
  await writeFile('site/sports/cpbl/standings.json', JSON.stringify(pack));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

// CPBL's tables, built each night after the night's games, for Orbit Sports'
// 排名 tab and its match sheets: the half on now, the other half and the
// whole year (上半季, 下半季, 全年). ESPN has no CPBL, and a table counted
// from the games the apps can read would be wrong (the league's own lists
// stopped answering; TheSportsDB's give a few months).
//
// From the league's own page (cpbl.com.tw/standings/season: the half on now,
// with home, away, streak and last ten) where it can be read (its CDN turns
// away cloud addresses: GitHub's runners get a 404), and from the season's
// Wikipedia page (中華職棒37年: all three, kept to the day by its editors,
// the same numbers) for the rest.
//
//   node cpbl.mjs        (KIT: the shared kit's folder, ../Shared-Proxy/kit by default)
//
// → site/sports/cpbl/standings.json: { built, year, half (the one on now:
// 'first' | 'second'), source, tables: [{ key ('first' | 'second' | 'year'),
// title, rows: [{ rank, en, zh, gp, w, t, l, pct, gb, magic, home?, away?,
// streak?, last10? }] }] }, the half on now first. A night nothing can be
// read, last night's is carried (never an empty table).
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const KIT = resolve(process.env.KIT || '../Shared-Proxy/kit');
const { CPBL_CLUBS } = await import(pathToFileURL(`${KIT}/catalog.mjs`).href);
const PAGE = 'https://www.cpbl.com.tw/standings/season';
const PUBLISHED = 'https://jaypengx.github.io/Shared-Data/sports/cpbl/standings.json';
// The season's page: 中華職棒37年 is 2026's (the league began in 1990).
const WIKI = year => `https://zh.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(`中華職棒${year - 1989}年`)}&prop=wikitext&format=json&formatversion=2`;
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

// The season page's tables (=== 上半球季 ===, === 下半球季 ===, === 全年球季 ===):
// | 1 || [[中信兄弟]] ||60||60||36||24||0||{{Winning percentage|36|24}}||–||封王
// by its header (排名, 隊伍, 應賽, 已賽, 勝場, 敗場, 和局, 勝率, 勝差, 淘汰指數).
const SECTIONS = [['first', '上半球季', '上半季'], ['second', '下半球季', '下半季'], ['year', '全年球季', '全年']];
export function parseWiki(wikitext, year) {
  const t = String(wikitext || '');
  const byZh = Object.fromEntries(CPBL_CLUBS.map(([en, zh]) => [zh, en]));
  const tables = [];
  for (const [key, head, name] of SECTIONS) {
    const at = t.search(new RegExp(`===\\s*${head}\\s*===`));
    if (at < 0) continue;
    const table = /\{\|[\s\S]*?\n\|\}/.exec(t.slice(at))?.[0] || '';
    const cols = [...table.matchAll(/^!\s*(?:[^|\n]*\|)?\s*([^\n]+)$/gm)].map(m => m[1].trim());
    const at2 = name => cols.indexOf(name);
    const rows = [];
    for (const line of table.split('\n').filter(l => /^\|\s*\d/.test(l))) {
      const cells = line.replace(/^\|/, '').split('||').map(c => c.trim());
      // The club by its link's page ([[統一7-ELEVEn獅|統一獅]]: 統一7-ELEVEn獅).
      const zh = /\[\[([^\]|]+)/.exec(cells[at2('隊伍')] || '')?.[1]?.trim() || '';
      const n = name => Number(cells[at2(name)]);
      const [w, l, tie] = [n('勝場'), n('敗場'), n('和局') || 0];
      if (!zh || !Number.isFinite(w) || !Number.isFinite(l)) continue;
      const gb = String(cells[at2('勝差')] || '').replace(/[–—-]/, '-').replace(/\.0$/, '') || '-';
      rows.push({ rank: Number(cells[0]) || rows.length + 1, en: byZh[zh] || zh, zh, gp: n('已賽') || w + l + tie, w, t: tie, l, pct: w + l ? (w / (w + l)).toFixed(3) : '0.000', gb, magic: cells[at2('淘汰指數')] || '' });
    }
    if (rows.length >= 4) tables.push({ key, title: `${year}年 ${name}`, rows });
  }
  return tables;
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

// The half on now: the official page's, else the later half Wikipedia has a
// game of (the second once it's begun).
export function combine(official, wiki, year) {
  const tables = [...wiki];
  if (official?.rows?.length >= 4 && official.half) {
    const key = official.half;
    const i = tables.findIndex(x => x.key === key);
    const own = { key, title: official.title, rows: official.rows };
    if (i >= 0) tables[i] = own;
    else tables.push(own);
  }
  if (!tables.length) return null;
  const half = official?.half || (tables.find(x => x.key === 'second' && x.rows.some(r => r.gp > 0)) ? 'second' : 'first');
  const order = [half, half === 'first' ? 'second' : 'first', 'year'];
  tables.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return { year: official?.year || year, half, tables };
}

async function main() {
  const year = new Date(Date.now() + 8 * 3_600_000).getUTCFullYear();
  const official = await page()
    .then(parseStandings)
    .catch(error => (console.log(`cpbl standings: the league's page not read (${error.message})`), null));
  const wiki = await fetch(WIKI(year), { headers: { 'User-Agent': 'Shared-Data/1.0 (https://github.com/JayPengX/Shared-Data)' }, signal: AbortSignal.timeout(20_000) })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then(d => parseWiki(d?.parse?.wikitext, year))
    .catch(error => (console.log(`cpbl standings: Wikipedia not read (${error.message})`), []));
  let pack = combine(official?.rows?.length ? official : null, wiki, year);
  if (pack) {
    pack = { built: new Date().toISOString(), source: official?.rows?.length ? 'cpbl.com.tw' : 'zh.wikipedia.org', ...pack };
    for (const x of pack.tables) console.log(`cpbl standings: ${x.title}, ${x.rows.map(r => `${r.zh} ${r.w}-${r.t}-${r.l}`).join(', ')}`);
  } else {
    console.log("cpbl standings: nothing read, last night's carried");
    pack = await fetch(PUBLISHED, { signal: AbortSignal.timeout(20_000) })
      .then(r => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  if (!pack) return console.log('cpbl standings: none to write');
  await mkdir('site/sports/cpbl', { recursive: true });
  await writeFile('site/sports/cpbl/standings.json', JSON.stringify(pack));
}
if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();

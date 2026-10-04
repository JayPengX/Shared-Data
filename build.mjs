// Taiwan's bus routes and timetables, one compact pack a city, built each
// night (.github/workflows/build.yml) and published on GitHub Pages for
// Orbit Transit to keep on the phone: what a trip's buses are worked out
// from (which way a route goes, its stops, its times at each) without
// asking TDX line by line. Where buses are right now stays live.
//
//   node build.mjs [City …]          TDX itself (TDX_CLIENT_ID, TDX_CLIENT_SECRET)
//   node build.mjs --proxy [City …]  through Orbit Transit's proxy (its dev door: for trying it locally)
//
// → site/bus/<City>.json, the 公路客運 (InterCity, all of Taiwan) cut into
// squares of 0.25° (~28 km) as site/bus/InterCity/<lat>_<lon>.json (a route
// in every square it stops in: a phone keeps only the squares it's in), and
// site/index.json ({ built, cities: { City: { routes, bytes } }, squares: { key: bytes } }).
//
// A pack: { v, city, built, stops: { uid: [name, lat, lon] }, routes: [{ uid,
// name, ways: [[sub, subName, dir, [stopUid…]]], sched: [[sub, dir,
// [stopUid…], trips, freq]] }] } where a trip is [days, times, special?]:
// days the week as 7 bits (bit 0 Sunday), times minutes of the day at each
// of its stops (one number: the first stop's, which is all 公路客運 often
// gives), special TDX's SpecialDays as given; freq [[days, from, to, min, max]].
import { mkdir, writeFile } from 'node:fs/promises';

const CITIES = ['Taipei', 'NewTaipei', 'Taoyuan', 'Taichung', 'Tainan', 'Kaohsiung', 'Keelung', 'Hsinchu', 'HsinchuCounty', 'MiaoliCounty', 'ChanghuaCounty', 'NantouCounty', 'YunlinCounty', 'Chiayi', 'ChiayiCounty', 'PingtungCounty', 'YilanCounty', 'HualienCounty', 'TaitungCounty', 'KinmenCounty', 'PenghuCounty', 'LienchiangCounty', 'InterCity'];
const TDX = 'https://tdx.transportdata.tw/api/';
const AUTH = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const PROXY = 'https://orbit-workers-proxy.pengzjay.workers.dev/transit/tdx?p=';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PAGE = 1000;

const args = process.argv.slice(2);
const viaProxy = args.includes('--proxy');
const only = args.filter(a => !a.startsWith('--'));
const sleep = ms => new Promise(r => setTimeout(r, ms));

let token = null;
async function auth() {
  const { TDX_CLIENT_ID: id, TDX_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('TDX_CLIENT_ID and TDX_CLIENT_SECRET are needed (or --proxy)');
  const res = await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }) });
  if (!res.ok) throw new Error(`TDX sign-in: ${res.status}`);
  token = (await res.json()).access_token;
}
// One ask (4 a second at most: TDX refuses past 5), tried again a few times.
async function ask(path) {
  for (let tries = 0; ; tries++) {
    await sleep(260);
    const url = viaProxy ? PROXY + encodeURIComponent(path) : `${TDX}${path}${path.includes('?') ? '&' : '?'}$format=JSON`;
    const res = await fetch(url, viaProxy ? { headers: { Origin: 'http://localhost:8765' } } : { headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'gzip' } }).catch(e => ({ ok: false, status: String(e) }));
    if (res.ok) return res.json();
    if (res.status === 401 && !viaProxy) await auth();
    if (tries >= 4) throw new Error(`${path}: ${res.status}`);
    await sleep(2000 * (tries + 1));
  }
}
// Every row, a page at a time.
async function all(path) {
  const out = [];
  for (let skip = 0; ; skip += PAGE) {
    const rows = await ask(`${path}?$top=${PAGE}&$skip=${skip}`);
    const list = Array.isArray(rows) ? rows : rows?.Routes || rows?.data || [];
    out.push(...list);
    if (list.length < PAGE) return out;
  }
}

const zh = x => (typeof x === 'string' ? x : x?.Zh_tw || '');
const mins = t => {
  const [h, m] = String(t || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : -1;
};
const daysOf = sd => (sd ? DAYS.reduce((a, d, i) => a | (Number(sd[d]) === 1 ? 1 << i : 0), 0) : 127);
const r5 = x => Math.round(Number(x) * 1e5) / 1e5;

async function pack(city) {
  const scope = city === 'InterCity' ? 'InterCity' : `City/${city}`;
  const [stopRows, schedRows] = [await all(`basic/v2/Bus/StopOfRoute/${scope}`), await all(`basic/v2/Bus/Schedule/${scope}`)];
  const stops = {};
  const routes = new Map();
  const route = (uid, name) => {
    if (!routes.has(uid)) routes.set(uid, { uid, name, ways: [], sched: [] });
    return routes.get(uid);
  };
  for (const r of stopRows) {
    const list = (r.Stops || []).slice().sort((a, b) => (a.StopSequence || 0) - (b.StopSequence || 0));
    for (const s of list) if (!stops[s.StopUID]) stops[s.StopUID] = [zh(s.StopName), r5(s.StopPosition?.PositionLat), r5(s.StopPosition?.PositionLon)];
    route(r.RouteUID, zh(r.RouteName)).ways.push([r.SubRouteUID || '', zh(r.SubRouteName), Number(r.Direction) || 0, list.map(s => s.StopUID)]);
  }
  for (const r of schedRows) {
    // A sub-route's stops, from its trips (each lists the stops it times).
    const order = [];
    for (const t of r.Timetables || []) for (const st of (t.StopTimes || []).slice().sort((a, b) => (a.StopSequence || 0) - (b.StopSequence || 0))) if (!order.includes(st.StopUID)) order.push(st.StopUID);
    const at = new Map(order.map((u, i) => [u, i]));
    const trips = (r.Timetables || []).map(t => {
      const times = Array(order.length).fill(-1);
      for (const st of t.StopTimes || []) times[at.get(st.StopUID)] = mins(st.DepartureTime || st.ArrivalTime);
      const set = new Set(times.filter(x => x >= 0));
      const one = set.size <= 1 ? [...set][0] ?? -1 : null; // one time for every stop: the first stop's
      const trip = [daysOf(t.ServiceDay), one ?? times];
      if (t.SpecialDays?.length) trip.push(t.SpecialDays);
      return trip;
    });
    const freq = (r.Frequencys || []).map(f => [daysOf(f.ServiceDay), f.StartTime, f.EndTime, Number(f.MinHeadwayMins) || 0, Number(f.MaxHeadwayMins) || 0]);
    for (const u of order) if (!stops[u]) stops[u] = [zh((r.Timetables || []).flatMap(t => t.StopTimes || []).find(s => s.StopUID === u)?.StopName), null, null];
    route(r.RouteUID, zh(r.RouteName)).sched.push([r.SubRouteUID || '', Number(r.Direction) || 0, order, trips, freq]);
  }
  return { v: 1, city, built: new Date().toISOString(), stops, routes: [...routes.values()] };
}

// The 公路客運 cut into squares: each route in every square one of its stops is in.
export const SQUARE = 0.25;
export const squareOf = (lat, lon) => `${(Math.floor(lat / SQUARE) * SQUARE).toFixed(2)}_${(Math.floor(lon / SQUARE) * SQUARE).toFixed(2)}`;
async function squares(p) {
  await mkdir('site/bus/InterCity', { recursive: true });
  const by = new Map();
  for (const r of p.routes) {
    const uids = new Set([...r.ways.flatMap(w => w[3]), ...r.sched.flatMap(x => x[2])]);
    const keys = new Set([...uids].map(u => p.stops[u]).filter(s => s?.[1] != null).map(s => squareOf(s[1], s[2])));
    for (const k of keys) {
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(r);
    }
  }
  const sizes = {};
  for (const [k, routes] of by) {
    const used = new Set(routes.flatMap(r => [...r.ways.flatMap(w => w[3]), ...r.sched.flatMap(x => x[2])]));
    const text = JSON.stringify({ ...p, square: k, stops: Object.fromEntries([...used].map(u => [u, p.stops[u]])), routes });
    await writeFile(`site/bus/InterCity/${k}.json`, text);
    sizes[k] = text.length;
  }
  return sizes;
}

if (!viaProxy) await auth();
await mkdir('site/bus', { recursive: true });
const index = { built: new Date().toISOString(), cities: {} };
let failed = 0;
for (const city of only.length ? only : CITIES) {
  try {
    const t = Date.now();
    const p = await pack(city);
    const text = JSON.stringify(p);
    if (city === 'InterCity') {
      index.squares = await squares(p);
      index.cities[city] = { routes: p.routes.length, bytes: text.length, squares: Object.keys(index.squares).length };
    } else await writeFile(`site/bus/${city}.json`, text);
    index.cities[city] ||= { routes: p.routes.length, bytes: text.length };
    console.log(`${city}: ${p.routes.length} routes, ${Object.keys(p.stops).length} stops, ${(text.length / 1e6).toFixed(2)} MB, ${((Date.now() - t) / 1000).toFixed(0)} s`);
  } catch (e) {
    failed++;
    console.log(`${city}: failed (${e.message})`);
  }
}
await writeFile('site/index.json', JSON.stringify(index));
await writeFile('site/.nojekyll', '');
// A city that failed is left out (the app keeps the pack it had); all failing fails the run.
if (failed && !Object.keys(index.cities).length) process.exit(1);

// Which packs hold what's near a point, for Orbit Transit to find a place's
// bus stops and YouBike stations on the phone instead of asking TDX around
// each point: Taiwan in cells of 0.02° (~2 km), each listing the bus packs
// with a stop in it (a city's, or the 公路客運's square) and the cities with
// a YouBike station in it (whose bikes the app then asks once a city). Built
// every night after the bus packs (built or carried over), from them and
// TDX's station lists.
//
//   node where.mjs            TDX itself (TDX_CLIENT_ID, TDX_CLIENT_SECRET)
//   node where.mjs --proxy    through Orbit Transit's proxy (its dev door)
//
// → site/where.json: { v, built, cell, packs: [name…], cells: { "<i>_<j>": [k…] } },
// a cell's key floor(lat / cell)_floor(lon / cell), each k an index into
// packs: a bus pack ('HsinchuCounty', 'InterCity/24.75_121.00') or a bike
// city ('bike:Hsinchu').
import { readFile, writeFile } from 'node:fs/promises';
import { auth, all } from './tdx.mjs';

export const CELL = 0.02;
const cellOf = (lat, lon) => `${Math.floor(lat / CELL)}_${Math.floor(lon / CELL)}`;
const BIKE_CITIES = ['Taipei', 'NewTaipei', 'Taoyuan', 'Hsinchu', 'HsinchuCounty', 'MiaoliCounty', 'Taichung', 'ChanghuaCounty', 'YunlinCounty', 'ChiayiCounty', 'Chiayi', 'Tainan', 'Kaohsiung', 'PingtungCounty', 'TaitungCounty'];

const index = JSON.parse(await readFile('site/index.json', 'utf8'));
const names = [...Object.keys(index.cities || {}).filter(c => !index.cities[c].squares), ...Object.keys(index.squares || {}).map(k => `InterCity/${k}`)];
const packs = [];
const cells = new Map();
const mark = (lat, lon, k) => {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const c = cellOf(lat, lon);
  if (!cells.has(c)) cells.set(c, new Set());
  cells.get(c).add(k);
};
for (const name of names) {
  const p = JSON.parse(await readFile(`site/bus/${name}.json`, 'utf8'));
  const k = packs.push(name) - 1;
  for (const [, lat, lon] of Object.values(p.stops)) mark(lat, lon, k);
}
await auth();
let bikes = 0;
for (const city of BIKE_CITIES) {
  try {
    const rows = await all(`basic/v2/Bike/Station/City/${city}?$select=StationUID,StationPosition`);
    const k = packs.push(`bike:${city}`) - 1;
    for (const s of rows) mark(Number(s.StationPosition?.PositionLat), Number(s.StationPosition?.PositionLon), k);
    bikes += rows.length;
  } catch (e) {
    // Left out: the app asks TDX around the point there, as before.
    console.log(`bikes ${city}: failed (${e.message})`);
  }
}
const out = { v: 1, built: new Date().toISOString(), cell: CELL, packs, cells: Object.fromEntries([...cells].map(([c, s]) => [c, [...s].sort((a, b) => a - b)])) };
const text = JSON.stringify(out);
await writeFile('site/where.json', text);
console.log(`where.json: ${names.length} bus packs, ${bikes} bike stations, ${cells.size} cells, ${(text.length / 1e3).toFixed(0)} kB`);

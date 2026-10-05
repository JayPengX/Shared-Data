// The bus packs as last published, into site/ (the nights the buses aren't
// rebuilt: a Pages deploy replaces the whole site, so the sports packs'
// nightly build carries the week's bus packs over). Fails when they can't
// all be read: the deploy then doesn't happen and the site stays as it was.
import { mkdir, writeFile } from 'node:fs/promises';
const BASE = 'https://jaypengx.github.io/Transit-Data/';
async function get(path) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + path).catch(error => ({ ok: false, status: String(error) }));
    if (res.ok) return res.text();
    if (attempt >= 3) throw new Error(`${path}: ${res.status}`);
    await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
  }
}
const index = await get('index.json');
const { cities = {}, squares = {} } = JSON.parse(index);
const paths = [...Object.keys(cities).filter(c => !cities[c].squares).map(c => `bus/${c}.json`), ...Object.keys(squares).map(k => `bus/InterCity/${k}.json`)];
await mkdir('site/bus/InterCity', { recursive: true });
for (let i = 0; i < paths.length; i += 8) await Promise.all(paths.slice(i, i + 8).map(async p => writeFile(`site/${p}`, await get(p))));
await writeFile('site/index.json', index);
await writeFile('site/.nojekyll', '');
console.log(`carried over ${paths.length} bus packs (built ${JSON.parse(index).built})`);

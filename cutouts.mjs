// The day's runs between the nightly builds: goes on looking up TheSportsDB's
// cutouts for the names the night left (site/sports/cutouts/pending.json,
// on the site as last built), so the list fills in a day, not a fortnight.
//
//   node cutouts.mjs        (CUTOUTS_BUDGET: how many to ask, 1000 by default)
import { readFile, writeFile } from 'node:fs/promises';
import { cutouts } from './official-photos.mjs';

const read = path => readFile(path, 'utf8').then(JSON.parse).catch(() => null);
const kept = (await read('site/sports/cutouts/photos.json')) || {};
const pending = (await read('site/sports/cutouts/pending.json'))?.names || [];
if (!pending.length) {
  console.log('cutouts: nothing left to look up');
} else {
  const got = await cutouts({ names: pending, carried: kept, budget: Number(process.env.CUTOUTS_BUDGET || 1000) });
  await writeFile('site/sports/cutouts/photos.json', JSON.stringify({ built: kept.built || Date.now(), players: got.players, none: got.none }));
  await writeFile('site/sports/cutouts/pending.json', JSON.stringify({ built: Date.now(), names: got.left }));
  console.log(`cutouts: ${got.players.length} players have one, ${got.asked} asked, ${got.left.length} left`);
}

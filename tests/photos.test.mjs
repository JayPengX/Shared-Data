import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPhotos } from '../mirror.mjs';

test("a player NBA.com shows as its silhouette is left out; a failed read keeps them", async () => {
  const players = [['Jaden Akins', 1643022], ['Pacôme Dadiet', 1642359], ['Someone', 9]];
  const tags = { 1643022: '"sil"', 1642359: '"face"', 9: '' };
  const kept = await withPhotos(players, async id => tags[id], '"sil"');
  assert.deepEqual(kept.map(p => p[0]), ['Pacôme Dadiet', 'Someone']);
});

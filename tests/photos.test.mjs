import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPhotos, plNames } from '../mirror.mjs';

test("a player NBA.com shows as its silhouette is left out; a failed read keeps them", async () => {
  const players = [['Jaden Akins', 1643022], ['Pacôme Dadiet', 1642359], ['Someone', 9]];
  const tags = { 1643022: '"sil"', 1642359: '"face"', 9: '' };
  const kept = await withPhotos(players, async id => tags[id], '"sil"');
  assert.deepEqual(kept.map(p => p[0]), ['Pacôme Dadiet', 'Someone']);
});

test("the Premier League's players under each name ESPN may use, trialists left out", () => {
  const list = [
    { name: { display: 'Trialist 1', first: 'Trialist', last: '1' }, altIds: { opta: 'p244719' } },
    { name: { display: 'Max Aarons', first: 'Max', middle: 'James', last: 'Aarons' }, altIds: { opta: 'p232980' } },
    { name: { display: 'Gabriel', first: 'Gabriel', last: 'dos Santos Magalhães' }, altIds: { opta: 'p226597' } },
    { name: { display: 'Gabriel', first: 'Gabriel', last: 'Jesus' }, altIds: { opta: 'p205651' } },
    { name: { display: 'No Id' }, altIds: {} }
  ];
  assert.deepEqual(plNames(list), [['Max Aarons', 232980], ['Max James Aarons', 232980], ['Gabriel dos Santos Magalhães', 226597], ['Gabriel Magalhães', 226597], ['Gabriel Jesus', 205651]]);
});

test('two players with one name: the one at a club in the league this season', () => {
  const list = [
    { name: { display: 'Ben Davies', first: 'Ben', last: 'Davies' }, altIds: { opta: 'p1' }, currentTeam: { name: 'Rangers' } },
    { name: { display: 'Ben Davies', first: 'Ben', last: 'Davies' }, altIds: { opta: 'p2' }, currentTeam: { name: 'Tottenham Hotspur' } }
  ];
  assert.deepEqual(plNames(list, new Set(['Tottenham Hotspur'])), [['Ben Davies', 2]]);
  assert.deepEqual(plNames(list), []);
});

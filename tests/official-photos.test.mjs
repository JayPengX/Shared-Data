import { test } from 'node:test';
import assert from 'node:assert/strict';
import { photoList, laligaSquads, bundesligaSquad, serieaSquad, ligue1Squad, officialPhotos, smallSerieA } from '../official-photos.mjs';

test('each player under every name; a shared name or a stand-in picture left out', () => {
  const list = photoList([
    { names: ['Éder Gabriel Militão Pinheiro', 'Militão'], url: 'https://x/1.png' },
    { names: ['Gabriel Magalhães', 'Gabriel'], url: 'https://x/2.png' },
    { names: ['Gabriel Jesus', 'Gabriel'], url: 'https://x/3.png' },
    { names: ['No Photo'], url: 'https://x/default/256x278/default.png' },
    { names: ['Twin A'], url: 'https://x/same.png' },
    { names: ['Twin B'], url: 'https://x/same.png' }
  ]);
  const names = Object.fromEntries(list);
  assert.equal(names['Éder Pinheiro'], 'https://x/1.png');
  assert.equal(names['Militão'], 'https://x/1.png');
  assert.equal(names['Gabriel'], undefined);
  assert.equal(names['Gabriel Jesus'], 'https://x/3.png');
  assert.equal(names['No Photo'], undefined);
  assert.equal(names['Twin A'], undefined);
});

test("LaLiga's squads: the half-body picture at 256 px", () => {
  const people = laligaSquads([{ squads: [{ role: { id: 1 }, person: { name: 'Pedro González López', nickname: 'Pedri', firstname: 'Pedro', lastname: 'González' }, photos: { '001': { '256x278': 'https://assets.laliga.com/p.png' } } }] }]);
  assert.deepEqual(people, [{ names: ['Pedro González López', 'Pedri', 'Pedro González'], url: 'https://assets.laliga.com/p.png' }]);
});

test("the Bundesliga's squad page: the half-body picture behind the circle's", () => {
  const state = { a: { players: [{ id: 'DFL-OBJ-0002F5', name: { full: 'Joshua Walter Kimmich', alias: 'Joshua Kimmich', first: 'Joshua Walter', last: 'Kimmich' }, playerImages: { FACE_CIRCLE: 'https://assets.bundesliga.com/player/dfl-obj-0002f5-dfl-clu-00000g-dfl-sea-0001ka-circle.png' } }] } };
  const html = `<html><script id="ng-state" type="application/json">${JSON.stringify(state)}</script></html>`;
  assert.deepEqual(bundesligaSquad(html), [{ names: ['Joshua Walter Kimmich', 'Joshua Kimmich', 'Joshua Kimmich'], url: 'https://assets.bundesliga.com/player/dfl-obj-0002f5-dfl-clu-00000g-dfl-sea-0001ka.png?fit=256,256' }]);
  assert.deepEqual(bundesligaSquad('<html></html>'), []);
});

test("Serie A's squad page: each player's picture, made small", () => {
  const html = '<a aria-label="x"></a><picture><img alt="Hakan Çalhanoğlu" loading="lazy" width="140" src="https://media-sdp.legaseriea.it/playerImages/a/b/c/home/d_left.webp"/></picture><img alt="logo" src="https://images.legaseriea.it/logo.png"/>';
  assert.deepEqual(serieaSquad(html), [{ names: ['Hakan Çalhanoğlu'], url: smallSerieA('https://media-sdp.legaseriea.it/playerImages/a/b/c/home/d_left.webp') }]);
});

test("Ligue 1's club summary: each player's bust picture", () => {
  const sum = { championships: { 1: { playersData: { p1: { playerIdentity: { firstName: 'Jordan', lastName: 'Teze', assets: { bustPictures: { medium: 'https://s3/teze-400x300.png' } } } } } } } };
  assert.deepEqual(ligue1Squad(sum), [{ names: ['Jordan Teze'], url: 'https://s3/teze-400x300.png' }]);
});

test("a league that can't be read is carried over; one read is written", async () => {
  const written = [];
  const carried = [];
  const many = Array.from({ length: 320 }, (_, i) => ({ names: [`Player ${i}`], url: `https://x/${i}.png` }));
  await officialPhotos({ leagues: { good: async () => many, down: async () => null }, write: async (k, p) => written.push([k, p.length]), carry: async path => (carried.push(path), true) });
  assert.deepEqual(written, [['good', 320]]);
  assert.deepEqual(carried, ['sports/down/photos.json']);
});

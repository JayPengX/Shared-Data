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
  assert.deepEqual(people, [{ names: ['Pedro González López', 'Pedri', 'Pedro González'], url: 'https://assets.laliga.com/p.png', club: 0 }]);
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

test("ESPN's short names find a league's legal ones, club by club", async () => {
  const { sameNameish } = await import('../mirror.mjs');
  const { clubFits } = await import('../official-photos.mjs');
  const people = [
    { names: ['Marcus Lilian Thuram Ulien'], url: 'https://x/thuram', club: 0 },
    { names: ['Diop Tehuti Djed-Hotep Spence'], url: 'https://x/spence', club: 0 },
    { names: ['Nicolò Barella'], url: 'https://x/barella', club: 0 },
    { names: ['Alessandro Bastoni'], url: 'https://x/bastoni', club: 0 },
    { names: ['Federico Dimarco'], url: 'https://x/dimarco', club: 0 },
    { names: ['Minjae Kim'], url: 'https://x/kim', club: 0 },
    { names: ['Marcus Holmgren Pedersen'], url: 'https://x/other', club: 1 }
  ];
  const espn = [['Marcus Thuram', 'Djed Spence', 'Kim Min-Jae', 'Nicolò Barella', 'Alessandro Bastoni', 'Federico Dimarco']];
  assert.deepEqual(Object.fromEntries(clubFits(people, espn, sameNameish)), { 'Marcus Thuram': 'https://x/thuram', 'Djed Spence': 'https://x/spence', 'Kim Min-Jae': 'https://x/kim', 'Nicolò Barella': 'https://x/barella', 'Alessandro Bastoni': 'https://x/bastoni', 'Federico Dimarco': 'https://x/dimarco' });
  // A name the league shares between clubs is this club's; a surname alone, when it's the only one.
  const mls = [
    { names: ['Luis Suárez'], url: 'https://x/suarez-miami', club: 'MIA' },
    { names: ['Leo Messi'], url: 'https://x/messi', club: 'MIA' },
    { names: ['Jordi Alba'], url: 'https://x/alba', club: 'MIA' },
    { names: ['Sergio Busquets'], url: 'https://x/busquets', club: 'MIA' },
    { names: ['Luis Suárez'], url: 'https://x/suarez-other', club: 'OTH' }
  ];
  assert.deepEqual(Object.fromEntries(clubFits(mls, [['Lionel Messi', 'Luis Suárez', 'Jordi Alba', 'Sergio Busquets']], sameNameish)), { 'Lionel Messi': 'https://x/messi', 'Luis Suárez': 'https://x/suarez-miami', 'Jordi Alba': 'https://x/alba', 'Sergio Busquets': 'https://x/busquets' });
});

test("MLS's players: the roster picture at 256 px, by club", async () => {
  const { mlsSquad } = await import('../official-photos.mjs');
  const items = [{ title: 'Riquelme Fillipi', fields: { firstName: 'Riquelme', lastName: 'Fillipi', clubSportecId: 'MLS-CLU-000008' }, thumbnail: { templateUrl: 'https://images.mlssoccer.com/image/private/{formatInstructions}/mls/wjl' } }, { title: 'No Picture', fields: {} }];
  assert.deepEqual(mlsSquad(items), [
    { names: ['Riquelme Fillipi', 'Riquelme Fillipi'], url: 'https://images.mlssoccer.com/image/private/w_256,c_scale,q_auto,f_png/mls/wjl', club: 'MLS-CLU-000008' },
    { names: ['No Picture', ''], url: '', club: null }
  ]);
});

test("TheSportsDB: the one footballer of that name with a cutout; two, neither", async () => {
  const { tsdbCutout } = await import('../official-photos.mjs');
  const answer = players => async () => ({ player: players });
  assert.equal(await tsdbCutout('Liam Scales', answer([{ strPlayer: 'Liam Scales', strSport: 'Soccer', strCutout: 'https://r2.thesportsdb.com/c.png' }, { strPlayer: 'Liam Scales', strSport: 'Rugby', strCutout: 'x' }])), 'https://r2.thesportsdb.com/c.png');
  assert.equal(await tsdbCutout('Danilo', answer([{ strPlayer: 'Danilo', strSport: 'Soccer', strCutout: 'a' }, { strPlayer: 'Danilo', strSport: 'Soccer', strCutout: 'b' }])), '');
  assert.equal(await tsdbCutout('Nobody', answer(null)), '');
});

test('cutouts: only names no list has, kept from night to night, within the night\'s budget', async () => {
  const { cutouts } = await import('../official-photos.mjs');
  const espn = new Map([['scotland:256', ['Liam Scales', 'Kieran Tierney', 'Unknown Kid', 'Old None']], ['epl:359', ['Bukayo Saka']], ['ucl:256', ['Liam Scales', 'Covered Star']]]);
  const asked = [];
  const got = await cutouts({
    espn,
    covered: new Set(['covered star']),
    carried: { players: [['Kieran Tierney', 'https://r2/t.png']], none: { 'old none': Date.now() - 86_400_000 } },
    search: async n => (asked.push(n), n === 'Liam Scales' ? 'https://r2/s.png' : ''),
    sleep: async () => {},
    budget: 5
  });
  assert.deepEqual(asked, ['Liam Scales', 'Unknown Kid'], "Saka is the Premier League's (not a cutout league here), Tierney kept, Old None asked lately");
  assert.deepEqual(Object.fromEntries(got.players), { 'Kieran Tierney': 'https://r2/t.png', 'Liam Scales': 'https://r2/s.png' });
  assert.ok(got.none['unknown kid']);
  const again = await cutouts({ espn, covered: new Set(), carried: {}, search: async () => '', sleep: async () => {}, budget: 1 });
  assert.equal(again.asked, 1);
  assert.deepEqual(again.left, ['Kieran Tierney', 'Unknown Kid', 'Old None', 'Covered Star']);
});

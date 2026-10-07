// Football leagues' own player photos: the studio half-body each league shoots
// of its players (the Premier League's are mirror.mjs plPhotos), for the kit's
// photos.mjs, so a footballer looks like an NBA player does, not a face cut
// out of a circle (FotMob's, kept as the last resort). Each league's own site:
//   - LaLiga: its public API (the key its site sends), every club's squad;
//   - Bundesliga: each club's squad page (the players in its page state);
//   - Serie A: each club's squad page (each player's picture and name);
//   - Ligue 1: its API's club summaries (each player's "bust" picture).
// → site/sports/<league>/photos.json ({ built, players: [[name, url]…] }):
// each player under every name ESPN may call them (full, short, the known
// name), a name two players share left out (no face is better than a wrong
// one). A league that can't be read is carried over as last published.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const get = async (url, headers = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(30_000) }).catch(() => null);
  return res?.ok ? res : null;
};
const json = async (url, headers) => (await get(url, headers))?.json().catch(() => null);
const text = async url => (await get(url))?.text().catch(() => null);
// A few at a time.
async function each(list, fn, at = 4) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: at }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]).catch(() => null);
    }
  }));
  return out;
}

// Names as the kit compares them (photos.mjs plain).
export const nameKey = n =>
  String(n || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[øœæßđðłıþ]/g, c => ({ ø: 'o', œ: 'oe', æ: 'ae', ß: 'ss', đ: 'd', ð: 'd', ł: 'l', ı: 'i', þ: 'th' })[c])
    .replace(/\b(jr|sr|ii|iii)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
// [{ names: [...], url }] → [[name, url]…]: every name of each, the full one
// and its first and last words too; a name that would mean two players, neither.
// A picture several players have is the league's stand-in ("default"), not a photo.
export function photoList(people) {
  const uses = new Map();
  for (const p of people) if (p?.url) uses.set(p.url, (uses.get(p.url) || 0) + 1);
  const by = new Map();
  for (const p of people) {
    if (!p?.url || uses.get(p.url) > 1 || /\/default|defaultAssets/i.test(p.url)) continue;
    const variants = new Set();
    for (const n of p.names || []) {
      const v = String(n || '').replace(/\s+/g, ' ').trim();
      if (!v) continue;
      variants.add(v);
      const w = v.split(' ');
      if (w.length > 2) variants.add(`${w[0]} ${w.at(-1)}`);
    }
    for (const v of variants) {
      const k = nameKey(v);
      if (!k) continue;
      if (!by.has(k)) by.set(k, { name: v, urls: new Set() });
      by.get(k).urls.add(p.url);
    }
  }
  return [...by.values()].filter(x => x.urls.size === 1).map(x => [x.name, [...x.urls][0]]);
}

// The season a league is in (its starting year): from July.
const seasonYear = (now = new Date()) => (now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1);

// ---- LaLiga ----
const LALIGA = 'https://apim.laliga.com/public-service/api/v1';
// The key LaLiga's own site sends with every read (public, in its page).
const LALIGA_KEY = { 'Ocp-Apim-Subscription-Key': 'c13c3a8e2f6b46da9c5c425cf61fab3e' };
export async function laligaPeople(year = seasonYear()) {
  const teams = (await json(`${LALIGA}/teams?subscriptionSlug=laliga-easports-${year}&limit=30&offset=0&orderField=nickname&orderType=ASC`, LALIGA_KEY))?.teams || [];
  if (teams.length < 20) return null;
  const squads = await each(teams, t => json(`${LALIGA}/teams/${t.slug}/squad-manager?limit=80&offset=0&orderField=id&orderType=DESC&seasonYear=${year}`, LALIGA_KEY));
  if (squads.filter(Boolean).length < 18) return null;
  return laligaSquads(squads);
}
export const laligaSquads = squads =>
  squads.flatMap(sq =>
    (sq?.squads || [])
      .filter(s => s.role?.id === 1 || /jugador|player/i.test(s.role?.name || '') || s.position)
      .map(s => ({ names: [s.person?.name, s.person?.nickname, [s.person?.firstname, s.person?.lastname].filter(Boolean).join(' ')], url: s.photos?.['001']?.['256x278'] || s.photos?.['001']?.['512x556'] || '' }))
  );

// ---- Bundesliga ----
const BL = 'https://www.bundesliga.com/en/bundesliga/clubs';
export async function bundesligaPeople() {
  const clubs = [...new Set(((await text(BL)) || '').match(/\/en\/bundesliga\/clubs\/[a-z0-9-]+/g) || [])].map(p => p.split('/').pop());
  if (clubs.length < 18) return null;
  const pages = await each(clubs, c => text(`${BL}/${c}/squad`));
  if (pages.filter(Boolean).length < 16) return null;
  return pages.flatMap(bundesligaSquad);
}
// A squad page's players (its state, the JSON Angular sends with the page).
export function bundesligaSquad(html) {
  const m = /<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/.exec(html || '');
  if (!m) return [];
  let state;
  try {
    state = JSON.parse(m[1]);
  } catch {
    return [];
  }
  const out = new Map();
  const walk = x => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    const face = x.playerImages?.FACE_CIRCLE;
    if (face && x.name?.full) {
      // The circle's picture is a crop of the half-body one at the same path.
      const url = `${face.replace(/-circle\.png$/, '.png')}?fit=256,256`;
      out.set(x.id || x.name.full, { names: [x.name.full, x.name.alias, [x.name.first?.split(' ')[0], x.name.last].filter(Boolean).join(' ')], url });
    }
    Object.values(x).forEach(walk);
  };
  walk(state);
  return [...out.values()];
}

// ---- Serie A ----
const SA = 'https://en.legaseriea.it';
// Its pictures are 1024 px (about 450 KB): made 256 px by wsrv.nl's image
// service, as a phone shows them.
export const smallSerieA = url => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=256&output=webp`;
export async function serieaPeople() {
  const clubs = [...new Set(((await text(`${SA}/team`)) || '').match(/\/team\/[a-z0-9-]+\//g) || [])].map(p => p.split('/')[2]).filter(c => c !== 'index');
  if (clubs.length < 18) return null;
  const pages = await each(clubs, c => text(`${SA}/team/${c}/squad`));
  if (pages.filter(Boolean).length < 16) return null;
  return pages.flatMap(serieaSquad);
}
export function serieaSquad(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<img alt="([^"]+)"[^>]*?src="(https:\/\/media-sdp\.legaseriea\.it\/playerImages\/[^"]+)"/g)) out.push({ names: [m[1].replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, '&')], url: smallSerieA(m[2]) });
  return out;
}

// ---- Ligue 1 ----
const L1 = 'https://ma-api.ligue1.fr';
export async function ligue1People() {
  const table = await json(`${L1}/championship-standings/1/general`);
  const season = table?.season;
  const clubs = [...new Set(JSON.stringify(table || {}).match(new RegExp(`l1_championship_club_${season}_\\d+`, 'g')) || [])];
  if (clubs.length < 18) return null;
  const sums = await each(clubs, c => json(`${L1}/championship-club-summary/${c}?season=${season}`));
  if (sums.filter(Boolean).length < 16) return null;
  return sums.flatMap(ligue1Squad);
}
export const ligue1Squad = sum =>
  Object.values(sum?.championships?.['1']?.playersData || {}).map(p => {
    const id = p.playerIdentity || {};
    return { names: [[id.firstName, id.lastName].filter(Boolean).join(' '), id.knownName, id.shortName].filter(Boolean), url: id.assets?.bustPictures?.medium || '' };
  });

export const OFFICIAL = { laliga: laligaPeople, bundesliga: bundesligaPeople, seriea: serieaPeople, ligue1: ligue1People };
// Each league's list, written; or carried over (`carry`) when it can't be read.
export async function officialPhotos({ write, carry, leagues = OFFICIAL } = {}) {
  for (const [key, read] of Object.entries(leagues)) {
    const people = await read().catch(() => null);
    const players = people ? photoList(people) : [];
    if (players.length < 300) {
      console.log(`${key} photos: left out (${players.length} names)${(await carry(`sports/${key}/photos.json`)) ? ', carried' : ''}`);
      continue;
    }
    await write(key, players);
    console.log(`${key} photos: ${people.filter(p => p.url).length} players, ${players.length} names`);
  }
}

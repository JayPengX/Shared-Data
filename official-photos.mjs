// Football leagues' own player photos: the studio half-body each league shoots
// of its players (the Premier League's are mirror.mjs plPhotos), for the kit's
// photos.mjs, so a footballer looks like an NBA player does, not a face cut
// out of a circle (FotMob's, kept as the last resort). Each league's own site:
//   - LaLiga: its public API (the key its site sends), every club's squad;
//   - Bundesliga: each club's squad page (the players in its page state);
//   - Serie A: each club's squad page (each player's picture and name);
//   - Ligue 1: its API's club summaries (each player's "bust" picture);
//   - MLS: its content API (every active player, the roster's picture).
// Everyone else (Scotland, the European cups' other clubs, the FA Cup's
// lower leagues, national teams): TheSportsDB's studio cutouts, looked up a
// few hundred a night and kept (cutouts below).
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
  squads.flatMap((sq, club) =>
    (sq?.squads || [])
      .filter(s => s.role?.id === 1 || /jugador|player/i.test(s.role?.name || '') || s.position)
      .map(s => ({ names: [s.person?.name, s.person?.nickname, [s.person?.firstname, s.person?.lastname].filter(Boolean).join(' ')], url: s.photos?.['001']?.['256x278'] || s.photos?.['001']?.['512x556'] || '', club }))
  );

// ---- Bundesliga ----
const BL = 'https://www.bundesliga.com/en/bundesliga/clubs';
export async function bundesligaPeople() {
  const clubs = [...new Set(((await text(BL)) || '').match(/\/en\/bundesliga\/clubs\/[a-z0-9-]+/g) || [])].map(p => p.split('/').pop());
  if (clubs.length < 18) return null;
  const pages = await each(clubs, c => text(`${BL}/${c}/squad`));
  if (pages.filter(Boolean).length < 16) return null;
  return pages.flatMap((p, club) => bundesligaSquad(p).map(x => ({ ...x, club })));
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
  return pages.flatMap((p, club) => serieaSquad(p).map(x => ({ ...x, club })));
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
  return sums.flatMap((p, club) => ligue1Squad(p).map(x => ({ ...x, club })));
}
export const ligue1Squad = sum =>
  Object.values(sum?.championships?.['1']?.playersData || {}).map(p => {
    const id = p.playerIdentity || {};
    return { names: [[id.firstName, id.lastName].filter(Boolean).join(' '), id.knownName, id.shortName].filter(Boolean), url: id.assets?.bustPictures?.medium || '' };
  });

// ESPN's names the league's don't give exactly (Serie A's are legal names:
// "Marcus Lilian Thuram Ulien" for ESPN's "Marcus Thuram"), matched club by
// club: each ESPN squad (`espnClubs`, [names]) to the league's club sharing
// the most names with it, then each name of its left over to the one player
// there whose name it fits (`same`, mirror.mjs sameNameish); two fits, none.
// The same name in another order, its parts run together or not (ESPN's
// "Kim Min-Jae", the Bundesliga's "Minjae Kim").
export function turned(a, b) {
  const w = a.split(' ');
  const flat = b.replace(/ /g, '');
  return w.length > 1 && w.some((_, i) => [...w.slice(i), ...w.slice(0, i)].join('') === flat);
}
export function clubFits(people, espnClubs, same) {
  const clubs = new Map();
  for (const p of people) {
    if (!p?.url || p.club == null) continue;
    if (!clubs.has(p.club)) clubs.set(p.club, []);
    clubs.get(p.club).push({ url: p.url, keys: [...new Set((p.names || []).map(nameKey).filter(Boolean))] });
  }
  const found = [];
  for (const names of espnClubs) {
    const espn = names.map(name => ({ name, k: nameKey(name) }));
    const keys = new Set(espn.map(x => x.k));
    let club = null;
    let most = 2;
    for (const c of clubs.values()) {
      const n = c.filter(p => p.keys.some(k => keys.has(k))).length;
      if (n > most) [club, most] = [c, n];
    }
    if (!club) continue;
    const left = club.filter(p => !p.keys.some(k => keys.has(k)));
    const surname = k => k.split(' ').at(-1);
    for (const x of espn) {
      // The same name at this club (a name two of the league's players share is still this club's one).
      const exact = club.filter(p => p.keys.includes(x.k));
      if (exact.length) {
        if (exact.length === 1) found.push([x.name, exact[0].url]);
        continue;
      }
      let fits = left.filter(p => p.keys.some(k => same(x.k, k) || turned(x.k, k)));
      // Else the one player left at the club with that surname, when ESPN's
      // squad has no one else of it ("Leo Messi", ESPN's "Lionel Messi").
      if (!fits.length && x.k.includes(' ') && espn.filter(y => surname(y.k) === surname(x.k)).length === 1) fits = left.filter(p => p.keys.some(k => k.includes(' ') && surname(k) === surname(x.k)));
      if (fits.length === 1) found.push([x.name, fits[0].url]);
    }
  }
  // One player two names fit, or one name two players: neither.
  const byUrl = new Map();
  const byName = new Map();
  for (const [name, url] of found) {
    byUrl.set(url, new Set([...(byUrl.get(url) || []), nameKey(name)]));
    byName.set(nameKey(name), new Set([...(byName.get(nameKey(name)) || []), url]));
  }
  const seen = new Set();
  return found.filter(([name, url]) => byUrl.get(url).size === 1 && byName.get(nameKey(name)).size === 1 && !seen.has(nameKey(name)) && seen.add(nameKey(name)));
}

// ---- MLS ----
const MLS = 'https://dapi.mlssoccer.com/v2/content/en-us/players';
export async function mlsPeople() {
  const out = [];
  for (let skip = 0; skip < 3000; skip += 100) {
    const d = await json(`${MLS}?fields.isActiveMLSPlayer=true&$skip=${skip}&$limit=100`);
    if (!d?.items) return null;
    out.push(...mlsSquad(d.items));
    if (d.items.length < 100) break;
  }
  return out;
}
export const mlsSquad = items =>
  (items || []).map(x => ({
    names: [x.title, [x.fields?.firstName, x.fields?.lastName].filter(Boolean).join(' ')],
    url: x.thumbnail?.templateUrl?.includes('{formatInstructions}') ? x.thumbnail.templateUrl.replace('{formatInstructions}', 'w_256,c_scale,q_auto,f_png') : '',
    club: x.fields?.clubSportecId ?? null
  }));

export const OFFICIAL = { laliga: laligaPeople, bundesliga: bundesligaPeople, seriea: serieaPeople, ligue1: ligue1People, mls: mlsPeople };
// Each league's list, written; or carried over (`carry`) when it can't be read.
// `espn`: each club's names as ESPN has them ('<league>:<team id>' → [names],
// mirror.mjs espnSquads), `same` the name fit (mirror.mjs sameNameish).
export async function officialPhotos({ write, carry, leagues = OFFICIAL, espn = new Map(), same = null } = {}) {
  for (const [key, read] of Object.entries(leagues)) {
    const people = await read().catch(() => null);
    const players = people ? photoList(people) : [];
    if (people && same) {
      const taken = new Set(players.map(([n]) => nameKey(n)));
      const clubs = [...espn].filter(([k]) => k.startsWith(`${key}:`)).map(([, names]) => names);
      for (const [name, url] of clubFits(people.filter(p => !/\/default|defaultAssets/i.test(p.url || '')), clubs, same)) if (!taken.has(nameKey(name))) taken.add(nameKey(name)) && players.push([name, url]);
    }
    if (players.length < 300) {
      console.log(`${key} photos: left out (${players.length} names)${(await carry(`sports/${key}/photos.json`)) ? ', carried' : ''}`);
      continue;
    }
    await write(key, players);
    console.log(`${key} photos: ${people.filter(p => p.url).length} players, ${players.length} names`);
  }
}

// ---- TheSportsDB's cutouts, for everyone the leagues' lists don't have ----
// Each player in these competitions' squads (ESPN's names) without an
// official photo: TheSportsDB's player search, the one footballer of that
// name with a cutout (two: neither). Its free key takes about 30 searches a
// minute: one every 2.1 s, at most `budget` a night (a 429 waits a minute,
// a second stops it), so the list fills over a few nights and is kept:
// found ones carried from the last published list, a name with none asked
// again after two weeks. → site/sports/cutouts/photos.json
// ({ built, players: [[name, url]…], none: { key: when } }).
export const CUTOUT_LEAGUES = ['scotland', 'ucl', 'uel', 'uecl', 'mls', 'facup', 'nationsleague'];
const TSDB = 'https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=';
const NONE_AGAIN = 14 * 86_400_000;
export async function tsdbCutout(name, fetchJson = async u => {
  const r = await fetch(u, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw Object.assign(new Error(String(r.status)), { status: r.status });
  return r.json();
}) {
  const d = await fetchJson(TSDB + encodeURIComponent(name));
  const want = nameKey(name);
  const hits = (d?.player || []).filter(p => p.strSport === 'Soccer' && p.strCutout && nameKey(p.strPlayer) === want);
  return hits.length === 1 ? hits[0].strCutout : '';
}
export async function cutouts({ espn, covered, carried = {}, search = tsdbCutout, budget = 450, gap = 2100, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now() }) {
  const found = new Map((carried.players || []).map(([n, u]) => [nameKey(n), [n, u]]));
  const none = Object.fromEntries(Object.entries(carried.none || {}).filter(([, t]) => now - t < NONE_AGAIN));
  const wanted = [];
  const seen = new Set();
  for (const league of CUTOUT_LEAGUES)
    for (const [k, names] of espn)
      if (k.startsWith(`${league}:`))
        for (const n of names) {
          const key = nameKey(n);
          if (!key || seen.has(key) || covered.has(key) || found.has(key) || none[key]) continue;
          seen.add(key);
          wanted.push(n);
        }
  let asked = 0;
  let limited = 0;
  for (const n of wanted) {
    if (asked >= budget || limited >= 2) break;
    if (asked) await sleep(gap);
    asked++;
    try {
      const url = await search(n);
      if (url) found.set(nameKey(n), [n, url]);
      else none[nameKey(n)] = now;
    } catch (error) {
      if (error?.status === 429) {
        limited++;
        await sleep(60_000);
      }
    }
  }
  return { players: [...found.values()], none, asked, left: wanted.length - asked };
}

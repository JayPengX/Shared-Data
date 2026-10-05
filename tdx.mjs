// TDX for the nightly builds: signed in with the repo's secrets
// (TDX_CLIENT_ID, TDX_CLIENT_SECRET), or through Orbit Transit's proxy
// (`--proxy`: its dev door for localhost, for trying a build here).
const TDX = 'https://tdx.transportdata.tw/api/';
const AUTH = 'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
const PROXY = 'https://orbit-workers-proxy.pengzjay.workers.dev/transit/tdx?p=';
const PAGE = 1000;

export const viaProxy = process.argv.includes('--proxy');
const sleep = ms => new Promise(r => setTimeout(r, ms));

let token = null;
export async function auth() {
  if (viaProxy) return;
  const { TDX_CLIENT_ID: id, TDX_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('TDX_CLIENT_ID and TDX_CLIENT_SECRET are needed (or --proxy)');
  const res = await fetch(AUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }) });
  if (!res.ok) throw new Error(`TDX sign-in: ${res.status}`);
  token = (await res.json()).access_token;
}
// One ask (4 a second at most: TDX refuses past 5), tried again a few times.
export async function ask(path) {
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
export async function all(path) {
  const out = [];
  for (let skip = 0; ; skip += PAGE) {
    const rows = await ask(`${path}${path.includes('?') ? '&' : '?'}$top=${PAGE}&$skip=${skip}`);
    const list = Array.isArray(rows) ? rows : rows?.Routes || rows?.data || [];
    out.push(...list);
    if (list.length < PAGE) return out;
  }
}

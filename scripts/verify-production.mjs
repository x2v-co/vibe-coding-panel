// Read-only gate: health alone cannot prove that the frontend was deployed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function verifyProduction(origin, revision, fetchImpl = fetch) {
  assert(/^[a-f0-9]{40}$/.test(revision), 'Expected full Git revision');
  const get = async path => {
    const response = await fetchImpl(new URL(path, origin), {signal:AbortSignal.timeout(15000),headers:{'cache-control':'no-cache'}});
    assert(response.ok, `${path}: HTTP ${response.status}`);
    return response;
  };
  const health = await (await get(`/healthz?verify=${revision}`)).json();
  assert.equal(health.version, revision, `${origin}: backend is not deployed`);
  const html = await (await get(`/?verify=${revision}`)).text();
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(m=>m[1]);
  assert(assets.some(a=>a.endsWith('.js')) && assets.some(a=>a.endsWith('.css')), 'Missing frontend assets');
  let versionFound = false;
  for (const asset of assets) {
    const body = await (await get(asset)).text();
    assert(body.length > 0 && !body.trimStart().startsWith('<'), `${asset}: invalid asset response`);
    if (asset.endsWith('.js') && body.includes(revision)) versionFound = true;
  }
  assert(versionFound, `${origin}: frontend is stale despite healthy backend`);
  const remoteHtml = await (await get(`/remote?verify=${revision}`)).text();
  assert(remoteHtml.includes('/screenshots/runtime/remote-mobile.png'), `${origin}: Remote artwork is missing or stale`);
  assert(!remoteHtml.includes('/screenshots/runtime/panel-mobile.png'), `${origin}: Remote page references Panel artwork`);
  const artwork = await get('/screenshots/runtime/remote-mobile.png');
  assert((artwork.headers.get('content-type') || '').startsWith('image/'), `${origin}: Remote artwork is not an image`);
  assert(Number(artwork.headers.get('content-length') || 0) > 0, `${origin}: Remote artwork is empty`);
  return {origin,revision,assets};
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [revision, ...origins] = process.argv.slice(2);
  assert(origins.length, 'Usage: node scripts/verify-production.mjs FULL_SHA https://vibe.toolkit.fun');
  for (const origin of origins) console.log(JSON.stringify(await verifyProduction(origin,revision)));
}

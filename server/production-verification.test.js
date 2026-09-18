import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyProduction} from '../scripts/verify-production.mjs';
const sha='a'.repeat(40);
const fixture = ({version=sha,js=sha,css='body{}',assetStatus=200}={}) => async url => {
  const path=url.pathname;
  if(path==='/healthz') return Response.json({version});
  if(path==='/') return new Response('<script src="/assets/app.js"></script><link href="/assets/app.css">');
  if(path==='/remote') return new Response('<img src="/screenshots/runtime/remote-mobile.png">');
  if(path==='/screenshots/runtime/remote-mobile.png') return new Response('png',{headers:{'content-type':'image/png','content-length':'3'}});
  return new Response(path.endsWith('.js')?js:css,{status:assetStatus});
};
test('release gate rejects old backend, stale frontend, missing assets and HTML fallback',async()=>{
  for(const options of [{version:'old'},{js:'old'},{assetStatus:404},{css:'<html>fallback</html>'}]) {
    await assert.rejects(verifyProduction('https://example.test',sha,fixture(options)));
  }
  assert.equal((await verifyProduction('https://example.test',sha,fixture())).revision,sha);
});

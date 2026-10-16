import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { createRelayServer } from './relay.js';
import { verifyToolkitAssertion, readSession, issueSession, ACCOUNT_COOKIE } from './relay-account.js';

const secret = 's'.repeat(48);
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
// Same format toolkit_new server/src/vibe_relay.js signs.
function toolkitAssertion({ sub = 'a'.repeat(43), plan = 'free', aud, now = Date.now(), nonce = String(Math.random()) }) {
  const body = Buffer.from(JSON.stringify({ v: 1, sub, plan, aud, iat: now, exp: now + 120000, nonce })).toString('base64url');
  return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`;
}

test('assertion verification is audience bound, signed and expiring', () => {
  const aud = 'https://relay.example';
  const token = toolkitAssertion({ aud, now: 1000 });
  assert.equal(verifyToolkitAssertion(token, { secret, audience: aud, now: 2000 }).plan, 'free');
  assert.equal(verifyToolkitAssertion(token, { secret, audience: 'https://other.example', now: 2000 }), null);
  assert.equal(verifyToolkitAssertion(token, { secret: 'x'.repeat(48), audience: aud, now: 2000 }), null);
  assert.equal(verifyToolkitAssertion(token, { secret, audience: aud, now: 1000 + 121000 }), null);
  const cookie = `${ACCOUNT_COOKIE}=${encodeURIComponent(issueSession({ sub: 'b'.repeat(43), plan: 'pro' }, secret))}`;
  assert.equal(readSession(cookie, secret).plan, 'pro');
  assert.equal(readSession(cookie.replace(/.$/, 'x'), secret), null);
});

test('required mode: /api needs a toolkit login, login flow sets a lasting session, replay rejected', async () => {
  const relay = createRelayServer({ accountMode: 'required', toolkitSecret: secret, toolkitOrigin: 'https://toolkit.example', publicUrl: 'http://127.0.0.1', audit() {} });
  const port = await listen(relay.server);
  const base = `http://127.0.0.1:${port}`;
  try {
    const blocked = await fetch(`${base}/api/state`, { headers: { 'x-vibe-connector-id': 'c'.repeat(43) } });
    assert.equal(blocked.status, 401);
    assert.equal((await blocked.json()).code, 'RELAY_LOGIN_REQUIRED');

    const page = await fetch(`${base}/app`, { redirect: 'manual' });
    assert.equal(page.status, 302);
    assert.match(page.headers.get('location'), /^\/relay\/login\?next=%2Fapp/);

    const login = await fetch(`${base}/relay/login?next=/app`, { redirect: 'manual' });
    const location = new URL(login.headers.get('location'));
    assert.equal(location.origin + location.pathname, 'https://toolkit.example/api/v1/vibe-relay/authorize');
    assert.equal(location.searchParams.get('return'), 'http://127.0.0.1');
    const state = location.searchParams.get('state');
    const stateCookie = login.headers.get('set-cookie').split(';')[0];

    const assertion = toolkitAssertion({ aud: 'http://127.0.0.1', nonce: 'n1' });
    const bad = await fetch(`${base}/relay/session`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: stateCookie }, body: JSON.stringify({ assertion, state: 'wrong' }) });
    assert.equal(bad.status, 400);
    const ok = await fetch(`${base}/relay/session`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: stateCookie }, body: JSON.stringify({ assertion, state }) });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).next, '/app');
    const session = ok.headers.getSetCookie().find(c => c.startsWith(ACCOUNT_COOKIE)).split(';')[0];
    assert.match(ok.headers.getSetCookie().join(';'), /Max-Age=31536000/);

    const replay = await fetch(`${base}/relay/session`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: stateCookie }, body: JSON.stringify({ assertion, state }) });
    assert.equal(replay.status, 401);

    const through = await fetch(`${base}/api/state`, { headers: { cookie: session, 'x-vibe-connector-id': 'c'.repeat(43) } });
    assert.equal(through.status, 503, 'logged-in traffic passes auth and reaches connector routing');
    assert.equal((await through.json()).code, 'CONNECTOR_OFFLINE');
    assert.equal((await (await fetch(`${base}/relay/account`, { headers: { cookie: session } })).json()).loggedIn, true);
  } finally { relay.server.close(); }
});

test('default mode keeps the Relay open (no login) for existing installs', async () => {
  const relay = createRelayServer({ audit() {} });
  const port = await listen(relay.server);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/state`, { headers: { 'x-vibe-connector-id': 'c'.repeat(43) } });
    assert.equal((await res.json()).code, 'CONNECTOR_OFFLINE');
  } finally { relay.server.close(); }
});

test('required mode refuses to start without a secret', () => {
  assert.throws(() => createRelayServer({ accountMode: 'required', publicUrl: 'http://127.0.0.1' }), /PANEL_RELAY_TOOLKIT_SECRET/);
});

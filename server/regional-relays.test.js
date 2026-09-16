import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRelayServer } from './relay.js';
import { RelayConnector } from './relay-connector.js';
import { PairingStore, readCookie } from './pairing.js';
import { installRelayAuthorization } from './relay-authorization.js';
import { requestDeduplication } from './request-deduplication.js';
import { connectorRelayConfig } from './relay-config.js';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
async function until(check) { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.ok(check()); }

test('regional defaults and explicit private/legacy endpoints stay separate', () => {
  const defaults = connectorRelayConfig({});
  assert.equal(defaults.publicOrigin, 'https://vibe.toolkit.fun');
  assert.equal(defaults.origins.length, 2);
  assert.deepEqual(connectorRelayConfig({ PANEL_RELAY_URL: 'https://vibe.tooluse.app' }), { origins: ['https://vibe.tooluse.app'], publicOrigin: 'https://vibe.tooluse.app' });
  assert.throws(() => connectorRelayConfig({ PANEL_RELAY_URL: 'http://example.com' }));
  assert.throws(() => connectorRelayConfig({ PANEL_RELAY_URL: 'https://user:password@example.com' }));
});

test('two regions share device revocation and deduplication, isolate disconnects, and restrict CORS/cookies', async () => {
  const folder = await mkdtemp(path.join(tmpdir(), 'vibe-regions-'));
  const store = new PairingStore({ filePath: path.join(folder, 'devices.json') });
  await store.init();
  const relays = [createRelayServer({ routing: true }), createRelayServer({ routing: true })];
  const ports = await Promise.all(relays.map(relay => listen(relay.server)));
  const origins = ports.map(port => `http://127.0.0.1:${port}`);
  const app = express(); app.use(express.json());
  installRelayAuthorization(app, { store, origins, setCookie: (_req, res, token) => res.set('Set-Cookie', `vibe_panel_device=${token}; HttpOnly; Path=/`) });
  app.use(async (req, res, next) => {
    if (!await store.authenticate(readCookie(req.headers.cookie, 'vibe_panel_device'))) return res.sendStatus(401);
    next();
  });
  const dedup = requestDeduplication(); app.use(dedup.middleware);
  let executions = 0;
  app.post('/api/action', (_req, res) => res.json({ executions: ++executions }));
  app.get('/api/cookies', (req, res) => res.json({ cookie: req.headers.cookie }));
  let finishSlow;
  app.get('/api/slow', (_req, res) => { finishSlow = () => res.json({ ok: true }); });
  const api = http.createServer(app); const apiPort = await listen(api);
  const credential = 'a'.repeat(64);
  const connectorId = createHash('sha256').update(credential).digest('base64url');
  const uplinks = origins.map(origin => new RelayConnector({ origin, connectorId, credential, apiPort }));
  uplinks.forEach(uplink => uplink.connect());
  try {
    await until(() => relays.every(relay => relay.connectors.size === 1));
    const paired = await store.exchange(store.createCode().code);
    const headers = { 'X-Vibe-Connector-Id': connectorId, Cookie: `token=toolkit-secret; unrelated=private; vibe_panel_device=${paired.token}`, 'Content-Type': 'application/json' };
    const call = (region, route, options = {}) => fetch(`${origins[region]}${route}`, { ...options, headers: { ...headers, ...options.headers } });
    const cookies = await (await call(0, '/api/cookies')).json();
    assert.equal(cookies.cookie, `vibe_panel_device=${paired.token}`);
    const denied = await call(0, '/api/cookies', { headers: { Origin: 'https://other.toolkit.fun' } });
    assert.equal(denied.status, 403);
    const allowed = await call(0, '/api/cookies', { headers: { Origin: 'https://vibe.toolkit.fun' } });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://vibe.toolkit.fun');
    const probe = await (await call(0, `/relay/probe?connector=${connectorId}`)).json();
    assert.equal(probe.online, true);
    const { tickets } = await (await call(0, '/api/relay-tickets', { method: 'POST', body: '{}' })).json();
    assert.equal(tickets.length, 1);
    const redeem = { method: 'POST', headers: { Cookie: '' }, body: JSON.stringify({ ticket: tickets[0].ticket }) };
    assert.equal((await call(0, '/api/relay-authorize', redeem)).status, 401, 'wrong audience');
    const transferred = await call(1, '/api/relay-authorize', redeem);
    assert.equal(transferred.status, 200);
    assert.match(transferred.headers.get('set-cookie'), /HttpOnly/);
    assert.equal((await call(1, '/api/relay-authorize', redeem)).status, 401, 'single use');
    const action = { method: 'POST', body: '{}', headers: { 'X-Vibe-Request-Id': 'same-request-123456', 'X-Vibe-Instance-Id': dedup.instanceId } };
    assert.deepEqual(await (await call(0, '/api/action', action)).json(), { executions: 1 });
    assert.deepEqual(await (await call(1, '/api/action', action)).json(), { executions: 1 });
    assert.equal(executions, 1);
    assert.equal((await call(1, '/api/action', { ...action, body: '{"different":true}' })).status, 409);
    assert.equal((await call(1, '/api/action', { ...action, headers: { ...action.headers, 'X-Vibe-Instance-Id': 'old-boot' } })).status, 409);
    const slow = call(1, '/api/slow');
    await until(() => Boolean(finishSlow));
    uplinks[0].stop();
    await until(() => relays[0].connectors.size === 0);
    finishSlow();
    assert.deepEqual(await (await slow).json(), { ok: true }, 'other region survives');
    await store.revoke(paired.device.id);
    assert.equal((await call(1, '/api/cookies')).status, 401);
  } finally {
    uplinks.forEach(uplink => uplink.stop());
    await until(() => relays.every(relay => relay.connectors.size === 0));
    await Promise.all([...relays.map(relay => relay.server), api].map(server => new Promise(resolve => server.close(resolve))));
    await rm(folder, { recursive: true, force: true });
  }
});


test('regional controller scan preserves identity and pairing code and serves an offline pairing shell', async t => {
  const folder = await mkdtemp(path.join(tmpdir(), 'vibe-controller-shell-'));
  await writeFile(path.join(folder, 'controller.html'), '<title>Controller pairing shell</title>');
  const relay = createRelayServer({routing:true, distDir:folder});
  const port = await listen(relay.server);
  t.after(async () => { await new Promise(resolve => relay.server.close(resolve)); await rm(folder,{recursive:true,force:true}); });
  const base = `http://127.0.0.1:${port}`;
  const id = 'a'.repeat(43);
  const response = await fetch(`${base}/app?relay=${id}&next=controller&pair=ABCD1234`, {redirect:'manual'});
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), `/api/desktop-controller/view?relay=${id}&pair=ABCD1234`);
  const shell = await fetch(base + response.headers.get('location'));
  assert.equal(shell.status,200);
  assert.match(await shell.text(), /Controller pairing shell/);
  assert.equal((await fetch(`${base}/api/desktop-controller/status`)).status, 503);
});

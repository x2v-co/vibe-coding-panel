import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createRelayMetrics, shanghaiDate } from './relay-metrics.js';
import { createRelayServer } from './relay.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relay-metrics-'));
const quiet = () => {};
const values = rows => Object.fromEntries(rows.map(r => [`${r.date}:${r.metric}`, r.value]));

test('days are split in Beijing time', () => {
  assert.equal(shanghaiDate(Date.parse('2026-10-19T15:59:59Z')), '2026-10-19');
  assert.equal(shanghaiDate(Date.parse('2026-10-19T16:00:00Z')), '2026-10-20');
});

test('metrics are off without a directory and never touch disk', () => {
  const metrics = createRelayMetrics({});
  assert.equal(metrics.enabled, false);
  metrics.recordDevice('x'); metrics.recordPairing(); metrics.close();
});

test('counts devices by keyed hash, detects new devices across days and restarts, stores no raw ids', () => {
  const dir = tmp();
  let clock = Date.parse('2026-10-19T02:00:00Z');
  const now = () => clock;
  let metrics = createRelayMetrics({ dir, salt: 's'.repeat(32), now, log: quiet });
  metrics.recordDevice('phone-token-A');
  metrics.recordDevice('phone-token-A');
  metrics.recordDevice('phone-token-B');
  metrics.recordPairing();
  metrics.recordConnectorOpen('connector-1');
  metrics.close();

  // Restart on the same day keeps today's distinct set.
  metrics = createRelayMetrics({ dir, salt: 's'.repeat(32), now, log: quiet });
  metrics.recordDevice('phone-token-A');
  let v = values(metrics.rows('2026-10-19', '2026-10-19'));
  assert.equal(v['2026-10-19:active_devices'], 2);
  assert.equal(v['2026-10-19:new_devices'], 2);
  assert.equal(v['2026-10-19:pairings'], 1);
  assert.equal(v['2026-10-19:sessions'], 1);
  assert.equal(v['2026-10-19:active_connectors'], 1);

  // Next Beijing day: A returns (not new), C is new.
  clock = Date.parse('2026-10-19T16:30:00Z');
  metrics.recordDevice('phone-token-A');
  metrics.recordDevice('phone-token-C');
  metrics.close();
  v = values(metrics.rows('2026-10-19', '2026-10-20'));
  assert.equal(v['2026-10-19:active_devices'], 2);
  assert.equal(v['2026-10-20:active_devices'], 2);
  assert.equal(v['2026-10-20:new_devices'], 1);
  assert.equal(v['2026-10-20:total_devices'], 3);
  assert.equal(v['2026-10-20:pairings'], 0);

  const csv = fs.readFileSync(path.join(dir, 'daily', '2026-10-19.csv'), 'utf8');
  assert.match(csv, /^date,metric,value\n2026-10-19,pairings,1\n/);
  for (const file of ['state.json', 'seen-devices.txt', 'seen-connectors.txt', 'daily/2026-10-19.csv']) {
    const text = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(text, /phone-token|connector-1/);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'seen-devices.txt'), 'utf8').trim().split('\n').length, 3);
});

test('a missing salt is generated once and persisted with owner-only permissions', () => {
  const dir = tmp();
  const a = createRelayMetrics({ dir, log: quiet });
  a.recordDevice('t'); a.close();
  const salt = fs.readFileSync(path.join(dir, 'metrics-salt'), 'utf8');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'metrics-salt')).mode & 0o777, 0o600);
  const b = createRelayMetrics({ dir, log: quiet });
  b.recordDevice('t');
  assert.equal(values(b.rows('2000-01-01', '2999-12-31'))[`${b.today()}:new_devices`], 1);
  b.close();
  assert.equal(fs.readFileSync(path.join(dir, 'metrics-salt'), 'utf8'), salt);
});

test('a short salt or an unwritable directory disables metrics instead of crashing', () => {
  assert.equal(createRelayMetrics({ dir: tmp(), salt: 'short', log: quiet }).enabled, false);
  const file = path.join(tmp(), 'not-a-dir');
  fs.writeFileSync(file, '');
  assert.equal(createRelayMetrics({ dir: path.join(file, 'x'), log: quiet }).enabled, false);
});

test('a reconnect does not start a new session', () => {
  const metrics = createRelayMetrics({ dir: tmp(), salt: 's'.repeat(32), now: () => Date.parse('2026-10-19T02:00:00Z'), log: quiet });
  metrics.recordConnectorOpen('c');
  metrics.recordConnectorOpen('c', { newSession: false });
  metrics.recordConnectorOpen('d');
  const v = values(metrics.rows('2026-10-19', '2026-10-19'));
  assert.equal(v['2026-10-19:sessions'], 2);
  assert.equal(v['2026-10-19:active_connectors'], 2);
  assert.equal(v['2026-10-19:abnormal_disconnect_ratio'], null);
  metrics.close();
});

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('relay counts pairings, devices and sessions, and serves them behind a bearer token', async () => {
  const dir = tmp();
  const relay = createRelayServer({ metricsDir: dir, metricsSalt: 'k'.repeat(32), metricsToken: 'secret-token' });
  const port = await listen(relay.server);
  const credential = 'z'.repeat(64);
  const id = createHash('sha256').update(credential).digest('base64url');
  const socket = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay/connect?id=${id}`, { headers: { Authorization: `Bearer ${credential}` } });
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
  socket.on('message', raw => {
    const message = JSON.parse(raw.toString());
    if (message.type !== 'request') return;
    const status = message.path === '/api/pair' ? 201 : message.path === '/api/jobs/denied' ? 401 : 200;
    socket.send(JSON.stringify({ type: 'response-start', requestId: message.requestId, status, headers: {} }));
    socket.send(JSON.stringify({ type: 'response-end', requestId: message.requestId }));
  });
  const base = `http://127.0.0.1:${port}`;
  const call = (p, device, init = {}) => fetch(base + p, { ...init, headers: { Cookie: `vibe_relay_connector=${id}${device ? `; __Host-vibe_panel_device=${device}` : ''}`, 'Content-Type': 'application/json' } });
  try {
    assert.equal((await call('/api/pair', '', { method: 'POST', body: '{}' })).status, 201);
    await call('/api/jobs', 'dev-1');
    await call('/api/jobs', 'dev-1');
    await call('/api/jobs', 'dev-2');
    await call('/api/health', 'forged-3');      // answered for anyone: not counted
    await call('/api/jobs/denied', 'forged-4'); // rejected by the computer: not counted

    assert.equal((await fetch(`${base}/metrics/daily`)).status, 401);
    assert.equal((await fetch(`${base}/metrics/daily`, { headers: { Authorization: 'Bearer wrong' } })).status, 401);
    assert.equal((await fetch(`${base}/metrics/daily?from=bad`, { headers: { Authorization: 'Bearer secret-token' } })).status, 400);
    const body = await fetch(`${base}/metrics/daily`, { headers: { Authorization: 'Bearer secret-token' } }).then(r => r.json());
    assert.equal(body.timezone, 'Asia/Shanghai');
    const today = relay.metrics.today();
    assert.deepEqual(body.partial, [today]);
    const v = values(body.rows);
    assert.equal(v[`${today}:pairings`], 1);
    assert.equal(v[`${today}:active_devices`], 2);
    assert.equal(v[`${today}:new_devices`], 2);
    assert.equal(v[`${today}:sessions`], 1);
    assert.equal(v[`${today}:active_connectors`], 1);

    const csv = await fetch(`${base}/metrics/daily?format=csv&from=${today}&to=${today}`, { headers: { Authorization: 'Bearer secret-token' } }).then(r => r.text());
    assert.match(csv, new RegExp(`^date,metric,value\\n${today},pairings,1\\n`));
  } finally {
    socket.close();
    await new Promise(resolve => socket.once('close', resolve));
    await new Promise(resolve => relay.server.close(resolve));
  }
  assert.match(fs.readFileSync(path.join(dir, 'daily', `${shanghaiDate(Date.now())}.csv`), 'utf8'), /,active_devices,2\n/);
});

test('the metrics endpoint is absent unless a token is configured', async () => {
  const relay = createRelayServer({ metricsDir: tmp(), metricsSalt: 'k'.repeat(32) });
  const port = await listen(relay.server);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/metrics/daily`, { headers: { Authorization: 'Bearer ' } });
    assert.equal(response.status, 404);
  } finally {
    await new Promise(resolve => relay.server.close(resolve));
  }
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createRelayMetrics } from './relay-metrics.js';
import { alertConfig, createAlerter, createConnectionMonitor, createEventLog, regionFrom } from './relay-quality.js';
import { createRelayServer } from './relay.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'relay-quality-'));
const quiet = () => {};
const values = rows => Object.fromEntries(rows.map(r => [r.metric, r.value]));
const readEvents = dir => fs.readdirSync(path.join(dir, 'events')).flatMap(name => fs.readFileSync(path.join(dir, 'events', name), 'utf8').trim().split('\n').map(line => JSON.parse(line)));

function setup({ alerter, alerts } = {}) {
  const dir = tmp();
  let clock = Date.parse('2026-10-19T02:00:00Z');
  const now = () => clock;
  const metrics = createRelayMetrics({ dir, salt: 's'.repeat(32), now, log: quiet });
  const monitor = createConnectionMonitor({ metrics, events: createEventLog({ dir, now, log: quiet }), alerter, alerts, region: 'cn', now });
  return { dir, metrics, monitor, tick: ms => { clock += ms; } };
}

test('region comes from PANEL_RELAY_REGION or the public URL', () => {
  assert.equal(regionFrom({}, { PANEL_RELAY_REGION: 'Global' }), 'global');
  assert.equal(regionFrom({}, { PANEL_RELAY_PUBLIC_URL: 'https://vibe-relay-cn.toolkit.fun' }), 'cn');
  assert.equal(regionFrom({}, { PANEL_RELAY_PUBLIC_URL: 'https://vibe-relay-global.toolkit.fun' }), 'global');
  assert.equal(regionFrom({}, {}), 'unknown');
});

test('quality aggregates: abnormal ratio, durations, reconnect success, heartbeat timeouts, rtt', () => {
  const { dir, metrics, monitor, tick } = setup();
  monitor.attempt();
  let ctx = monitor.opened('computer-1');
  monitor.pong(ctx, 40); monitor.pong(ctx, 60); monitor.latency(ctx, 120);
  tick(100_000);
  monitor.heartbeatTimeout(ctx);
  monitor.closed(ctx, 1006, '');              // abnormal, 100 s
  tick(5_000);
  monitor.attempt();
  ctx = monitor.opened('computer-1');          // reconnect inside grace: success
  tick(200_000);
  monitor.closed(ctx, 1000, 'bye');           // normal, 200 s
  monitor.attempt();
  monitor.rejected('computer-2', 409, 'conflict');
  monitor.attempt();
  const other = monitor.opened('computer-3');
  tick(10_000);
  monitor.closed(other, 1011, 'server error'); // abnormal, never comes back
  tick(31 * 60_000);
  monitor.evaluate();                          // grace expired: reconnect failure

  const v = values(metrics.rows('2026-10-19', '2026-10-19'));
  assert.equal(v.connect_attempts, 4);
  assert.equal(v.connect_failures, 1);
  assert.equal(v.disconnects, 3);
  assert.equal(v.abnormal_disconnects, 2);
  assert.equal(v.abnormal_disconnect_ratio, 0.6667);
  assert.equal(v.connection_duration_avg_s, 103);
  assert.equal(v.connection_duration_p95_s, 200);
  assert.equal(v.reconnect_success_rate, 0.5);
  assert.equal(v.heartbeat_timeouts, 1);
  assert.equal(v.rtt_avg_ms, 50);
  assert.equal(v.sessions, 2);

  const events = readEvents(dir);
  assert.deepEqual(events.map(e => e.event), ['connect', 'heartbeat_timeout', 'disconnect', 'reconnect', 'disconnect', 'connect_failed', 'connect', 'disconnect', 'reconnect_failed']);
  const first = events[2];
  assert.equal(first.region, 'cn');
  assert.equal(first.close_code, 1006);
  assert.equal(first.closed_by, 'heartbeat_timeout');
  assert.equal(first.abnormal, true);
  assert.equal(first.duration_ms, 100_000);
  assert.equal(first.rtt_avg_ms, 50);
  assert.equal(first.latency_avg_ms, 120);
  assert.match(first.conn, /^[0-9a-f]{32}$/);
  assert.equal(events[3].session, events[0].session);
  assert.equal(events[3].reconnects, 1);
  assert.equal(events[3].gap_ms, 5000);
  assert.doesNotMatch(JSON.stringify(events), /computer-|127\.0\.0\.1/);
  monitor.close(); metrics.close();
});

test('event logs rotate by Beijing day and keep at least 30 days', () => {
  const dir = tmp();
  let clock = Date.parse('2026-10-19T02:00:00Z');
  const events = createEventLog({ dir, retentionDays: 7, now: () => clock, log: quiet });
  fs.writeFileSync(path.join(dir, 'events', '2026-09-01.jsonl'), '{}\n');
  fs.writeFileSync(path.join(dir, 'events', '2026-09-25.jsonl'), '{}\n');
  events.write({ event: 'connect' });
  clock = Date.parse('2026-10-19T16:30:00Z');
  events.write({ event: 'connect' });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'events')).sort(), ['2026-09-25.jsonl', '2026-10-19.jsonl', '2026-10-20.jsonl']);
});

test('alerts fire above threshold once per cooldown and send a recovery', async () => {
  const sent = [];
  let clock = 0;
  const alerts = alertConfig({ alertWindowMin: 10, alertAbnormalRatio: 0.3, alertMinEvents: 4, alertCooldownMin: 60, alertTgToken: 'T', alertTgChatId: '42', alertProxy: 'http://proxy:3128' }, {});
  const alerter = createAlerter(alerts, { region: 'global', now: () => clock, send: async (url, payload, opts) => { sent.push({ url, payload, opts }); } });
  assert.equal(await alerter.evaluate('abnormal', { ratio: 0.9, count: 3, total: 3 }, 0.3, 'abnormal disconnect rate'), 'ok'); // below min events
  assert.equal(await alerter.evaluate('abnormal', { ratio: 0.5, count: 2, total: 4 }, 0.3, 'abnormal disconnect rate'), 'fired');
  clock += 10 * 60_000;
  assert.equal(await alerter.evaluate('abnormal', { ratio: 0.5, count: 2, total: 4 }, 0.3, 'abnormal disconnect rate'), 'firing');
  assert.equal(await alerter.evaluate('abnormal', { ratio: 0.1, count: 1, total: 10 }, 0.3, 'abnormal disconnect rate'), 'recovered');
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url, 'https://api.telegram.org/botT/sendMessage');
  assert.equal(sent[0].payload.chat_id, '42');
  assert.match(sent[0].payload.text, /^\[vibe-relay\] global abnormal disconnect rate 50\.0% \(2\/4\)/);
  assert.equal(sent[0].opts.proxy, 'http://proxy:3128');
  assert.match(sent[1].payload.text, /recovered/);
});

test('monitor windows drive connect-failure alerts', async () => {
  const sent = [];
  const alerts = alertConfig({ alertMinEvents: 3, alertConnectFailRatio: 0.5, alertTgToken: 'T', alertTgChatId: '1' }, {});
  const { monitor, metrics } = setup({ alerts, alerter: createAlerter(alerts, { region: 'cn', send: async (_u, payload) => { sent.push(payload.text); } }) });
  for (let i = 0; i < 4; i += 1) { monitor.attempt(); monitor.rejected(null, 401, 'auth'); }
  const result = await monitor.evaluate();
  assert.deepEqual(result, ['ok', 'fired']);
  assert.match(sent[0], /cn connect failure rate 100\.0% \(4\/4\)/);
  assert.equal(monitor.health().errors_5m, 4);
  monitor.close(); metrics.close();
});

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

test('relay /healthz reports connections and recent disconnects; events land on the volume', async () => {
  const dir = tmp();
  const relay = createRelayServer({ metricsDir: dir, metricsSalt: 'k'.repeat(32), region: 'global', alerter: { enabled: false } });
  const port = await listen(relay.server);
  const credential = 'q'.repeat(64);
  const id = createHash('sha256').update(credential).digest('base64url');
  const open = () => new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/relay/connect?id=${id}`, { headers: { Authorization: `Bearer ${credential}` } });
    ws.once('open', () => resolve(ws)); ws.once('error', reject);
  });
  try {
    const first = await open();
    let health = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.json());
    assert.equal(health.region, 'global');
    assert.deepEqual(health.connections, { current: 1, disconnects_5m: 0, abnormal_disconnects_5m: 0, errors_5m: 0 });
    first.close(4000, 'test');
    await new Promise(resolve => first.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 50));
    const second = await open();
    second.close(1000);
    await new Promise(resolve => second.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 50));
    health = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.json());
    assert.deepEqual(health.connections, { current: 0, disconnects_5m: 2, abnormal_disconnects_5m: 1, errors_5m: 0 });
  } finally {
    await new Promise(resolve => relay.server.close(resolve));
  }
  const events = readEvents(dir);
  assert.deepEqual(events.map(e => e.event), ['connect', 'disconnect', 'reconnect', 'disconnect']);
  assert.equal(events[1].close_code, 4000);
  assert.equal(events[1].reason, 'test');
  assert.equal(events[3].abnormal, false);
  assert.doesNotMatch(JSON.stringify(events), /127\.0\.0\.1|qqqq/);
});

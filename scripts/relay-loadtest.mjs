#!/usr/bin/env node
// Relay load test (staging / temporary environments only - never production).
//
// Local (default): spawns a throw-away `server/relay.js` on loopback and samples
// its RSS / CPU from /proc (Linux) or `ps`. Remote: --target https://<staging-relay>
// (production hostnames are refused); CPU/RSS then come from the host's own
// monitoring, the script reports latency / errors / reconnects / limits.
//
// Measures: per-connection memory and CPU, max concurrency per process before
// SLO breach, reconnect behaviour, and whether per-account rate limiting fires.
//
//   node scripts/relay-loadtest.mjs --steps 50,100,200,400 --rps 0.5 --duration 20
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { issueSession, ACCOUNT_COOKIE } from '../server/relay-account.js';

const PRODUCTION_HOSTS = new Set(['vibe.toolkit.fun', 'vibe-relay-cn.toolkit.fun', 'vibe-relay-global.toolkit.fun', '82.157.206.149', '129.226.95.67']);
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, item, i, all) => {
  if (item.startsWith('--')) acc.push([item.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : 'true']);
  return acc;
}, []));
const steps = String(args.steps || '25,50,100,200').split(',').map(Number).filter(n => n > 0);
const rps = Number(args.rps || 0.5);            // requests per second per phone
const duration = Number(args.duration || 15);   // seconds per step
const payloadBytes = Number(args.payload || 2048);
const sloP99Ms = Number(args['slo-p99'] || 1000);
const sloErrorPct = Number(args['slo-errors'] || 1);
const out = args.out || '';

const target = args.target ? new URL(args.target) : null;
if (target && (PRODUCTION_HOSTS.has(target.hostname) || /(^|\.)toolkit\.fun$/.test(target.hostname) && !/staging|test|tmp/.test(target.hostname))) {
  console.error(`Refusing to load-test ${target.hostname}: production. Use staging or a temporary relay.`);
  process.exit(2);
}

const TEST_SECRET = randomBytes(32).toString('base64url');
const sessionSecret = target ? String(process.env.PANEL_LOADTEST_SESSION_SECRET || '') : createHmac('sha256', TEST_SECRET).update('vibe-relay-session').digest('base64url');
const accountRate = Number(args['account-rate'] || 60);

let child = null;
let base = target ? target.origin : '';
async function startLocalRelay() {
  const port = 20000 + Math.floor(Math.random() * 20000);
  child = spawn(process.execPath, ['server/relay.js'], {
    env: {
      ...process.env,
      PANEL_RELAY_PORT: String(port), PANEL_RELAY_HOST: '127.0.0.1',
      PANEL_RELAY_PUBLIC_URL: `http://127.0.0.1:${port}`,
      PANEL_RELAY_MAX_CONNECTORS: String(Number(args['max-connectors'] || 100000)),
      PANEL_RELAY_MAX_INFLIGHT: String(Number(args['max-inflight'] || 100000)),
      PANEL_RELAY_RATE_LIMIT: '1000000', PANEL_RELAY_TRUST_PROXY: '127.0.0.1',
      PANEL_RELAY_ACCOUNT_MODE: 'required', PANEL_RELAY_TOOLKIT_SECRET: TEST_SECRET,
      PANEL_RELAY_PER_ACCOUNT_RATE_LIMIT: String(accountRate),
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* starting */ }
    await sleep(100);
  }
  throw new Error('local relay did not start');
}

const clkTck = (() => { try { return Number(execFileSync('getconf', ['CLK_TCK']).toString()) || 100; } catch { return 100; } })();
function sample() {
  if (!child) return null;
  try {
    const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1].split(' ');
    const rssKb = Number(readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/)[1]);
    return { rssMb: rssKb / 1024, cpuSec: (Number(stat[11]) + Number(stat[12])) / clkTck, at: performance.now() };
  } catch {
    const [rss, time] = execFileSync('ps', ['-o', 'rss=,time=', '-p', String(child.pid)]).toString().trim().split(/\s+/);
    const [h, m, s] = time.split(':').map(Number);
    return { rssMb: Number(rss) / 1024, cpuSec: (h || 0) * 3600 + (m || 0) * 60 + (s || 0), at: performance.now() };
  }
}

let ipSeq = 1;
const nextIp = () => { const n = ipSeq++; return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`; };
const account = () => randomBytes(32).toString('base64url').slice(0, 43);
const cookieFor = sub => sessionSecret ? `${ACCOUNT_COOKIE}=${encodeURIComponent(issueSession({ sub, plan: 'free' }, sessionSecret))}` : '';
const body = Buffer.alloc(payloadBytes, 120).toString('base64');

function respond(ws) {
  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString());
    if (msg.type !== 'request') return;
    ws.send(JSON.stringify({ type: 'response-start', requestId: msg.requestId, status: 200, headers: { 'content-type': 'application/octet-stream' } }));
    ws.send(JSON.stringify({ type: 'response-chunk', requestId: msg.requestId, data: body }));
    ws.send(JSON.stringify({ type: 'response-end', requestId: msg.requestId }));
  });
}

function openConnector() {
  const credential = randomBytes(48).toString('base64url');
  const id = createHash('sha256').update(credential).digest('base64url');
  const ip = nextIp();
  const started = performance.now();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/relay/connect?id=${id}`, { headers: { Authorization: `Bearer ${credential}`, 'X-Forwarded-For': ip } });
    respond(ws);
    ws.once('open', () => resolve({ ws, id, credential, ip, sub: account(), connectMs: performance.now() - started }));
    ws.once('unexpected-response', (_q, res) => reject(new Error(`upgrade ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

async function phoneRequest(c, stats) {
  const t = performance.now();
  try {
    const res = await fetch(`${base}/api/loadtest`, { headers: { 'x-vibe-connector-id': c.id, 'X-Forwarded-For': c.ip, cookie: cookieFor(c.sub) } });
    await res.arrayBuffer();
    stats.lat.push(performance.now() - t);
    if (res.status === 200) stats.ok++; else { stats.err++; stats.codes[res.status] = (stats.codes[res.status] || 0) + 1; }
  } catch { stats.err++; stats.codes.network = (stats.codes.network || 0) + 1; }
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

async function runStep(connectors, n) {
  while (connectors.length < n) {
    const batch = await Promise.allSettled(Array.from({ length: Math.min(50, n - connectors.length) }, openConnector));
    const failed = batch.filter(r => r.status === 'rejected');
    connectors.push(...batch.filter(r => r.status === 'fulfilled').map(r => r.value));
    if (failed.length) return { n, connected: connectors.length, connectError: String(failed[0].reason?.message || failed[0].reason) };
  }
  await sleep(500);
  const before = sample();
  const stats = { ok: 0, err: 0, lat: [], codes: {} };
  const end = Date.now() + duration * 1000;
  const loops = connectors.map(async c => {
    await sleep(Math.random() * 1000 / rps);
    while (Date.now() < end) { await phoneRequest(c, stats); await sleep(1000 / rps); }
  });
  await Promise.all(loops);
  const after = sample();
  const total = stats.ok + stats.err;
  const row = { connectors: connectors.length, requests: total, errorPct: total ? round(stats.err / total * 100) : 0, p50Ms: round(pct(stats.lat, 50)), p99Ms: round(pct(stats.lat, 99)), codes: stats.codes };
  if (before && after) {
    row.rssMb = round(after.rssMb);
    row.cpuPct = round((after.cpuSec - before.cpuSec) / ((after.at - before.at) / 1000) * 100, 1);
  }
  return row;
}

async function reconnectTest(connectors, k = Math.min(20, connectors.length)) {
  const victims = connectors.splice(0, k);
  let conflicts = 0; const times = [];
  for (const v of victims) v.ws.terminate();
  await sleep(200);
  for (const v of victims) {
    const t = performance.now();
    for (let attempt = 0; attempt < 20; attempt++) {
      const ok = await new Promise(resolve => {
        const ws = new WebSocket(`${base.replace(/^http/, 'ws')}/relay/connect?id=${v.id}`, { headers: { Authorization: `Bearer ${v.credential}`, 'X-Forwarded-For': v.ip } });
        ws.once('open', () => { respond(ws); v.ws = ws; resolve(true); });
        ws.once('unexpected-response', (_q, res) => { if (res.statusCode === 409) conflicts++; resolve(false); });
        ws.once('error', () => resolve(false));
      });
      if (ok) { times.push(performance.now() - t); connectors.push(v); break; }
      await sleep(250);
    }
  }
  const probe = connectors.at(-1);
  const stats = { ok: 0, err: 0, lat: [], codes: {} };
  if (probe) await phoneRequest(probe, stats);
  return { dropped: k, reconnected: times.length, p50Ms: round(pct(times, 50)), maxMs: round(Math.max(0, ...times)), conflicts409: conflicts, trafficAfterReconnect: stats.ok === 1 };
}

async function rateLimitTest(connectors) {
  if (!sessionSecret) return { skipped: 'remote target without PANEL_LOADTEST_SESSION_SECRET' };
  const [a, b] = connectors;
  const statuses = [];
  for (let i = 0; i < accountRate + 5; i++) {
    const res = await fetch(`${base}/api/loadtest`, { headers: { 'x-vibe-connector-id': a.id, 'X-Forwarded-For': nextIp(), cookie: cookieFor('L'.repeat(43)) } });
    statuses.push(res.status === 429 ? (await res.json()).code : res.status); if (res.status !== 429) await res.arrayBuffer();
  }
  const other = await fetch(`${base}/api/loadtest`, { headers: { 'x-vibe-connector-id': b.id, 'X-Forwarded-For': nextIp(), cookie: cookieFor('M'.repeat(43)) } });
  await other.arrayBuffer();
  const noLogin = await fetch(`${base}/api/loadtest`, { headers: { 'x-vibe-connector-id': b.id, 'X-Forwarded-For': nextIp() } });
  return {
    limitPerMin: accountRate,
    allowedBeforeLimit: statuses.findIndex(s => s === 'RELAY_ACCOUNT_LIMITED'),
    limitedCode: statuses.at(-1),
    otherAccountStatus: other.status,
    withoutLoginStatus: noLogin.status,
  };
}

const result = { at: new Date().toISOString(), mode: target ? `remote ${target.host}` : 'local temporary relay', node: process.version, rps, duration, payloadBytes, slo: { p99Ms: sloP99Ms, errorPct: sloErrorPct }, steps: [] };
try {
  if (!target) await startLocalRelay();
  const idle = sample();
  if (idle) result.idleRssMb = round(idle.rssMb);
  const connectors = [];
  for (const n of steps) {
    const row = await runStep(connectors, n);
    result.steps.push(row);
    console.log(JSON.stringify(row));
    if (row.connectError || row.p99Ms > sloP99Ms || row.errorPct > sloErrorPct) { result.stoppedAt = n; break; }
  }
  const okSteps = result.steps.filter(s => !s.connectError && s.p99Ms <= sloP99Ms && s.errorPct <= sloErrorPct);
  result.maxConnectorsWithinSlo = okSteps.at(-1)?.connectors || 0;
  const last = okSteps.at(-1);
  if (last?.rssMb && result.idleRssMb) result.perConnectorKb = round((last.rssMb - result.idleRssMb) * 1024 / last.connectors, 1);
  if (last?.cpuPct !== undefined) result.perConnectorCpuPct = round(last.cpuPct / last.connectors, 3);
  result.reconnect = await reconnectTest(connectors);
  result.rateLimit = await rateLimitTest(connectors);
  for (const c of connectors) c.ws.terminate();
} finally {
  if (child) child.kill('SIGTERM');
}
console.log(JSON.stringify(result, null, 2));
if (out) writeFileSync(out, JSON.stringify(result, null, 2));

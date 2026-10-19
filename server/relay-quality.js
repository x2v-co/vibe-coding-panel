// Connection-quality monitoring for computer uplinks (Connector WebSockets),
// requested by 老板 on 10-19 so the Relay can be tuned later.
//
// - Structured JSON-lines event log on the metrics volume (events/YYYY-MM-DD.jsonl,
//   Beijing days, pruned after PANEL_RELAY_EVENT_RETENTION_DAYS, minimum 30).
//   Records keyed HMACs, ids, timings and close codes only: never IPs, tokens,
//   paths or message contents.
// - Daily quality aggregates via relay-metrics.js.
// - Rolling counters for /healthz and threshold alerts (Telegram / webhook).
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import tls from 'node:tls';
import { shanghaiDate } from './relay-metrics.js';

const MINUTE = 60_000;
// 1000 normal closure, 1001 going away (Connector quit, Relay shutdown).
export const NORMAL_CLOSE_CODES = new Set([1000, 1001]);

const number = (value, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const parsed = Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

export function regionFrom(options = {}, env = process.env) {
  const explicit = String(options.region ?? env.PANEL_RELAY_REGION ?? '').trim().toLowerCase();
  if (explicit) return explicit.replace(/[^a-z0-9_-]/g, '').slice(0, 16) || 'unknown';
  const url = String(options.publicUrl ?? env.PANEL_RELAY_PUBLIC_URL ?? '');
  if (/-cn\./.test(url) || /\/\/vibe\.toolkit\.fun/.test(url)) return 'cn';
  if (/-global\./.test(url)) return 'global';
  return 'unknown';
}

// Close reasons are short protocol strings; keep them printable and bounded.
const cleanReason = reason => String(reason || '').replace(/[^\x20-\x7e]/g, '').slice(0, 80);

export function createEventLog({ dir, retentionDays = 30, now = Date.now, log = console.error } = {}) {
  if (!dir) return { enabled: false, write() {}, prune() {} };
  const eventsDir = path.join(dir, 'events');
  const keep = Math.max(30, Math.floor(retentionDays));
  try { fs.mkdirSync(eventsDir, { recursive: true }); } catch (error) {
    log(`[relay-events] disabled: ${error.message}`);
    return { enabled: false, write() {}, prune() {} };
  }
  let warned = false;
  let prunedFor = '';
  function prune() {
    const today = shanghaiDate(now());
    if (prunedFor === today) return;
    prunedFor = today;
    const cutoff = shanghaiDate(now() - keep * 24 * 3600 * 1000);
    try {
      for (const name of fs.readdirSync(eventsDir)) {
        const match = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
        if (match && match[1] < cutoff) fs.unlinkSync(path.join(eventsDir, name));
      }
    } catch (error) { log(`[relay-events] prune failed: ${error.message}`); }
  }
  return {
    enabled: true,
    write(event) {
      const at = now();
      prune();
      try {
        fs.appendFileSync(path.join(eventsDir, `${shanghaiDate(at)}.jsonl`), `${JSON.stringify({ ts: new Date(at).toISOString(), ...event })}\n`, { mode: 0o640 });
      } catch (error) {
        if (!warned) { warned = true; log(`[relay-events] write failed: ${error.message}`); }
      }
    },
    prune,
  };
}

export function alertConfig(options = {}, env = process.env) {
  return {
    windowMs: number(options.alertWindowMin ?? env.PANEL_RELAY_ALERT_WINDOW_MIN, 10, { min: 1, max: 1440 }) * MINUTE,
    abnormalRatio: number(options.alertAbnormalRatio ?? env.PANEL_RELAY_ALERT_ABNORMAL_RATIO, 0.3, { min: 0, max: 1 }),
    connectFailRatio: number(options.alertConnectFailRatio ?? env.PANEL_RELAY_ALERT_CONNECT_FAIL_RATIO, 0.3, { min: 0, max: 1 }),
    minEvents: number(options.alertMinEvents ?? env.PANEL_RELAY_ALERT_MIN_EVENTS, 10, { min: 1 }),
    cooldownMs: number(options.alertCooldownMin ?? env.PANEL_RELAY_ALERT_COOLDOWN_MIN, 60, { min: 1 }) * MINUTE,
    tgToken: String(options.alertTgToken ?? env.PANEL_RELAY_ALERT_TG_BOT_TOKEN ?? ''),
    tgChatId: String(options.alertTgChatId ?? env.PANEL_RELAY_ALERT_TG_CHAT_ID ?? ''),
    webhook: String(options.alertWebhook ?? env.PANEL_RELAY_ALERT_WEBHOOK ?? ''),
    proxy: String(options.alertProxy ?? env.PANEL_RELAY_ALERT_PROXY ?? ''),
  };
}

// POST JSON, optionally through an HTTP CONNECT proxy (the CN hosts reach
// Telegram only via their egress proxy, same as the existing notify scripts).
export function postJson(target, payload, { proxy = '', timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(target);
    const body = Buffer.from(JSON.stringify(payload));
    const options = { method: 'POST', hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
      headers: { 'content-type': 'application/json', 'content-length': body.length }, timeout: timeoutMs };
    const send = createConnection => {
      const request = (url.protocol === 'http:' && !createConnection ? http : https).request({ ...options, ...(createConnection ? { createConnection } : {}) }, response => {
        response.resume();
        response.on('end', () => (response.statusCode < 300 ? resolve(response.statusCode) : reject(new Error(`HTTP ${response.statusCode}`))));
      });
      request.on('timeout', () => request.destroy(new Error('timeout')));
      request.on('error', reject);
      request.end(body);
    };
    if (!proxy) return send();
    const p = new URL(proxy);
    const connect = http.request({ host: p.hostname, port: p.port || 80, method: 'CONNECT', path: `${url.hostname}:${url.port || 443}`, timeout: timeoutMs });
    connect.on('connect', (response, socket) => {
      if (response.statusCode !== 200) { socket.destroy(); return reject(new Error(`proxy ${response.statusCode}`)); }
      send(() => tls.connect({ socket, servername: url.hostname }));
    });
    connect.on('timeout', () => connect.destroy(new Error('proxy timeout')));
    connect.on('error', reject);
    connect.end();
  });
}

export function createAlerter(config, { region, now = Date.now, send = postJson, log = console.error } = {}) {
  const channels = [];
  if (config.tgToken && config.tgChatId) {
    channels.push(text => send(`https://api.telegram.org/bot${config.tgToken}/sendMessage`, { chat_id: config.tgChatId, text: `[vibe-relay] ${text}`, disable_web_page_preview: true }, { proxy: config.proxy }));
  }
  if (config.webhook) channels.push(text => send(config.webhook, { text: `[vibe-relay] ${text}` }, { proxy: config.proxy }));
  const firing = new Map(); // kind -> last sent at
  return {
    enabled: channels.length > 0,
    async notify(text) {
      for (const channel of channels) {
        // Never log the URL: it contains the bot token.
        try { await channel(text); } catch (error) { log(`[relay-alerts] delivery failed: ${String(error.message).replace(/bot[^/\s]+/g, 'bot***')}`); }
      }
    },
    // Fires once when a ratio crosses its threshold (repeats after the
    // cooldown while it stays high) and sends one recovery message.
    async evaluate(kind, { ratio, count, total }, threshold, label) {
      const windowMin = Math.round(config.windowMs / MINUTE);
      const breached = total >= config.minEvents && ratio > threshold;
      const last = firing.get(kind);
      if (breached && (last === undefined || now() - last >= config.cooldownMs)) {
        firing.set(kind, now());
        await this.notify(`${region} ${label} ${(ratio * 100).toFixed(1)}% (${count}/${total}) in the last ${windowMin} min, threshold ${(threshold * 100).toFixed(0)}%`);
        return 'fired';
      }
      if (!breached && last !== undefined) {
        firing.delete(kind);
        await this.notify(`${region} ${label} recovered: ${(ratio * 100).toFixed(1)}% (${count}/${total}) in the last ${windowMin} min`);
        return 'recovered';
      }
      return breached ? 'firing' : 'ok';
    },
  };
}

// Rolling timestamps for windowed ratios without unbounded growth.
function createWindow(maxEntries = 50_000) {
  const items = [];
  return {
    push(at, value = 1) { items.push([at, value]); if (items.length > maxEntries) items.splice(0, items.length - maxEntries); },
    count(since, predicate = () => true) {
      while (items.length && items[0][0] < since - 24 * 3600 * 1000) items.shift();
      let n = 0;
      for (const [at, value] of items) if (at >= since && predicate(value)) n += 1;
      return n;
    },
  };
}

export function createConnectionMonitor({ metrics, events, alerter, alerts = alertConfig({}, {}), region = 'unknown', now = Date.now, graceMs = 30 * MINUTE, evaluateMs = MINUTE } = {}) {
  const sessions = new Map(); // connectorId -> { id, reconnects, closedAt, abnormal }
  const attempts = createWindow();
  const failures = createWindow();
  const disconnects = createWindow(); // value: abnormal boolean
  const errors = createWindow();
  const hash = connectorId => (connectorId ? metrics.digest('connector', connectorId) : null);
  const emit = event => events.write({ region, ...event });

  function sweep() {
    const cutoff = now() - graceMs;
    for (const [connectorId, session] of sessions) {
      if (session.closedAt === null || session.closedAt >= cutoff) continue;
      sessions.delete(connectorId);
      if (session.abnormal) {
        metrics.recordQuality('reconnect', false);
        emit({ event: 'reconnect_failed', conn: hash(connectorId), session: session.id, reconnects: session.reconnects, gap_ms: now() - session.closedAt });
      }
    }
  }

  async function evaluate() {
    sweep();
    if (!alerter?.enabled) return [];
    const since = now() - alerts.windowMs;
    const total = disconnects.count(since);
    const abnormal = disconnects.count(since, value => value);
    const tried = attempts.count(since);
    const failed = failures.count(since);
    return [
      await alerter.evaluate('abnormal', { ratio: total ? abnormal / total : 0, count: abnormal, total }, alerts.abnormalRatio, 'abnormal disconnect rate'),
      await alerter.evaluate('connect', { ratio: tried ? failed / tried : 0, count: failed, total: tried }, alerts.connectFailRatio, 'connect failure rate'),
    ];
  }
  const timer = setInterval(() => { evaluate().catch(() => {}); }, evaluateMs);
  timer.unref();

  return {
    attempt() { attempts.push(now()); metrics.recordQuality('attempt'); },
    // Upgrade refused before a socket exists (auth, conflict, capacity...).
    rejected(connectorId, status, reason) {
      failures.push(now()); errors.push(now());
      metrics.recordQuality('failure');
      emit({ event: 'connect_failed', conn: hash(connectorId), status, reason });
    },
    opened(connectorId) {
      sweep();
      const previous = sessions.get(connectorId);
      const reconnect = Boolean(previous && previous.closedAt !== null && now() - previous.closedAt <= graceMs);
      const session = reconnect ? previous : { id: randomUUID(), reconnects: 0 };
      if (reconnect) {
        session.reconnects += 1;
        if (session.abnormal) metrics.recordQuality('reconnect', true);
      }
      const gap = reconnect ? now() - previous.closedAt : undefined;
      Object.assign(session, { closedAt: null, abnormal: false });
      sessions.set(connectorId, session);
      metrics.recordConnectorOpen(connectorId, { newSession: !reconnect });
      const ctx = { connectorId, session, connection: randomUUID().slice(0, 8), openedAt: now(), rtt: [], latency: [], closedBy: 'peer', errors: 0 };
      emit({ event: reconnect ? 'reconnect' : 'connect', conn: hash(connectorId), session: session.id, connection: ctx.connection, reconnects: session.reconnects, ...(gap !== undefined ? { gap_ms: gap } : {}) });
      return ctx;
    },
    pong(ctx, rttMs) {
      if (ctx.rtt.length >= 500) ctx.rtt.shift();
      ctx.rtt.push(rttMs);
      metrics.recordQuality('rtt', rttMs);
    },
    // Relay->computer request until the computer's first response frame.
    latency(ctx, ms) { if (ctx.latency.length >= 500) ctx.latency.shift(); ctx.latency.push(ms); },
    heartbeatTimeout(ctx) {
      ctx.closedBy = 'heartbeat_timeout';
      errors.push(now());
      metrics.recordQuality('heartbeat_timeout');
      emit({ event: 'heartbeat_timeout', conn: hash(ctx.connectorId), session: ctx.session.id, connection: ctx.connection, rtt_last_ms: ctx.rtt.at(-1) ?? null, since_open_ms: now() - ctx.openedAt });
    },
    error(ctx, error) {
      ctx.errors += 1;
      errors.push(now());
      if (ctx.errors <= 3) emit({ event: 'error', conn: hash(ctx.connectorId), session: ctx.session.id, connection: ctx.connection, code: String(error?.code || 'ERROR').slice(0, 40) });
    },
    shuttingDown(ctx) { ctx.closedBy = 'relay_shutdown'; },
    closed(ctx, code, reason) {
      const durationMs = now() - ctx.openedAt;
      const abnormal = ctx.closedBy === 'heartbeat_timeout' || !NORMAL_CLOSE_CODES.has(code);
      Object.assign(ctx.session, { closedAt: now(), abnormal });
      disconnects.push(now(), abnormal);
      metrics.recordQuality('disconnect', { abnormal, durationS: Math.round(durationMs / 1000) });
      const avg = list => (list.length ? Math.round(list.reduce((a, b) => a + b, 0) / list.length) : null);
      emit({
        event: 'disconnect', conn: hash(ctx.connectorId), session: ctx.session.id, connection: ctx.connection,
        close_code: code, reason: cleanReason(reason), closed_by: ctx.closedBy, abnormal, duration_ms: durationMs,
        reconnects: ctx.session.reconnects, rtt_last_ms: ctx.rtt.at(-1) ?? null, rtt_avg_ms: avg(ctx.rtt),
        rtt_max_ms: ctx.rtt.length ? Math.max(...ctx.rtt) : null, requests: ctx.latency.length,
        latency_avg_ms: avg(ctx.latency), latency_max_ms: ctx.latency.length ? Math.max(...ctx.latency) : null, errors: ctx.errors,
      });
    },
    health() {
      const since = now() - 5 * MINUTE;
      return { disconnects_5m: disconnects.count(since), abnormal_disconnects_5m: disconnects.count(since, value => value), errors_5m: errors.count(since) };
    },
    evaluate,
    close() { clearInterval(timer); },
  };
}

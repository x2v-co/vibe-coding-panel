// Anonymous daily usage aggregates for the shared Relay (off unless
// PANEL_RELAY_METRICS_DIR is set). Requested by 老板 on 10-19: the closed beta
// needs user counts without accounts or personal data.
//
// What is stored: per-day counters, and keyed HMAC-SHA256 digests (128-bit,
// hex) of the phone device token and of the public connector id. Never stored:
// raw device tokens, connector ids, IPs, user agents, paths or bodies.
// Days are split in Beijing time (Asia/Shanghai, UTC+8, no DST).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const METRICS = [
  'pairings', 'active_devices', 'new_devices', 'sessions', 'active_connectors', 'new_connectors', 'total_devices', 'total_connectors',
  // Connection quality of computer uplinks (WebSockets), see relay-quality.js.
  'connect_attempts', 'connect_failures', 'disconnects', 'abnormal_disconnects', 'abnormal_disconnect_ratio',
  'connection_duration_avg_s', 'connection_duration_p95_s', 'reconnect_success_rate', 'heartbeat_timeouts', 'rtt_avg_ms',
];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 3600 * 1000;
const SHANGHAI_OFFSET_MS = 8 * 3600 * 1000;

export function shanghaiDate(ms) {
  return new Date(ms + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
}

function writeAtomic(file, data, mode = 0o640) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data, { mode });
  fs.renameSync(tmp, file);
}

function readLines(file) {
  try { return fs.readFileSync(file, 'utf8').split('\n').filter(line => /^[0-9a-f]{32}$/.test(line)); } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export function metricsConfig(options = {}, env = process.env) {
  return {
    dir: String(options.metricsDir ?? env.PANEL_RELAY_METRICS_DIR ?? '').trim(),
    salt: String(options.metricsSalt ?? env.PANEL_RELAY_METRICS_SALT ?? ''),
    token: String(options.metricsToken ?? env.PANEL_RELAY_METRICS_TOKEN ?? ''),
  };
}

const disabled = {
  enabled: false,
  recordPairing() {}, recordDevice() {}, recordConnectorOpen() {}, recordQuality() {}, digest: () => null,
  flush() {}, close() {}, rows() { return []; },
};

const QUALITY = { attempts: 0, failures: 0, disconnects: 0, abnormal: 0, reconnectOk: 0, reconnectFail: 0, heartbeatTimeouts: 0, rttSum: 0, rttCount: 0 };

function percentile(sorted, p) {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)];
}
const ratio = (a, b) => (b ? Math.round((a / b) * 10000) / 10000 : null);

export function createRelayMetrics({ dir, salt = '', token = '', now = Date.now, flushMs = 60_000, maxDaily = 200_000, log = console.error } = {}) {
  if (!dir) return { ...disabled, token: '' };
  try {
    fs.mkdirSync(path.join(dir, 'daily'), { recursive: true });
    if (!salt) {
      // Generated once and kept on the volume so hashes stay comparable across
      // restarts. Losing it makes every device look new; never rotate casually.
      const saltFile = path.join(dir, 'metrics-salt');
      try { salt = fs.readFileSync(saltFile, 'utf8').trim(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (!salt) { salt = randomBytes(32).toString('hex'); writeAtomic(saltFile, `${salt}\n`, 0o600); }
    }
    if (salt.length < 16) throw new Error('PANEL_RELAY_METRICS_SALT must be at least 16 characters');
  } catch (error) {
    log(`[relay-metrics] disabled: ${error.message}`);
    return { ...disabled, token: '' };
  }

  const digest = (kind, value) => createHmac('sha256', salt).update(`${kind}:${value}`).digest('hex').slice(0, 32);
  const files = {
    state: path.join(dir, 'state.json'),
    devices: path.join(dir, 'seen-devices.txt'),
    connectors: path.join(dir, 'seen-connectors.txt'),
  };
  const seen = { devices: new Set(readLines(files.devices)), connectors: new Set(readLines(files.connectors)) };
  const fresh = date => ({ date, pairings: 0, sessions: 0, newDevices: 0, newConnectors: 0, devices: new Set(), connectors: new Set(), quality: { ...QUALITY }, durations: [] });
  let day = fresh(shanghaiDate(now()));
  try {
    const saved = JSON.parse(fs.readFileSync(files.state, 'utf8'));
    if (DATE.test(saved?.date)) {
      day = { ...fresh(saved.date), pairings: saved.pairings | 0, sessions: saved.sessions | 0, newDevices: saved.newDevices | 0,
        newConnectors: saved.newConnectors | 0, devices: new Set(saved.devices || []), connectors: new Set(saved.connectors || []),
        quality: { ...QUALITY, ...(saved.quality || {}) }, durations: Array.isArray(saved.durations) ? saved.durations.filter(Number.isFinite) : [] };
    }
  } catch (error) { if (error.code !== 'ENOENT') log(`[relay-metrics] ignoring unreadable state: ${error.message}`); }
  let warnedCap = false;

  const snapshot = d => {
    const q = d.quality;
    const sorted = [...d.durations].sort((a, b) => a - b);
    return {
      pairings: d.pairings, active_devices: d.devices.size, new_devices: d.newDevices, sessions: d.sessions,
      active_connectors: d.connectors.size, new_connectors: d.newConnectors,
      total_devices: seen.devices.size, total_connectors: seen.connectors.size,
      connect_attempts: q.attempts, connect_failures: q.failures, disconnects: q.disconnects, abnormal_disconnects: q.abnormal,
      abnormal_disconnect_ratio: ratio(q.abnormal, q.disconnects),
      connection_duration_avg_s: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : null,
      connection_duration_p95_s: percentile(sorted, 0.95),
      reconnect_success_rate: ratio(q.reconnectOk, q.reconnectOk + q.reconnectFail),
      heartbeat_timeouts: q.heartbeatTimeouts,
      rtt_avg_ms: q.rttCount ? Math.round(q.rttSum / q.rttCount) : null,
    };
  };
  // A metric without data that day (e.g. no disconnects -> no ratio) is an empty cell / null.
  const csv = (date, values) => `date,metric,value\n${METRICS.map(metric => `${date},${metric},${values[metric] ?? ''}`).join('\n')}\n`;
  const safely = fn => { try { fn(); } catch (error) { log(`[relay-metrics] write failed: ${error.message}`); } };

  function flush() {
    safely(() => {
      writeAtomic(path.join(dir, 'daily', `${day.date}.csv`), csv(day.date, snapshot(day)));
      writeAtomic(files.state, JSON.stringify({ date: day.date, pairings: day.pairings, sessions: day.sessions, newDevices: day.newDevices,
        newConnectors: day.newConnectors, devices: [...day.devices], connectors: [...day.connectors], quality: day.quality, durations: day.durations }));
    });
  }
  function roll() {
    const today = shanghaiDate(now());
    if (today === day.date) return;
    flush(); // finalizes the previous day's CSV
    day = fresh(today);
    flush();
  }
  function remember(kind, hash) {
    const daily = kind === 'devices' ? day.devices : day.connectors;
    if (daily.has(hash)) return;
    if (daily.size >= maxDaily) {
      if (!warnedCap) { warnedCap = true; log(`[relay-metrics] daily ${kind} cap ${maxDaily} reached; further distinct values are not counted`); }
      return;
    }
    daily.add(hash);
    if (seen[kind].has(hash)) return;
    seen[kind].add(hash);
    if (kind === 'devices') day.newDevices += 1; else day.newConnectors += 1;
    safely(() => fs.appendFileSync(files[kind], `${hash}\n`, { mode: 0o640 }));
  }

  roll(); // a state file from an earlier day is finalized at startup
  const timer = setInterval(() => {
    roll();
    flush();
  }, flushMs);
  timer.unref();

  function rows(from, to) {
    roll();
    const out = [];
    const dates = fs.readdirSync(path.join(dir, 'daily')).map(name => name.replace(/\.csv$/, '')).filter(name => DATE.test(name) && name >= from && name <= to).sort();
    for (const date of dates) {
      if (date === day.date) {
        const values = snapshot(day);
        for (const metric of METRICS) out.push({ date, metric, value: values[metric] });
        continue;
      }
      const text = fs.readFileSync(path.join(dir, 'daily', `${date}.csv`), 'utf8');
      for (const line of text.split('\n').slice(1)) {
        const [d, metric, value] = line.split(',');
        if (d === date && METRICS.includes(metric)) out.push({ date, metric, value: value === '' || value === undefined ? null : Number(value) });
      }
    }
    if (day.date >= from && day.date <= to && !dates.includes(day.date)) {
      const values = snapshot(day);
      for (const metric of METRICS) out.push({ date: day.date, metric, value: values[metric] });
    }
    return out;
  }

  return {
    enabled: true,
    token,
    today: () => day.date,
    recordPairing() { roll(); day.pairings += 1; },
    recordDevice(deviceToken) { if (!deviceToken) return; roll(); remember('devices', digest('device', deviceToken)); },
    // relay-quality.js decides whether an uplink starts a new session or
    // continues one after a reconnect inside the grace window.
    recordConnectorOpen(connectorId, { newSession = true } = {}) {
      roll();
      remember('connectors', digest('connector', connectorId));
      if (newSession) day.sessions += 1;
    },
    recordQuality(event, value) {
      roll();
      const q = day.quality;
      if (event === 'attempt') q.attempts += 1;
      else if (event === 'failure') q.failures += 1;
      else if (event === 'heartbeat_timeout') q.heartbeatTimeouts += 1;
      else if (event === 'reconnect') { if (value) q.reconnectOk += 1; else q.reconnectFail += 1; }
      else if (event === 'rtt' && Number.isFinite(value)) { q.rttSum += value; q.rttCount += 1; }
      else if (event === 'disconnect') {
        q.disconnects += 1;
        if (value?.abnormal) q.abnormal += 1;
        if (Number.isFinite(value?.durationS) && day.durations.length < maxDaily) day.durations.push(value.durationS);
      }
    },
    digest: (kind, value) => digest(kind, value),
    flush,
    rows,
    close() { clearInterval(timer); flush(); },
  };
}

function bearerMatches(header, expected) {
  const given = String(header || '').replace(/^Bearer\s+/i, '');
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return given.length > 0 && timingSafeEqual(a, b);
}

// GET /metrics/daily?from=YYYY-MM-DD&to=YYYY-MM-DD[&format=csv]
// Read-only. 404 unless both the metrics dir and PANEL_RELAY_METRICS_TOKEN are set.
export function installMetricsRoute(app, metrics, { limit, clientIp, now = Date.now }) {
  app.get('/metrics/daily', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (!metrics.enabled || !metrics.token) return res.status(404).json({ code: 'METRICS_DISABLED' });
    if (limit(`metrics:${clientIp(req)}`, 30)) return res.status(429).json({ code: 'RATE_LIMITED' });
    if (!bearerMatches(req.headers.authorization, metrics.token)) {
      return res.status(401).set('WWW-Authenticate', 'Bearer').json({ code: 'UNAUTHORIZED' });
    }
    const today = shanghaiDate(now());
    const to = String(req.query.to || today);
    const from = String(req.query.from || shanghaiDate(Date.parse(`${to}T00:00:00Z`) - 29 * DAY_MS));
    if (!DATE.test(from) || !DATE.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) {
      return res.status(400).json({ code: 'INVALID_RANGE', error: 'from/to must be YYYY-MM-DD with from <= to' });
    }
    if (Date.parse(to) - Date.parse(from) > 366 * DAY_MS) return res.status(400).json({ code: 'RANGE_TOO_LARGE', error: 'at most 366 days' });
    let rows;
    try { rows = metrics.rows(from, to); } catch { return res.status(500).json({ code: 'METRICS_READ_FAILED' }); }
    if (req.query.format === 'csv') {
      return res.type('text/csv').send(`date,metric,value\n${rows.map(r => `${r.date},${r.metric},${r.value}`).join('\n')}${rows.length ? '\n' : ''}`);
    }
    res.json({ timezone: 'Asia/Shanghai', from, to, partial: today >= from && today <= to ? [today] : [], rows });
  });
}

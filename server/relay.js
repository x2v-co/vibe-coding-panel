import express from 'express';
import http, { validateHeaderName, validateHeaderValue } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { readCookie } from './pairing.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hopByHopHeaders = new Set([
  'connection', 'content-length', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'server', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'x-powered-by',
]);

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function connectorIdForCredential(credential) {
  return createHash('sha256').update(credential).digest('base64url');
}

function connectorIdFrom(req) {
  return readCookie(req.headers.cookie, 'vibe_relay_connector');
}

function forwardedHeaders(req) {
  const headers = {};
  for (const name of ['accept', 'content-type', 'cookie', 'last-event-id', 'user-agent']) {
    if (req.headers[name]) headers[name] = req.headers[name];
  }
  headers['x-forwarded-for'] = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'relay');
  headers['x-forwarded-proto'] = 'https';
  return headers;
}

function publicHeaders(input = {}) {
  const headers = {};
  for (const [name, value] of Object.entries(input)) {
    if (!hopByHopHeaders.has(name.toLowerCase()) && value !== undefined) headers[name] = value;
  }
  return headers;
}

export function createRelayServer(options = {}) {
  const maxConnectors = positiveInteger(options.maxConnectors ?? process.env.PANEL_RELAY_MAX_CONNECTORS, 100);
  const maxInflight = positiveInteger(options.maxInflight ?? process.env.PANEL_RELAY_MAX_INFLIGHT, 100);
  const requestTimeoutMs = positiveInteger(options.requestTimeoutMs ?? process.env.PANEL_RELAY_REQUEST_TIMEOUT_MS, 10 * 60 * 1000);
  const publicUrl = String(options.publicUrl ?? process.env.PANEL_RELAY_PUBLIC_URL ?? '').replace(/\/$/, '');
  const distDir = options.distDir || path.join(appRoot, 'dist');
  const connectors = new Map();
  const pending = new Map();
  const app = express();
  const server = http.createServer(app);
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 14 * 1024 * 1024 });

  app.disable('x-powered-by');

  app.get('/healthz', (_req, res) => {
    res.json({
      ok: true,
      service: 'vibe-panel-relay',
      connectors: connectors.size,
      inflight: pending.size,
      capacity: { connectors: maxConnectors, inflight: maxInflight },
    });
  });

  app.use('/api', express.raw({ type: () => true, limit: '12mb' }), (req, res) => {
    const connectorId = connectorIdFrom(req);
    const connector = connectors.get(connectorId);
    if (!connector || connector.readyState !== WebSocket.OPEN) {
      return res.status(503).json({ error: '电脑 Connector 未连接', code: 'CONNECTOR_OFFLINE' });
    }
    if (pending.size >= maxInflight) {
      return res.status(503).json({ error: 'Relay 当前请求较多，请稍后重试', code: 'RELAY_BUSY' });
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      const active = pending.get(requestId);
      if (!active) return;
      pending.delete(requestId);
      if (!res.headersSent) res.status(504).json({ error: '电脑响应超时', code: 'CONNECTOR_TIMEOUT' });
      else res.end();
      connector.send(JSON.stringify({ type: 'cancel', requestId }));
    }, requestTimeoutMs);

    pending.set(requestId, { connectorId, res, timer, started: false });
    connector.send(JSON.stringify({
      type: 'request',
      requestId,
      method: req.method,
      path: req.originalUrl,
      headers: forwardedHeaders(req),
      body: Buffer.isBuffer(req.body) && req.body.length ? req.body.toString('base64') : '',
    }));

    req.on('aborted', () => {
      const active = pending.get(requestId);
      if (!active) return;
      clearTimeout(active.timer);
      pending.delete(requestId);
      if (connector.readyState === WebSocket.OPEN) connector.send(JSON.stringify({ type: 'cancel', requestId }));
    });
  });

  app.get(['/', '/app'], (req, res, next) => {
    const requested = String(req.query.relay || '');
    if (!requested) return next();
    if (!connectors.has(requested)) return res.status(503).send('This Desktop Connector is offline.');
    res.setHeader('Set-Cookie', `vibe_relay_connector=${encodeURIComponent(requested)}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=31536000`);
    const pairingCode = String(req.query.pair || '');
    res.redirect(pairingCode ? `/app?pair=${encodeURIComponent(pairingCode)}` : '/app');
  });

  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(distDir, 'index.html'));
  });

  server.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, 'http://relay.local'); } catch { socket.destroy(); return; }
    if (url.pathname !== '/relay/connect') { socket.destroy(); return; }

    const connectorId = String(url.searchParams.get('id') || '');
    const authorization = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const credential = authorization || String(url.searchParams.get('token') || '');
    if (!/^[A-Za-z0-9_-]{43}$/.test(connectorId)
      || !/^[A-Za-z0-9_-]{64}$/.test(credential)
      || connectorIdForCredential(credential) !== connectorId) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (connectors.has(connectorId)) {
      socket.write('HTTP/1.1 409 Conflict\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (!connectors.has(connectorId) && connectors.size >= maxConnectors) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    req.connectorId = connectorId;
    sockets.handleUpgrade(req, socket, head, (ws) => sockets.emit('connection', ws, req));
  });

  sockets.on('connection', (socket, req) => {
    const connectorId = req.connectorId;
    connectors.set(connectorId, socket);
    socket.isAlive = true;
    socket.on('pong', () => { socket.isAlive = true; });
    socket.send(JSON.stringify({ type: 'ready', connectorId, publicUrl }));

    socket.on('message', (raw) => {
      let message;
      try { message = JSON.parse(raw.toString()); } catch { return; }
      if (!message || typeof message !== 'object' || Array.isArray(message)) return;
      const active = pending.get(message.requestId);
      if (!active || active.connectorId !== connectorId) return;
      const { res } = active;

      try {
        if (message.type === 'response-start' && !active.started) {
          const status = message.status === undefined ? 502 : message.status;
          if (!Number.isInteger(status) || status < 100 || status > 999) throw new Error('Invalid response status');
          if (message.headers !== undefined && (!message.headers || typeof message.headers !== 'object' || Array.isArray(message.headers))) {
            throw new Error('Invalid response headers');
          }
          const headers = publicHeaders(message.headers);
          for (const [name, value] of Object.entries(headers)) {
            validateHeaderName(name);
            const values = Array.isArray(value) ? value : [value];
            for (const item of values) {
              if (typeof item !== 'string' && typeof item !== 'number') throw new Error('Invalid response header value');
              validateHeaderValue(name, item);
            }
          }
          active.started = true;
          res.status(status);
          for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
          res.flushHeaders();
        } else if (message.type === 'response-chunk' && active.started && !res.writableEnded) {
          res.write(Buffer.from(String(message.data || ''), 'base64'));
        } else if (message.type === 'response-end') {
          clearTimeout(active.timer);
          pending.delete(message.requestId);
          if (!res.writableEnded) res.end();
        } else if (message.type === 'response-error') {
          clearTimeout(active.timer);
          pending.delete(message.requestId);
          if (!res.headersSent) res.status(502).json({ error: message.error || '电脑 Connector 请求失败' });
          else res.end();
        }
      } catch {
        clearTimeout(active.timer);
        pending.delete(message.requestId);
        if (!res.headersSent) res.status(502).json({ error: '电脑 Connector 返回了无效响应', code: 'INVALID_CONNECTOR_RESPONSE' });
        else res.end();
      }
    });

    socket.on('error', () => socket.terminate());

    socket.on('close', () => {
      if (connectors.get(connectorId) === socket) connectors.delete(connectorId);
      for (const [requestId, active] of pending) {
        if (active.connectorId !== connectorId) continue;
        clearTimeout(active.timer);
        pending.delete(requestId);
        if (!active.res.headersSent) active.res.status(503).json({ error: '电脑 Connector 已断开' });
        else active.res.end();
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of connectors.values()) {
      if (!socket.isAlive) { socket.terminate(); continue; }
      socket.isAlive = false;
      socket.ping();
    }
  }, 30_000);
  heartbeat.unref();

  server.on('close', () => {
    clearInterval(heartbeat);
    for (const socket of connectors.values()) socket.close(1001, 'Relay shutting down');
  });

  return { app, server, connectors, pending };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = positiveInteger(process.env.PANEL_RELAY_PORT, 8789);
  const host = process.env.PANEL_RELAY_HOST || '0.0.0.0';
  const { server } = createRelayServer();
  server.listen(port, host, () => console.log(`Vibe Panel Relay: http://${host}:${port}`));
}

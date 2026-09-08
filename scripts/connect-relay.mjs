import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { homedir } from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { WebSocket } from 'ws';
import { probeAgentProviders } from '../server/agent-providers.js';

const apiPort = Number(process.env.PANEL_API_PORT || 8787);
const relayInput = String(process.env.PANEL_RELAY_URL || '').trim();
const stateFile = process.env.PANEL_RELAY_STATE || path.join(homedir(), '.vibe-panel', 'relay.json');
const inflight = new Map();
let stopped = false;
let reconnectDelay = 1000;
let serverProcess;

if (!relayInput) throw new Error('Set PANEL_RELAY_URL to your Relay HTTPS or WebSocket URL.');

function verifyLocalAgents() {
  const providers = probeAgentProviders();
  const ready = providers.filter((provider) => provider.available && provider.authenticated);
  if (!ready.length) {
    throw new Error('No supported coding agent is ready. Install and sign in to Codex CLI or Claude Code, then start the Connector again.');
  }
  process.stdout.write(`Ready agents: ${ready.map((provider) => provider.label).join(', ')}\n`);
}

async function loadConnectorId() {
  try {
    const stored = JSON.parse(await readFile(stateFile, 'utf8'));
    if (/^[A-Za-z0-9_-]{64}$/.test(stored.connectorCredential)) {
      const connectorId = createHash('sha256').update(stored.connectorCredential).digest('base64url');
      return { connectorId, connectorCredential: stored.connectorCredential };
    }
  } catch { /* Create the connector identity below. */ }
  const connectorCredential = randomBytes(48).toString('base64url');
  const connectorId = createHash('sha256').update(connectorCredential).digest('base64url');
  await mkdir(path.dirname(stateFile), { recursive: true });
  const identity = { connectorId, connectorCredential };
  await writeFile(stateFile, `${JSON.stringify(identity, null, 2)}\n`, { mode: 0o600 });
  return identity;
}

function relayUrls(connectorId, connectorCredential) {
  const url = new URL(relayInput);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (['http:', 'ws:'].includes(url.protocol) && !loopback) {
    throw new Error('PANEL_RELAY_URL must use HTTPS/WSS outside local development.');
  }
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('PANEL_RELAY_URL must use HTTPS or WSS.');
  url.pathname = '/relay/connect';
  url.search = '';
  url.searchParams.set('id', connectorId);
  const publicOrigin = String(process.env.PANEL_RELAY_PUBLIC_URL || `${url.protocol === 'wss:' ? 'https:' : 'http:'}//${url.host}`).replace(/\/$/, '');
  return { socketUrl: url.toString(), connectorCredential, mobileUrl: `${publicOrigin}/app?relay=${encodeURIComponent(connectorId)}` };
}

function send(socket, message) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function forwardRequest(socket, message) {
  const request = http.request({
    host: '127.0.0.1', port: apiPort, method: message.method, path: message.path,
    headers: { ...(message.headers || {}), host: `127.0.0.1:${apiPort}` },
  }, (response) => {
    send(socket, { type: 'response-start', requestId: message.requestId, status: response.statusCode, headers: response.headers });
    response.on('data', (chunk) => send(socket, { type: 'response-chunk', requestId: message.requestId, data: chunk.toString('base64') }));
    response.on('end', () => {
      inflight.delete(message.requestId);
      send(socket, { type: 'response-end', requestId: message.requestId });
    });
  });
  inflight.set(message.requestId, request);
  request.on('error', (error) => {
    inflight.delete(message.requestId);
    send(socket, { type: 'response-error', requestId: message.requestId, error: error.message });
  });
  if (message.body) request.write(Buffer.from(message.body, 'base64'));
  request.end();
}

async function printPairingUrl(mobileUrl) {
  if (['1', 'true'].includes(String(process.env.PANEL_CONNECTOR_NO_SERVER || '').toLowerCase())) return;
  const endpoint = `http://127.0.0.1:${apiPort}/api/pairing-codes`;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publicUrl: mobileUrl }),
      });
      if (response.ok) {
        const payload = await response.json();
        process.stdout.write('\n========================================\n');
        process.stdout.write(' 手机现在打开这个地址\n');
        process.stdout.write(` ${payload.pairingUrl}\n`);
        process.stdout.write('========================================\n');
        try {
          const qr = await QRCode.toString(payload.pairingUrl, {
            type: 'terminal',
            small: true,
            errorCorrectionLevel: 'M',
          });
          process.stdout.write('\n请用手机扫描下面的二维码：\n');
          process.stdout.write(`${qr}\n`);
        } catch (error) {
          process.stderr.write(`无法生成终端二维码：${error.message}\n`);
        }
        process.stdout.write(`配对码：${payload.code}（10 分钟内有效，只能使用一次）\n`);
        process.stdout.write('请保持这个窗口运行；关闭窗口后手机会断开。\n\n');
        return;
      }
    } catch {
      // The local API may still be starting; retry briefly before showing a manual fallback.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  process.stderr.write(`Could not create a pairing link automatically. Open http://127.0.0.1:${apiPort} and create one in Settings.\n`);
}

function connect(socketUrl, connectorCredential, mobileUrl) {
  if (stopped) return;
  const socket = new WebSocket(socketUrl, {
    headers: { Authorization: `Bearer ${connectorCredential}` },
    maxPayload: 14 * 1024 * 1024,
  });

  socket.on('open', () => {
    reconnectDelay = 1000;
    process.stdout.write(`\n电脑 Connector 已连接。\n备用手机地址：${mobileUrl}\n`);
  });
  socket.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.type === 'request') forwardRequest(socket, message);
    if (message.type === 'cancel') {
      inflight.get(message.requestId)?.destroy();
      inflight.delete(message.requestId);
    }
  });
  socket.on('error', (error) => process.stderr.write(`Relay connection error: ${error.message}\n`));
  socket.on('close', () => {
    for (const request of inflight.values()) request.destroy();
    inflight.clear();
    if (stopped) return;
    process.stderr.write(`Relay disconnected. Reconnecting in ${Math.round(reconnectDelay / 1000)}s...\n`);
    setTimeout(() => connect(socketUrl, connectorCredential, mobileUrl), reconnectDelay).unref();
    reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
  });
}

const { connectorId, connectorCredential } = await loadConnectorId();
const { socketUrl, mobileUrl } = relayUrls(connectorId, connectorCredential);
verifyLocalAgents();
if (!['1', 'true'].includes(String(process.env.PANEL_CONNECTOR_NO_SERVER || '').toLowerCase())) {
  serverProcess = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PANEL_REQUIRE_PAIRING: '1', PANEL_PUBLIC_URL: mobileUrl },
    stdio: 'inherit',
  });
  serverProcess.on('exit', (code) => {
    if (!stopped && code) process.stderr.write(`Local panel exited with code ${code}.\n`);
    stopped = true;
  });
}
void printPairingUrl(mobileUrl);
connect(socketUrl, connectorCredential, mobileUrl);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopped = true;
    serverProcess?.kill(signal);
    for (const request of inflight.values()) request.destroy();
    process.exit(0);
  });
}

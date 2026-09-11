import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import QRCode from 'qrcode';
import { connectorRelayConfig } from '../server/relay-config.js';
import { RelayConnector } from '../server/relay-connector.js';
import { probeAgentProviders } from '../server/agent-providers.js';

const apiPort = Number(process.env.PANEL_API_PORT || 8787);
const { origins, publicOrigin } = connectorRelayConfig();
const stateFile = process.env.PANEL_RELAY_STATE || path.join(homedir(), '.vibe-panel', 'relay.json');
const uplinks = [];
let stopped = false;
let serverProcess;


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

const { connectorId, connectorCredential } = await loadConnectorId();
const mobileUrl = `${publicOrigin}/app?relay=${encodeURIComponent(connectorId)}`;
verifyLocalAgents();
if (!['1', 'true'].includes(String(process.env.PANEL_CONNECTOR_NO_SERVER || '').toLowerCase())) {
  serverProcess = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PANEL_REQUIRE_PAIRING: '1', PANEL_PUBLIC_URL: mobileUrl, PANEL_RELAY_URLS: origins.join(',') },
    stdio: 'inherit',
  });
  serverProcess.on('exit', (code) => {
    if (!stopped && code) process.stderr.write(`Local panel exited with code ${code}.\n`);
    stopped = true;
    for (const uplink of uplinks) uplink.stop();
  });
}
let pairingPrinted = false;
for (const origin of origins) {
  const uplink = new RelayConnector({ origin, connectorId, credential: connectorCredential, apiPort, log: message => process.stdout.write(`${message}\n`),
    onReady: () => { if (!pairingPrinted) { pairingPrinted = true; void printPairingUrl(mobileUrl); } },
  });
  uplinks.push(uplink);
  uplink.connect();
  process.stdout.write(`备用手机地址：${origin}/app?relay=${connectorId}\n`);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopped = true;
    serverProcess?.kill(signal);
    for (const uplink of uplinks) uplink.stop();
    process.exit(0);
  });
}

import { spawn } from 'node:child_process';

const apiPort = Number(process.env.PANEL_API_PORT || 8787);
const children = new Set();

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}

function stopAll(signal = 'SIGTERM') {
  for (const child of children) child.kill(signal);
}

const server = start(process.execPath, ['server/index.js'], {
  env: { ...process.env, PANEL_REQUIRE_PAIRING: '1' },
});

server.stdout.on('data', (chunk) => process.stdout.write(chunk));
server.stderr.on('data', (chunk) => process.stderr.write(chunk));
server.on('exit', (code) => {
  stopAll();
  if (code && code !== 0) process.exitCode = code;
});

const tunnel = start(process.env.PANEL_CLOUDFLARED_BIN || 'cloudflared', [
  'tunnel', '--url', `http://127.0.0.1:${apiPort}`, '--no-autoupdate',
]);

let announced = false;
function relayTunnelOutput(chunk) {
  const output = chunk.toString();
  process.stderr.write(output);
  if (announced) return;
  const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i);
  if (!match) return;
  announced = true;
  process.stdout.write(`\nMobile HTTPS URL: ${match[0]}\n`);
  process.stdout.write(`Open http://127.0.0.1:${apiPort} on this computer, then paste the HTTPS URL under Settings > Mobile pairing.\n\n`);
}

tunnel.stdout.on('data', relayTunnelOutput);
tunnel.stderr.on('data', relayTunnelOutput);
tunnel.on('error', (error) => {
  process.stderr.write(`Unable to start cloudflared: ${error.message}\nInstall it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n`);
  stopAll();
  process.exitCode = 1;
});
tunnel.on('exit', (code) => {
  stopAll();
  if (code && code !== 0) process.exitCode = code;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll(signal);
    process.exit(0);
  });
}

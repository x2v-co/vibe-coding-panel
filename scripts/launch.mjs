// Dependency-free entry point: usable before npm ci on a fresh checkout.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
if (process.argv.includes('--setup-voice')) {
  await import('./setup-voice.mjs');
  process.exit(process.exitCode || 0);
}
const require = createRequire(import.meta.url);
const json = process.argv.includes('--json');
const doctor = process.argv.includes('--doctor');
let bundle;
try { bundle = require('../bundle.json'); } catch {}
const checks = [];
const add = (name, ok, next = '') => checks.push({ name, ok, next: ok ? '' : next });
add('Node.js >=22.12', Number(process.versions.node.split('.')[0]) > 22 || (Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) >= 12), 'Install Node.js 24 LTS: https://nodejs.org/');
const npm = (args) => spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32', timeout: 180000 });
if (!bundle) add('npm', npm(['--version']).status === 0, 'Reinstall Node.js with npm and PATH enabled.');
else add('bundled runtime', bundle.platform === process.platform && bundle.arch === process.arch, 'Download the Connector for this operating system and CPU architecture.');
function dependencies() {
  try { for (const name of Object.keys(require('../package.json').dependencies)) require.resolve(name); return true; } catch { return false; }
}
if (!bundle && !doctor && checks.every(c => c.ok) && !dependencies()) {
  console.log('Installing locked dependencies (npm ci)...');
  const result = npm(['ci']);
  if (result.status !== 0) { console.error('npm ci failed. Check network access and retry.'); process.exit(1); }
}
add('dependencies', dependencies(), bundle ? 'Re-download and fully extract the Connector ZIP; runtime files are missing.' : 'Run npm ci in the project directory.');
let selectedPort;
const requested = Number(process.env.PANEL_API_PORT || 8787);
for (const port of [requested, 8800, 8801, 8802, 8810, 8811]) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) continue;
  const available = await new Promise(resolve => {
    const socket = net.createServer();
    socket.once('error', () => resolve(false));
    socket.listen(port, '127.0.0.1', () => socket.close(() => resolve(true)));
  });
  if (available) { selectedPort = port; break; }
}
add('local port', Boolean(selectedPort), 'Close another Connector or set PANEL_API_PORT to an unused port.');
if (dependencies()) {
  const { managedSpeechEnv } = await import('../server/managed-speech.js');
  Object.assign(process.env, managedSpeechEnv());
  const { probeAgentProviders } = await import('../server/agent-providers.js');
  const agents = probeAgentProviders();
  add('agent login', agents.some(a => a.authenticated), 'Install Codex CLI or Claude Code, then run codex login or claude auth login.');
  checks.push({ name: 'agents', ok: true, agents });
  if (doctor) {
    const { releaseInfo, speechDiagnostics } = await import('../server/runtime-info.js');
    checks.push({ name: 'connector version', ok: true, ...releaseInfo(root) });
    // Voice is optional: a missing component must not block text-only startup.
    const speech = await speechDiagnostics();
    checks.push({ name: 'speech (optional)', ok: true, speech });
  }
}
const ok = checks.every(c => c.ok);
if (json) console.log(JSON.stringify({ ok, platform: process.platform, node: process.version, bundle: bundle || null, port: selectedPort, checks }));
else for (const check of checks) {
  if (check.speech) {
    const speech = check.speech;
    console.log(`INFO speech (optional): ${speech.backend} / ${speech.model}; Whisper ${speech.whisper.version || 'unknown'} (${speech.whisper.status}); ffmpeg ${speech.ffmpeg.version || 'unknown'} (${speech.ffmpeg.status})`);
    if (speech.guidance) console.log(speech.guidance);
  } else console.log(`${check.ok ? 'OK' : 'FAIL'} ${check.name}${check.revision ? ': ' + check.revision.slice(0, 8) : ''}${check.next ? ': ' + check.next : ''}`);
}
if (!ok) process.exit(1);
if (!doctor) {
  process.env.PANEL_API_PORT = String(selectedPort);
  await import('./connect.mjs');
}

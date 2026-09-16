// Unified desktop controller launcher with a separate, persistent pairing identity.
import { spawnSync } from 'node:child_process';
import { connectorRelayConfig } from '../server/relay-config.js';
import { controllerSpeechEnv } from '../server/controller-speech-config.js';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const args = new Set(process.argv.slice(2));
const unified = process.env.PANEL_CONTROLLER_UNIFIED === '1' || (process.env.PANEL_CONTROLLER_UNIFIED !== '0' && !args.has('--claude') && !args.has('--claude-app'));
let hubProfile = {};
if (unified) { try { hubProfile = JSON.parse(await readFile(process.env.PANEL_CONTROLLER_HUB_CONFIG || path.join(root,'.vibe-panel/controller-hub.json'),'utf8')); } catch {} }
if (args.has('--claude') && args.has('--claude-app')) throw new Error('一次只能选择一种外设目标');
const target = args.has('--claude-app') ? 'claude-app' : args.has('--claude') ? 'claude-code' : (process.env.PANEL_CONTROLLER_TARGET || hubProfile.target || (process.platform === 'darwin' ? 'codex-app' : 'claude-code'));
if (!['codex-app', 'claude-code', 'claude-app'].includes(target)) throw new Error('不支持的外设目标');
if (args.has('--help')) {
  console.log('npm run controller             启动统一外设控制中心\nnpm run controller -- --claude  启动 Claude Code 电脑控制台与手机外设\nnpm run controller -- --claude-app  启动 Claude App 外设（macOS Code 会话）\nnpm run controller -- --check   只检查启动条件\nnpm run controller -- --text-only   不启动增量语音模型');
  process.exit(0);
}
for (const arg of args) if (!['--check', '--text-only', '--claude', '--claude-app'].includes(arg)) throw new Error(`未知选项：${arg}`);
if (process.platform !== 'darwin' && target !== 'claude-code') throw new Error('App 桌面外设仅支持 macOS');
const port = Number(process.env.PANEL_API_PORT || hubProfile.port || (unified ? 8897 : {'codex-app':8897,'claude-code':8898,'claude-app':8899}[target]));
const identityPrefix = {'codex-app':'controller','claude-code':'claude-controller','claude-app':'claude-app-controller'}[target];
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PANEL_API_PORT 无效');
const local = `http://127.0.0.1:${port}`;
Object.assign(process.env, {
  PANEL_API_PORT: String(port), PANEL_REQUIRE_PAIRING: '1', PANEL_DESKTOP_CONTROLLER: '1',
  PANEL_CONTROLLER_TARGET: target,
  PANEL_CONTROLLER_UNIFIED: unified ? '1' : '0',
  ...(hubProfile.restoreFile ? {PANEL_CONTROLLER_RESTORE:hubProfile.restoreFile} : {}),
  PANEL_DEVICE_STORE: process.env.PANEL_DEVICE_STORE || hubProfile.deviceStore || path.join(root, `.vibe-panel/${unified ? 'controller' : identityPrefix}-devices.json`),
  PANEL_RELAY_STATE: process.env.PANEL_RELAY_STATE || hubProfile.relayState || path.join(root, `.vibe-panel/${unified ? 'controller' : identityPrefix}-relay.json`),
});

Object.assign(process.env, controllerSpeechEnv());

async function links() {
  if (target === 'claude-code') console.log(`Claude Code 电脑控制台：${local}/api/desktop-controller/managed/view`);
  console.log(`电脑控制页：${local}/api/desktop-controller/view`);
  const origin = new URL(connectorRelayConfig().publicOrigin);
  origin.protocol = origin.protocol === 'wss:' ? 'https:' : origin.protocol === 'ws:' ? 'http:' : origin.protocol;
  try {
    const state = JSON.parse(await readFile(process.env.PANEL_RELAY_STATE, 'utf8'));
    if (/^[A-Za-z0-9_-]{64}$/.test(state.connectorCredential)) {
      const id = createHash('sha256').update(state.connectorCredential).digest('base64url');
      console.log(`手机首次选择电脑：${origin.origin}/app?relay=${id}&next=controller`);
    }
  } catch {}
  console.log(`手机外设页：${origin.origin}/api/desktop-controller/view`);
  console.log(unified ? '在电脑控制中心选择工作目标并绑定；手机保持同一遥控器地址，无需重新配对。' : target === 'claude-code' ? '电脑打开 Claude Code 控制台，填写工作目录并创建会话；手机选择此 Connector 后配对。' : target === 'claude-app' ? '电脑在 Claude App 的 Code 中打开现有会话并点击输入框，再在电脑控制页绑定。' : '电脑先选中 Codex 会话并点击输入框，再在电脑控制页绑定；手机沿用原浏览器。');
}

if (args.has('--check')) {
  const {checkController}=await import('./controller-check.mjs');
  const rows=checkController({target});
  console.log(`外设安装检查：${target}`);
  for(const row of rows)console.log(`${row.ready===true?'通过':row.ready===false?'待处理':'待验证'} · ${row.name}：${row.detail}`);
  console.log(`电脑启动后打开：${local}/api/desktop-controller/view`);
  console.log('检查不会启动服务或提交任务。通过后启动控制中心，在电脑绑定会话，再用手机 HTTPS 入口配对。');
  process.exit(rows.some(row=>row.ready===false)?1:0);
}
let existing;
try {
  const response = await fetch(`${local}/api/desktop-controller/status`, { signal: AbortSignal.timeout(2000) });
  if (response.ok) existing = await response.json();
} catch {}
if (existing?.enabled === true) {
  if (!existing.unified && (existing.target || 'codex-app') !== target) throw new Error('此端口运行的是另一种外设，请使用独立端口');
  console.log(`外设服务已运行，复用现有服务。${existing.bound ? `已绑定：${existing.title}` : '请在电脑控制页绑定当前会话。'}`);
  await links();
  process.exit(0);
}
const available = await new Promise(resolve => {
  const server = net.createServer();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});
if (!available) throw new Error(`端口 ${port} 已由其他服务使用；请设置 PANEL_API_PORT，不会替换已有服务`);

if (args.has('--text-only')) process.env.PANEL_LIVE_SPEECH = '0';
else if (process.env.PANEL_LIVE_SPEECH !== '0') {
  const explicit = process.env.PANEL_LIVE_PYTHON || process.env.PANEL_PYTHON_BIN;
  const candidates = explicit ? [explicit] : [path.join(root, '.venv/bin/python'), path.join(homedir(), 'miniconda3/bin/python'), path.join(homedir(), 'anaconda3/bin/python'), 'python3'];
  const python = candidates.find(candidate => {
    if (candidate.includes('/') && !existsSync(candidate)) return false;
    return spawnSync(candidate, ['-c', "import numpy, torch, whisper, onnxruntime, importlib.metadata; importlib.metadata.distribution('silero-vad')"], { stdio: 'ignore', timeout: 15000 }).status === 0;
  });
  if (python) { process.env.PANEL_LIVE_PYTHON = python; process.env.PANEL_LIVE_SPEECH = '1'; }
  else {
    process.env.PANEL_LIVE_SPEECH = '0';
    console.log('增量语音依赖未就绪，仍可使用文字输入。安装方法见 docs/controller-quickstart.md。');
  }
}
console.log(`启动条件就绪：端口 ${port}；增量语音${process.env.PANEL_LIVE_SPEECH === '1' ? '已启用' : '未启用'}。`);
if (args.has('--check')) { await links(); process.exit(0); }
// The connector owns the API child; Ctrl-C terminates both. No CLI login is
// required for desktop mode: actual Codex App/AX readiness is checked on bind.
delete process.env.PANEL_CONNECTOR_NO_SERVER;
await import('./connect-relay.mjs');
await links();

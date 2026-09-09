import spawn, { sync as spawnSync } from 'cross-spawn';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentProviders, defaultAgentProvider } from '../server/agent-providers.js';
import { resolveFfmpeg } from '../server/ffmpeg.js';
import { resolveWhisperBackend, resolveWhisperModel } from '../server/whisper-options.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relayUrl = String(process.env.PANEL_RELAY_URL || 'https://vibe.tooluse.app').trim();

function executable(name) {
  const lookup = process.platform === 'win32' ? 'where' : 'which';
  const result = spawnSync(lookup, [name], { encoding: 'utf8' });
  return result.status === 0
    ? result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || ''
    : '';
}

function portAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
  });
}

async function choosePort() {
  const requested = Number(process.env.PANEL_API_PORT || 8787);
  if (await portAvailable(requested)) return requested;
  for (const candidate of [8800, 8801, 8802, 8810, 8811]) {
    if (await portAvailable(candidate)) return candidate;
  }
  throw new Error('没有可用的本机端口，请关闭其他 Vibe Panel 实例后重试');
}

function findWhisperPython() {
  const venvPython = process.platform === 'win32'
    ? path.join(projectRoot, '.venv', 'Scripts', 'python.exe')
    : path.join(projectRoot, '.venv', 'bin', 'python');
  const condaCandidates = process.env.CONDA_PREFIX
    ? process.platform === 'win32'
      ? [path.join(process.env.CONDA_PREFIX, 'python.exe')]
      : [
          path.join(process.env.CONDA_PREFIX, 'bin', 'python3'),
          path.join(process.env.CONDA_PREFIX, 'bin', 'python'),
        ]
    : [];
  const candidates = [
    process.env.PANEL_PYTHON_BIN,
    process.env.PYTHON,
    process.env.CONDA_PYTHON_EXE,
    venvPython,
    ...condaCandidates,
    executable('python3'),
    executable('python'),
    process.platform === 'win32' ? executable('py') : '',
  ].filter(Boolean);
  return [...new Set(candidates)].find((candidate) => {
    const result = spawnSync(candidate, ['-c', 'import imageio_ffmpeg'], { stdio: 'ignore', timeout: 10000 });
    return result.status === 0;
  }) || '';
}

const apiPort = await choosePort();
const env = { ...process.env, PANEL_API_PORT: String(apiPort), PANEL_RELAY_URL: relayUrl, PANEL_AGENT_PROVIDER: defaultAgentProvider() };
const whisperCommand = resolveWhisperBackend(env) === 'mlx' ? 'mlx_whisper' : 'whisper';
const venvWhisper = process.platform === 'win32'
  ? path.join(projectRoot, '.venv', 'Scripts', `${whisperCommand}.exe`)
  : path.join(projectRoot, '.venv', 'bin', whisperCommand);
const whisperBin = String(env.PANEL_WHISPER_BIN || (spawnSync(venvWhisper, ['--help'], { stdio: 'ignore', timeout: 30000 }).status === 0 ? venvWhisper : executable(whisperCommand))).trim();
const pythonBin = findWhisperPython();
const codexBin = String(env.PANEL_CODEX_BIN || executable('codex')).trim();
const claudeBin = String(env.PANEL_CLAUDE_BIN || executable('claude')).trim();

if (pythonBin && !env.PANEL_PYTHON_BIN) env.PANEL_PYTHON_BIN = pythonBin;
if (whisperBin && !env.PANEL_WHISPER_BIN) env.PANEL_WHISPER_BIN = whisperBin;
if (codexBin && !env.PANEL_CODEX_BIN) env.PANEL_CODEX_BIN = codexBin;
if (claudeBin && !env.PANEL_CLAUDE_BIN) env.PANEL_CLAUDE_BIN = claudeBin;
try {
  env.PANEL_FFMPEG_BIN = await resolveFfmpeg({
    configured: env.PANEL_FFMPEG_BIN,
    pythonCandidates: [pythonBin],
    readProcess(command, args) {
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, env });
      if (result.error || result.status !== 0) throw new Error('Executable unavailable');
      return result.stdout;
    },
  });
} catch (error) {
  delete env.PANEL_FFMPEG_BIN;
  process.stderr.write(`${error.message}（仍可使用文字输入）\n`);
}

process.stdout.write('\n========================================\n');
process.stdout.write(' VIBE PANEL CONNECTOR\n');
process.stdout.write('========================================\n');
process.stdout.write(`Platform: ${process.platform}\n`);
process.stdout.write(`Relay: ${relayUrl}\n`);
process.stdout.write(`默认 Agent: ${agentProviders[env.PANEL_AGENT_PROVIDER].label}\n`);
process.stdout.write(`本机端口: ${apiPort}${apiPort === Number(process.env.PANEL_API_PORT || 8787) ? '' : '（默认端口被占用，已自动切换）'}\n`);
if (whisperBin) process.stdout.write(`Whisper: ${whisperBin} (${resolveWhisperBackend(env)} / ${resolveWhisperModel(env)})\n`);
else process.stdout.write('Whisper: 未检测到（仍可使用文字输入）\n');
if (env.PANEL_FFMPEG_BIN) process.stdout.write(`ffmpeg: ${env.PANEL_FFMPEG_BIN}\n`);
else process.stdout.write('ffmpeg: 未检测到（语音转写可能不可用）\n');
process.stdout.write('\n正在连接电脑与 Relay，请稍候...\n');

const child = spawn(process.execPath, [path.join(projectRoot, 'scripts', 'connect-relay.mjs')], {
  cwd: projectRoot,
  env,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));

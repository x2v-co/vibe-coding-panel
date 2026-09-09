import { readFileSync, existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import spawn from 'cross-spawn';
import path from 'node:path';
import { resolveFfmpeg } from './ffmpeg.js';
import { managedSpeechEnv } from './managed-speech.js';
import { resolveWhisperBinary, resolveWhisperModel, speechConfiguration } from './whisper-options.js';

export function releaseInfo(root) {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  let revision = null, distribution = 'source';
  try {
    const bundle = JSON.parse(readFileSync(path.join(root, 'bundle.json'), 'utf8'));
    if (/^[a-f0-9]{40}$/.test(bundle.version)) { revision = bundle.version; distribution = 'portable'; }
  } catch {}
  if (!revision && existsSync(path.join(root, '.git'))) {
    try {
      const value = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      if (/^[a-f0-9]{40}$/.test(value)) revision = value;
    } catch {}
  }
  return { version: pkg.version, revision, distribution };
}

export function probeCommand(command, args, env = process.env, timeoutMs = 4000) {
  return new Promise(resolve => {
    const child = spawn(command, args, { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ status: 'timeout', output: '' }); }, timeoutMs);
    const append = chunk => { output = (output + chunk.toString()).slice(0, 8192); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.once('error', e => { clearTimeout(timer); resolve({ status: e.code === 'ENOENT' ? 'missing' : 'error', output: '' }); });
    child.once('close', code => { clearTimeout(timer); resolve({ status: code === 0 ? 'ok' : 'error', output }); });
  });
}

async function whisperPython(binary, env, run) {
  let resolved = binary;
  if (!path.isAbsolute(binary)) {
    const lookup = await run(process.platform === 'win32' ? 'where.exe' : 'which', [binary], env);
    if (lookup.status !== 'ok') return null;
    resolved = lookup.output.trim().split(/\r?\n/)[0];
  }
  if (process.platform === 'win32') {
    return [path.join(path.dirname(resolved), 'python.exe'), path.resolve(path.dirname(resolved), '..', 'python.exe')].find(existsSync) || null;
  }
  let file;
  try {
    file = await open(resolved, 'r'); const header = Buffer.alloc(512);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    const shebang = header.subarray(0, bytesRead).toString().split('\n')[0];
    const direct = shebang.match(/^#!(\/[^\r\n]*\/python[\d.]*)\s*$/);
    if (direct) return direct[1];
    const indirect = shebang.match(/^#!\/usr\/bin\/env (python[\d.]*)\s*$/);
    return indirect?.[1] || null;
  } catch { return null; }
  finally { await file?.close(); }
}

export async function speechDiagnostics(env = process.env, runner = probeCommand) {
  env = managedSpeechEnv(env);
  const deadline = Date.now() + 12000;
  const run = (command, args, environment) => {
    const remaining = Math.min(4000, deadline - Date.now());
    return remaining > 0 ? runner(command, args, environment, remaining) : Promise.resolve({ status: 'timeout', output: '' });
  };
  const configuration = speechConfiguration(env);
  if (configuration.guidance) return { ...configuration, whisper: { status: 'configuration', version: null }, ffmpeg: { status: 'unknown', version: null }, correction: env.PANEL_TRANSCRIPT_CORRECTION === 'off' ? 'off' : 'automatic' };
  const backend = configuration.backend, binary = resolveWhisperBinary(env);
  const [whisper, ffmpeg] = await Promise.all([
    run(binary, ['--help'], env), run(env.PANEL_FFMPEG_BIN || 'ffmpeg', ['-version'], env),
  ]);
  const result = { backend, model: resolveWhisperModel(env),
    whisper: { status: whisper.status, version: null },
    ffmpeg: { status: ffmpeg.status, version: null },
    correction: env.PANEL_TRANSCRIPT_CORRECTION === 'off' ? 'off' : 'automatic' };
  let python;
  if (ffmpeg.status === 'ok') result.ffmpeg.version = ffmpeg.output.match(/ffmpeg version ([^\s]+)/)?.[1] || null;
  if (whisper.status === 'ok') {
    python = env.PANEL_PYTHON_BIN || await whisperPython(binary, env, run);
    if (python) {
      const distribution = backend === 'mlx' ? 'mlx-whisper' : 'openai-whisper';
      const version = await run(python, ['-c', `import importlib.metadata; print(importlib.metadata.version('${distribution}'))`], env);
      if (version.status === 'ok') result.whisper.version = version.output.trim().match(/^[0-9][A-Za-z0-9.+-]{0,63}$/)?.[0] || null;
    }
  }
  if (result.ffmpeg.status !== 'ok') {
    try {
      const ffmpegBinary = await resolveFfmpeg({
        configured: env.PANEL_FFMPEG_BIN,
        pythonCandidates: [env.PANEL_PYTHON_BIN, python, process.platform === 'win32' ? 'python' : 'python3'],
        readProcess: async (command, args) => {
          const response = await run(command, args, env);
          if (response.status !== 'ok') throw new Error('Unavailable');
          return response.output;
        },
      });
      const verified = await run(ffmpegBinary, ['-version'], env);
      result.ffmpeg = { status: verified.status, version: verified.output.match(/ffmpeg version ([^\s]+)/)?.[1] || null };
    } catch { /* Keep the bounded status without exposing paths or raw errors. */ }
  }
  return result;
}

export function cachedDiagnostics(collect, { ttlMs = 60000 } = {}) {
  let value, expires = 0, pending;
  return async () => {
    if (value && Date.now() < expires) return value;
    if (pending) return pending;
    pending = Promise.resolve().then(collect).then(result => { value = result; expires = Date.now() + ttlMs; return result; }).finally(() => { pending = null; });
    return pending;
  };
}

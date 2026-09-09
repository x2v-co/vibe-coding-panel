// Real clean-install acceptance, called against the extracted portable package.
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, copyFile, chmod, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const app = path.resolve(process.argv[2]);
const runtime = process.argv[3];
const home = await mkdtemp(path.join(tmpdir(), 'vibe clean voice '));
const win = process.platform === 'win32';
const env = { ...process.env, PANEL_SPEECH_HOME: home, PATH: win ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin' };
for (const key of Object.keys(env)) if (key.startsWith('PANEL_WHISPER_') || ['PANEL_PYTHON_BIN', 'PANEL_FFMPEG_BIN', 'VIRTUAL_ENV', 'CONDA_PREFIX', 'PYTHONPATH', 'PYTHONHOME'].includes(key)) delete env[key];
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { env, cwd: app, encoding: 'utf8', timeout: 30 * 60 * 1000, ...options });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stderr || ''}\n${result.stdout || ''}`);
  return result.stdout;
}
try {
  run(runtime, ['scripts/launch.mjs', '--setup-voice'], { stdio: 'inherit' });
  const config = JSON.parse(await readFile(path.join(home, 'current.json'), 'utf8'));
  assert.equal(config.platform, process.platform); assert.equal(config.arch, process.arch);
  assert.ok(config.python.startsWith(home));
  assert.match(run(config.python, ['--version']), /Python 3\.11\./);
  const bin = path.join(home, 'bin'); await mkdir(bin);
  const ffmpeg = path.join(bin, win ? 'ffmpeg.exe' : 'ffmpeg');
  await copyFile(config.ffmpeg, ffmpeg); await chmod(ffmpeg, 0o755);
  env.PATH = bin + path.delimiter + env.PATH;
  const audio = path.join(home, 'silence.wav');
  run(config.python, ['-c', 'import wave,sys; w=wave.open(sys.argv[1],"wb"); w.setparams((1,2,16000,0,"NONE","NONE")); w.writeframes(bytes(32000)); w.close()', audio]);
  run(config.whisper, [audio, '--model', 'small', '--model_dir', config.modelDir, '--language', 'zh', '--fp16', 'False', '--threads', '2', '--output_format', 'txt', '--output_dir', home], { timeout: 180000 });
  await readFile(path.join(home, 'silence.txt'));
  const diagnostics = JSON.parse(run(runtime, ['--input-type=module', '-e', 'import {speechDiagnostics} from "./server/runtime-info.js"; console.log(JSON.stringify(await speechDiagnostics()))']));
  assert.equal(diagnostics.whisper.status, 'ok');
  assert.equal(diagnostics.whisper.version, '20250625');
  assert.equal(diagnostics.ffmpeg.status, 'ok');
  console.log('Clean managed Python/Whisper/model/ffmpeg install, transcription and auto-discovery passed.');
} finally { await rm(home, { recursive: true, force: true }); }

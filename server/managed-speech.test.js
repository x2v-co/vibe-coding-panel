import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { managedSpeechEnv } from './managed-speech.js';
import { buildWhisperArgs } from './whisper-options.js';

test('managed speech activates only a complete compatible install and preserves explicit configuration', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'vibe speech '));
  const env = { PANEL_SPEECH_HOME: home };
  try {
    assert.deepEqual(managedSpeechEnv(env), env);
    const config = { schema: 1, platform: process.platform, arch: process.arch, modelDir: path.join(home, 'models') };
    for (const key of ['whisper', 'python', 'ffmpeg']) {
      config[key] = path.join(home, key); await writeFile(config[key], 'fixture');
    }
    await mkdir(config.modelDir);
    const save = () => writeFile(path.join(home, 'current.json'), JSON.stringify(config));
    await save();
    assert.deepEqual(managedSpeechEnv(env), env, 'missing model must not advertise ready speech');
    await writeFile(path.join(config.modelDir, 'small.pt'), 'fixture');
    const installed = managedSpeechEnv(env);
    assert.equal(installed.PANEL_WHISPER_BIN, config.whisper);
    assert.equal(installed.PANEL_PYTHON_BIN, config.python);
    assert.equal(installed.PANEL_FFMPEG_BIN, config.ffmpeg);
    assert.equal(managedSpeechEnv({ ...env, PYTHONIOENCODING: 'cp1252' }).PYTHONIOENCODING, 'utf-8');
    const custom = { ...env, PANEL_WHISPER_BACKEND: 'mlx', PANEL_WHISPER_MODEL: 'custom-model' };
    assert.deepEqual(managedSpeechEnv(custom), custom);
    assert.deepEqual(managedSpeechEnv({ ...env, PANEL_WHISPER_BIN: '/custom/whisper' }), { ...env, PANEL_WHISPER_BIN: '/custom/whisper' });
    assert.equal(managedSpeechEnv({ ...env, PANEL_FFMPEG_BIN: '/custom/ffmpeg' }).PANEL_FFMPEG_BIN, '/custom/ffmpeg');
    const args = buildWhisperArgs('audio.wav', 'small', 'zh', home, 'openai', installed);
    assert.equal(args[args.indexOf('--model_dir') + 1], config.modelDir);
    assert.ok(!buildWhisperArgs('audio.wav', 'custom', 'zh', home, 'mlx', installed).includes('--model-dir'));
    config.arch = 'unsupported'; await save();
    assert.deepEqual(managedSpeechEnv(env), env);
    await writeFile(path.join(home, 'current.json'), '{broken');
    assert.deepEqual(managedSpeechEnv(env), env);
  } finally { await rm(home, { recursive: true, force: true }); }
});

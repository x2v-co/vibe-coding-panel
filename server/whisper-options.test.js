import assert from 'node:assert/strict';
import test from 'node:test';
import { buildWhisperArgs, resolveWhisperModel, resolveWhisperTimeout } from './whisper-options.js';

test('uses the more accurate small model for short Mandarin commands', () => {
  assert.equal(resolveWhisperModel({}), 'small');
  assert.equal(resolveWhisperModel({ PANEL_WHISPER_MODEL: 'base' }), 'base');
});

test('allows the first model download to finish on slower connections', () => {
  assert.equal(resolveWhisperTimeout({}), 20 * 60 * 1000);
  assert.equal(resolveWhisperTimeout({ PANEL_WHISPER_TIMEOUT_MS: '45000' }), 45000);
  assert.equal(resolveWhisperTimeout({ PANEL_WHISPER_TIMEOUT_MS: 'invalid' }), 20 * 60 * 1000);
});

test('short voice commands are transcribed without a seeded phrase', () => {
  const args = buildWhisperArgs('/tmp/speech.m4a', 'small', 'zh', '/tmp/output');
  const conditionIndex = args.indexOf('--condition_on_previous_text');

  assert.equal(args.includes('--initial_prompt'), false);
  assert.deepEqual(args.slice(conditionIndex, conditionIndex + 2), [
    '--condition_on_previous_text', 'False',
  ]);
});

test('MLX CLI receives compatible flags and a larger multilingual model without seeded text', async () => {
  const { resolveWhisperBackend, resolveWhisperBinary } = await import('./whisper-options.js');
  const env = { PANEL_WHISPER_BACKEND: 'mlx' };
  assert.equal(resolveWhisperBackend(env), 'mlx');
  assert.equal(resolveWhisperBinary(env), 'mlx_whisper');
  const model = resolveWhisperModel(env);
  assert.equal(model, 'mlx-community/whisper-large-v3-turbo-q4');
  const args = buildWhisperArgs('/tmp/input_voice.wav', model, 'zh', '/tmp/voice_output', 'mlx');
  assert.equal(args[0], '/tmp/input_voice.wav');
  assert.ok(args.includes('/tmp/voice_output'));
  for (const flag of ['--condition-on-previous-text', '--output-format', '--output-dir']) assert.ok(args.includes(flag));
  assert.equal(args.some(arg => arg.startsWith('--') && arg.includes('_')), false);
  assert.equal(args.includes('--initial-prompt'), false);
  assert.throws(() => resolveWhisperBackend({ PANEL_WHISPER_BACKEND: 'unknown' }), /must be/);
});

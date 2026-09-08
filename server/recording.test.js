import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = await mkdtemp(join(tmpdir(), 'panel-recording-test-'));
let outputText;
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--ignoreConfig', fileURLToPath(new URL('../src/recording.ts', import.meta.url)), '--target', 'es2022', '--module', 'es2022', '--skipLibCheck', '--outDir', directory]);
  outputText = await readFile(join(directory, 'recording.js'), 'utf8');
} finally {
  await rm(directory, { recursive: true, force: true });
}
const { recordingMimeTypes, validateRecording } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('Apple mobile browsers prefer MP4, desktop Chromium prefers Opus WebM', () => {
  assert.equal(recordingMimeTypes('iPhone CriOS Safari')[0], 'audio/mp4');
  assert.equal(recordingMimeTypes('Macintosh Safari', 5)[0], 'audio/mp4');
  assert.equal(recordingMimeTypes('Chrome Safari')[0], 'audio/webm;codecs=opus');
});

test('a nonempty container without decoded audio is rejected before upload', async () => {
  const previous = globalThis.AudioContext;
  let closed = 0;
  globalThis.AudioContext = class {
    async decodeAudioData() { throw new Error('Decode failed'); }
    async close() { closed++; }
  };
  try {
    await assert.rejects(validateRecording(new Blob(['header only'])), /未生成完整录音/);
    assert.equal(closed, 1);
  } finally {
    if (previous) globalThis.AudioContext = previous;
    else delete globalThis.AudioContext;
  }
});

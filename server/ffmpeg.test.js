import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveFfmpeg } from './ffmpeg.js';

test('broken configured and PATH ffmpeg fall back to a validated Python binary', async () => {
  const calls = [];
  const binary = await resolveFfmpeg({
    configured: '/broken/ffmpeg', pythonCandidates: ['/bad/python', '/good/python'],
    async readProcess(command, args) {
      calls.push([command, args]);
      if (command === '/good/python') return '/bundled/ffmpeg\n';
      if (command === '/bundled/ffmpeg') return 'ffmpeg version 7';
      throw new Error('Library not loaded');
    },
  });
  assert.equal(binary, '/bundled/ffmpeg');
  assert.deepEqual(calls.at(-1), ['/bundled/ffmpeg', ['-version']]);
  assert.deepEqual(calls.slice(0, 2).map(([command]) => command), ['/broken/ffmpeg', 'ffmpeg']);
});

test('an explicit working ffmpeg wins without inspecting other installations', async () => {
  let calls = 0;
  assert.equal(await resolveFfmpeg({
    configured: '/custom/ffmpeg', pythonCandidates: ['python'],
    async readProcess(command) { calls++; assert.equal(command, '/custom/ffmpeg'); return 'version'; },
  }), '/custom/ffmpeg');
  assert.equal(calls, 1);
});

test('a broken Python-bundled binary is rejected with an actionable error', async () => {
  await assert.rejects(resolveFfmpeg({
    pythonCandidates: ['python'],
    async readProcess(command) {
      if (command === 'python') return '/broken/bundled-ffmpeg';
      throw new Error('Library not loaded');
    },
  }), /imageio-ffmpeg/);
});

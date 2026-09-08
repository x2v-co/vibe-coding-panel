import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = await mkdtemp(join(tmpdir(), 'panel-micro-test-'));
let outputText;
try {
  execFileSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '--ignoreConfig', fileURLToPath(new URL('../src/micro.ts', import.meta.url)), '--target', 'es2022', '--module', 'es2022', '--skipLibCheck', '--outDir', directory]);
  outputText = await readFile(join(directory, 'micro.js'), 'utf8');
} finally {
  await rm(directory, { recursive: true, force: true });
}
const { defaultMicroKeys, microKeycapAssets, readMicroConfiguration, updateMicroConfiguration, unavailableMicroAction, MicroVoiceGesture } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);

test('Micro brand asset is a standard SVG, never a raster keycap crop', async () => {
  assert.deepEqual(microKeycapAssets, { codex: '/keycaps/micro/codex.svg' });
  const image = await readFile(new URL(`../public${microKeycapAssets.codex}`, import.meta.url), 'utf8');
  assert.match(image, /viewBox="0 0 24 24"/);
  assert.match(image, /<path /);
  assert.doesNotMatch(image, /<image|<script|data:image/);
});

test('Micro defaults keep approval, decline and fork distinct from send, stop and new', () => {
  assert.deepEqual(defaultMicroKeys.map(({ id, action }) => [id, action]), [
    ['quick', 'fast'], ['approve', 'approve'], ['decline', 'decline'], ['fork', 'fork'], ['mic', 'voice'], ['send', 'execute'],
  ]);
  for (const action of ['fast', 'approve', 'decline', 'fork']) assert.ok(unavailableMicroAction(action));
  assert.equal(unavailableMicroAction('execute'), undefined);
});

test('legacy incorrect defaults migrate while user text and custom bindings survive', () => {
  const saved = [
    { id: 'approve', action: 'execute', label: 'YES', icon: 'check' },
    { id: 'decline', action: 'stop', icon: 'stop' },
    { id: 'fork', action: 'new', label: 'NEW' },
    { id: 'quick', action: 'prompt', prompt: 'review code', color: 'pink' },
  ];
  const migrated = readMicroConfiguration(saved, '1');
  assert.equal(migrated[1].action, 'approve');
  assert.equal(migrated[1].label, 'YES');
  assert.equal(migrated[2].action, 'decline');
  assert.equal(migrated[2].icon, 'decline');
  assert.equal(migrated[3].label, 'FORK');
  assert.equal(migrated[0].action, 'prompt');
  assert.equal(migrated[0].prompt, 'review code');
  assert.equal(readMicroConfiguration(saved, '2')[1].action, 'execute');
});

test('invalid saved values cannot enter the command dispatcher', () => {
  assert.deepEqual(readMicroConfiguration({}, '2'), defaultMicroKeys);
  const keys = readMicroConfiguration([null, { id: 'mic', action: 'bogus', icon: {}, color: 3, label: 42, prompt: {} }], '2');
  assert.deepEqual(keys[4], defaultMicroKeys[4]);
});

test('keycap swap leaves physical slots and actions unchanged', () => {
  const keys = updateMicroConfiguration(defaultMicroKeys, 'approve', { icon: 'mic' });
  assert.equal(keys[1].icon, 'mic');
  assert.equal(keys[4].icon, 'check');
  assert.equal(keys[1].action, 'approve');
  assert.equal(keys[4].action, 'voice');
  assert.equal(defaultMicroKeys[1].icon, 'check');
});

test('hold to talk stops on release and ignores repeated press', () => {
  const gesture = new MicroVoiceGesture();
  assert.equal(gesture.press(0), 'start');
  assert.equal(gesture.press(50), 'none');
  assert.equal(gesture.release(1000), 'stop');
  assert.equal(gesture.release(1100), 'none');
});

test('double tap within 350ms latches, next press stops without restarting on release', () => {
  const gesture = new MicroVoiceGesture();
  assert.equal(gesture.press(0), 'start');
  assert.equal(gesture.release(50), 'defer');
  assert.equal(gesture.press(300), 'latch');
  assert.equal(gesture.release(330), 'none');
  assert.equal(gesture.latched, true);
  assert.equal(gesture.press(900), 'stop');
  assert.equal(gesture.release(950), 'none');
  assert.equal(gesture.latched, false);
});

test('double tap window is measured from press, cancellation clears all gesture state', () => {
  const gesture = new MicroVoiceGesture();
  gesture.press(0);
  gesture.release(300);
  assert.equal(gesture.press(351), 'start');
  gesture.reset();
  assert.equal(gesture.release(400), 'none');
  assert.equal(gesture.press(410), 'start');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releasePlugin } from './release-plugin.mjs';

test('generateBundle pins sw.js to the build and emits version.json', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-release-'));
  try {
    fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'dist', 'sw.js'), "const REVISION = '__PANEL_REVISION__';\nconst VERSION = '__PANEL_VERSION__';\n");
    const plugin = releasePlugin({ revision: 'abcdef0123456789abcdef0123456789abcdef01', version: '9.9.9' });
    plugin.configResolved({ build: { outDir: path.join(dir, 'dist') } });
    const emitted = [];
    plugin.generateBundle.call({ emitFile: (file) => emitted.push(file), warn: (message) => { throw new Error(message); } });

    const sw = fs.readFileSync(path.join(dir, 'dist', 'sw.js'), 'utf8');
    assert.ok(sw.includes('abcdef0123456789abcdef0123456789abcdef01'));
    assert.ok(sw.includes('9.9.9'));
    assert.ok(!sw.includes('__PANEL_REVISION__'));
    assert.ok(!sw.includes('__PANEL_VERSION__'));

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].fileName, 'version.json');
    const manifest = JSON.parse(emitted[0].source);
    assert.deepEqual(manifest, { name: 'vibe-coding-panel', version: '9.9.9', revision: 'abcdef0123456789abcdef0123456789abcdef01' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('missing sw.js warns instead of throwing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-release-'));
  try {
    const plugin = releasePlugin({ revision: 'a'.repeat(40), version: '1.0.0' });
    plugin.configResolved({ build: { outDir: dir } });
    const warnings = [];
    plugin.generateBundle.call({ emitFile: () => {}, warn: (message) => warnings.push(message) });
    assert.equal(warnings.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

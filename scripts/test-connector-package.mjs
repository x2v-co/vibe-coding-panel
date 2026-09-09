import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '..');
const directory = await mkdtemp(path.join(tmpdir(), 'vibe extracted '));
const zip = path.join(root, 'release', `vibe-connector-${process.platform}-${process.arch}.zip`);
try {
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', ['-c', `import zipfile,sys,pathlib,os
with zipfile.ZipFile(sys.argv[1]) as z:
 for i in z.infolist():
  p=pathlib.PurePosixPath(i.filename)
  assert not p.is_absolute() and '..' not in p.parts
  assert '.env' not in p.parts and '.vibe-panel' not in p.parts and 'voice-fix-deployment-20260908.md' not in p.parts
  target=z.extract(i,sys.argv[2])
  if os.name!='nt': os.chmod(target,(i.external_attr>>16)&0o777 or 0o644)
`, zip, directory]);
  const app = path.join(directory, 'Vibe-Panel-Connector');
  const runtime = path.join(app, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
  const metadata = JSON.parse(await readFile(path.join(app, 'bundle.json'), 'utf8'));
  assert.equal(metadata.platform, process.platform); assert.equal(metadata.arch, process.arch);
  assert.equal(execFileSync(runtime, ['--version'], { encoding: 'utf8' }).trim(), metadata.node);
  const fixture = path.join(directory, process.platform === 'win32' ? 'agent.cmd' : 'agent');
  const fixtureScript = path.join(root, 'server/fixtures/agent-cli.cjs');
  await writeFile(fixture, process.platform === 'win32' ? `@echo off\r\n"${runtime}" "${fixtureScript}" %*\r\n` : `#!/bin/sh\nexec "${runtime}" "${fixtureScript}" "$@"\n`);
  await chmod(fixture, 0o755);
  const systemPath = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32') : '/usr/bin:/bin';
  const env = { ...process.env, PATH: systemPath, PANEL_CODEX_BIN: fixture, PANEL_CLAUDE_BIN: fixture, CODEX_HOME: directory, CLAUDE_CONFIG_DIR: directory };
  const launcher = spawnSync(process.platform === 'win32' ? 'cmd.exe' : '/bin/bash', process.platform === 'win32' ? ['/d', '/c', 'Vibe Panel.bat', '--doctor', '--json'] : ['Vibe Panel.sh', '--doctor', '--json'], { cwd: app, env, encoding: 'utf8', timeout: 30000 });
  assert.equal(launcher.status, 0, launcher.stderr + launcher.stdout);
  const report = JSON.parse(launcher.stdout);
  assert.equal(report.ok, true);
  assert.equal(report.bundle.version, metadata.version);
  assert.ok(!report.checks.some(check => check.name === 'npm'));
  const checks = spawnSync(process.execPath, ['--test', 'scripts/acceptance.test.mjs'], { cwd: root, env: { ...env, PANEL_ACCEPTANCE_ROOT: app }, stdio: 'inherit', timeout: 120000 });
  assert.equal(checks.status, 0, 'Extracted package acceptance failed');
  console.log('Portable launcher, no-global-Node/npm diagnostics, pairing and task execution passed.');
  if (process.env.PANEL_TEST_VOICE_SETUP === '1') {
    const voice = spawnSync(process.execPath, [path.join(root, 'scripts/test-voice-setup.mjs'), app, runtime], { cwd: root, env, stdio: 'inherit', timeout: 40 * 60 * 1000 });
    assert.equal(voice.status, 0, 'Portable speech setup acceptance failed');
  }
} finally { await rm(directory, { recursive: true, force: true }); }

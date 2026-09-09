import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';
const root = path.resolve(import.meta.dirname, '..');
function run(args, env, cwd = root) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env } });
    let stdout = '', stderr = '';
    child.stdout.on('data', data => stdout += data);
    child.stderr.on('data', data => stderr += data);
    child.on('exit', code => resolve({ code, stdout, stderr }));
  });
}
test('fresh checkout reports missing dependencies without importing them', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vibe clean '));
  try {
    await cp(path.join(root, 'scripts'), path.join(directory, 'scripts'), { recursive: true });
    await cp(path.join(root, 'package.json'), path.join(directory, 'package.json'));
    const result = await run(['scripts/launch.mjs', '--doctor', '--json'], {}, directory);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).checks.find(c => c.name === 'dependencies').ok, false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('installed checkout diagnoses missing and authenticated agents and occupied port', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vibe agent '));
  const occupied = net.createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  try {
    const missing = path.join(directory, 'missing');
    const env = { PANEL_CODEX_BIN: missing, PANEL_CLAUDE_BIN: missing, PANEL_API_PORT: String(occupied.address().port) };
    let result = await run(['scripts/launch.mjs', '--doctor', '--json'], env);
    assert.equal(result.code, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).checks.find(c => c.name === 'agent login').ok, false);
    const cli = path.join(directory, process.platform === 'win32' ? 'agent.cmd' : 'agent');
    const fixture = path.join(root, 'server/fixtures/agent-cli.cjs');
    await writeFile(cli, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
    await chmod(cli, 0o755);
    result = await run(['scripts/launch.mjs', '--doctor', '--json'], { ...env, PANEL_CODEX_BIN: cli });
    assert.equal(result.code, 0, result.stderr + result.stdout);
    const report = JSON.parse(result.stdout);
    assert.equal(report.ok, true);
    assert.notEqual(report.port, occupied.address().port);
  } finally {
    await new Promise(resolve => occupied.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('unified launcher connects, pairs and runs a fixture task through Relay', { timeout: 90000 }, async () => {
  const { createRelayServer } = await import('../server/relay.js');
  const relay = createRelayServer({ audit() {} });
  await new Promise(resolve => relay.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${relay.server.address().port}`;
  const directory = await mkdtemp(path.join(tmpdir(), 'vibe launch '));
  const cli = path.join(directory, process.platform === 'win32' ? 'agent.cmd' : 'agent');
  const fixture = path.join(root, 'server/fixtures/agent-cli.cjs');
  await writeFile(cli, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
  await chmod(cli, 0o755);
  const child = spawn(process.execPath, ['scripts/launch.mjs'], {
    cwd: root, detached: process.platform !== 'win32',
    env: { ...process.env, PANEL_CODEX_BIN: cli, PANEL_CLAUDE_BIN: cli, PANEL_AGENT_PROVIDER: 'codex', PANEL_RELAY_URL: origin, PANEL_RELAY_STATE: path.join(directory, 'relay.json'), PANEL_DEVICE_STORE: path.join(directory, 'devices.json'), PANEL_BRIDGE_TOKEN: '', CODEX_HOME: directory, CLAUDE_CONFIG_DIR: directory },
  });
  let output = '';
  child.stdout.on('data', data => output += data);
  child.stderr.on('data', data => output += data);
  async function until(fn) {
    for (let i = 0; i < 500; i++) {
      const result = await fn();
      if (result) return result;
      if (child.exitCode !== null) throw new Error(`Launcher exited: ${output}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Startup timeout: ${output}`);
  }
  try {
    const code = await until(() => output.match(/配对码：([A-Za-z0-9-]+)/)?.[1]);
    const id = await until(() => [...relay.connectors.keys()][0]);
    let cookie = `vibe_relay_connector=${id}`;
    const paired = await fetch(origin + '/api/pair', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    assert.equal(paired.status, 201, await paired.text());
    cookie += '; ' + paired.headers.get('set-cookie').split(';')[0];
    const jobResponse = await fetch(origin + '/api/jobs', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: 'verify', cwd: directory }) });
    assert.equal(jobResponse.status, 201);
    const job = await jobResponse.json();
    const completed = await until(async () => {
      const response = await fetch(origin + '/api/jobs/' + job.id, { headers: { Cookie: cookie } });
      const state = await response.json();
      if (state.status === 'failed') throw new Error(JSON.stringify(state));
      return state.status === 'completed' && state;
    });
    assert.ok(JSON.parse(completed.result).args.includes('verify'));
  } finally {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      await new Promise(resolve => killer.once('exit', resolve));
    } else { try { process.kill(-child.pid, 'SIGTERM'); } catch {} }
    for (const socket of relay.connectors.values()) socket.terminate();
    await new Promise(resolve => relay.server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

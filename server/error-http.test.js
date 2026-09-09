import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

test('HTTP errors preserve text-mode health with bad speech config and explain missing CLI and provider quota', { timeout: 20000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'panel errors '));
  const fixture = path.resolve('server/fixtures/agent-cli.cjs');
  const cli = path.join(directory, process.platform === 'win32' ? 'agent.cmd' : 'agent');
  await writeFile(cli, process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${fixture}" %*\r\n` : `#!/bin/sh\nexec "${process.execPath}" "${fixture}" "$@"\n`);
  await chmod(cli, 0o755);
  const child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PANEL_API_PORT: '0', PANEL_BRIDGE_TOKEN: '', PANEL_AGENT_PROVIDER: 'codex', PANEL_CODEX_BIN: path.join(directory, 'missing-cli'), PANEL_CLAUDE_BIN: cli,
      PANEL_WHISPER_BACKEND: 'bad-configuration', PANEL_DEVICE_STORE: path.join(directory, 'devices.json'), CODEX_HOME: directory, CLAUDE_CONFIG_DIR: directory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const origin = await new Promise((resolve, reject) => {
      child.once('error', reject); child.once('exit', code => reject(new Error(`Server exited: ${code}`)));
      child.stdout.on('data', chunk => { const url = chunk.toString().match(/http:\/\/127.0.0.1:\d+/); if (url) resolve(url[0]); });
    });
    const post = (route, body) => fetch(origin + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const health = await fetch(origin + '/api/health');
    assert.equal(health.status, 200); assert.match((await health.json()).speech.guidance, /仍可使用文字/);
    const speech = await post('/api/transcriptions', { audio: 'fixture' });
    assert.equal(speech.status, 503); assert.equal((await speech.json()).code, 'SPEECH_CONFIGURATION');
    for (const [provider, prompt, expected] of [['codex', 'fixture', /安装/], ['claude', 'quota-failure', /额度不足或请求受限/], ['claude', 'verify', null]]) {
      const response = await post('/api/jobs', { cwd: directory, provider, prompt });
      assert.equal(response.status, 201); const { id } = await response.json();
      let job;
      for (let attempt = 0; attempt < 100; attempt++) {
        job = await (await fetch(origin + '/api/jobs/' + id)).json();
        if (['completed', 'failed'].includes(job.status) && job.events.at(-1)?.type === 'status') break;
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      assert.equal(job.status, expected ? 'failed' : 'completed');
      if (expected) { assert.match(job.events.at(-1).text, expected); assert.doesNotMatch(job.events.at(-1).text, /ENOENT|usage_limit_reached/); }
    }
  } finally {
    const exited = new Promise(resolve => child.once('exit', resolve));
    if (child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});

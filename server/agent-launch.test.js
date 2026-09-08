import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, copyFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('HTTP jobs use configured CLI, inherited credentials and workspace for run and resume', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'panel-launch-test-'));
  const binary = path.join(dir, 'custom codex');
  await copyFile(new URL('./fixtures/agent-cli.cjs', import.meta.url), binary);
  await chmod(binary, 0o700);
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PANEL_API_PORT: '0', PANEL_BRIDGE_TOKEN: '', PANEL_REQUIRE_PAIRING: '', PANEL_DEVICE_STORE: path.join(dir, 'devices.json'), PANEL_CODEX_BIN: binary, PANEL_CLAUDE_BIN: binary, PANEL_AGENT_PROVIDER: 'codex', PANEL_TEST_CREDENTIAL: 'fixture-credential', CODEX_HOME: dir },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const origin = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Server exited: ${code}`)));
      child.stdout.on('data', (chunk) => {
        const match = chunk.toString().match(/http:\/\/127.0.0.1:\d+/);
        if (match) resolve(match[0]);
      });
    });
    const request = async (route, body) => {
      const response = await fetch(origin + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
      assert.equal(response.ok, true);
      return response.json();
    };
    const completed = async (id) => {
      for (let i = 0; i < 100; i++) {
        const job = await request(`/api/jobs/${id}`);
        if (['completed', 'failed'].includes(job.status)) return job;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error('Job timed out');
    };
    const { id } = await request('/api/jobs', { prompt: 'verify', cwd: dir });
    const health = await request('/api/health');
    assert.equal(health.defaultProvider, 'codex');
    const pairing = await request('/api/pairing-codes', { publicUrl: `https://relay.example/app?relay=${'a'.repeat(43)}` });
    const pairingUrl = new URL(pairing.pairingUrl);
    assert.equal(pairingUrl.pathname, '/app');
    assert.equal(pairingUrl.searchParams.get('relay'), 'a'.repeat(43));
    assert.equal(pairingUrl.searchParams.get('pair'), pairing.code);
    let job = await completed(id);
    assert.equal(job.status, 'completed');
    let result = JSON.parse(job.result);
    assert.equal(result.credentialInherited, true);
    assert.equal(result.codexHome, dir);
    assert.equal(await realpath(result.cwd), await realpath(dir));
    assert.equal(result.args.includes('-c'), false, 'Panel must not override model-provider authentication');
    assert.equal(result.args.includes('--cd'), true);
    await request(`/api/jobs/${id}/follow-up`, { prompt: 'continue' });
    job = await completed(id);
    result = JSON.parse(job.result);
    assert.equal(job.status, 'completed');
    assert.equal(result.args.includes('resume'), true);
    assert.equal(result.args.includes('fixture-thread'), true);
    assert.equal(result.credentialInherited, true);

    const failure = await request('/api/jobs', { prompt: 'auth-failure', cwd: dir });
    job = await completed(failure.id);
    assert.equal(job.status, 'failed');
    assert.match(job.events.at(-1).text, /模型服务拒绝/);
    const retry = await request('/api/jobs', { prompt: 'retry-success', cwd: dir });
    assert.equal((await completed(retry.id)).status, 'completed');
    const claude = await request('/api/jobs', { prompt: 'verify', cwd: dir, agentProvider: 'claude' });
    job = await completed(claude.id);
    assert.equal(job.provider, 'claude');
    assert.equal(job.agentProvider, 'claude');
    assert.equal(job.status, 'completed');
    assert.equal(JSON.parse(job.result).args.includes('--output-format'), true);
    await request(`/api/jobs/${claude.id}/follow-up`, { prompt: 'continue' });
    job = await completed(claude.id);
    assert.equal(job.status, 'completed');
    assert.equal(JSON.parse(job.result).args.includes('--resume'), true);
  } finally {
    const exited = once(child, 'exit');
    child.kill('SIGTERM');
    await exited;
    await rm(dir, { recursive: true, force: true });
  }
});

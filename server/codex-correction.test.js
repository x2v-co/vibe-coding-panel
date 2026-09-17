import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { codexCorrectionConfig, runCodexCorrection, readCodexCorrectionConfig } from './codex-correction.js';
import { createTranscriptCorrector, correctWithProvider, correctionArgs } from './transcript-correction.js';

test('Codex uses the selected provider, model and auth without Claude configuration', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'codex-correction-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(path.join(dir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fixture' }));
  const config = await codexCorrectionConfig({ CODEX_HOME: dir, ANTHROPIC_API_KEY: 'wrong' }, async () => ({
    model: 'selected-model', model_provider: 'custom',
    model_providers: { custom: { base_url: 'https://example.test/v1', requires_openai_auth: true, wire_api: 'responses' } },
  }));
  assert.equal(config.model, 'selected-model');
  assert.equal(config.url, 'https://example.test/v1/responses');
  assert.equal(config.headers.Authorization, 'Bearer fixture');
  await writeFile(path.join(dir, 'auth.json'), JSON.stringify({ tokens: { access_token: 'oauth-do-not-forward' } }));
  await assert.rejects(codexCorrectionConfig({ CODEX_HOME: dir }, async () => ({ model: 'selected', model_provider: 'openai' })), /登录方式/);
});

test('provider env credentials are not replaced by another provider credential', async () => {
  const config = await codexCorrectionConfig({ CUSTOM_TOKEN: 'custom', OPENAI_API_KEY: 'wrong' }, async () => ({
    model: 'm', model_provider: 'custom', model_providers: { custom: { base_url: 'https://example.test/v1', env_key: 'CUSTOM_TOKEN' } },
  }));
  assert.equal(config.headers.Authorization, 'Bearer custom');
  await assert.rejects(codexCorrectionConfig({ OPENAI_API_KEY: 'wrong' }, async () => ({
    model: 'm', model_provider: 'custom', model_providers: { custom: { base_url: 'https://example.test/v1', env_key: 'CUSTOM_TOKEN', requires_openai_auth: true } },
  })), /缺少指定/);
});

test('missing Codex executable rejects without crashing the API', async () => {
  await assert.rejects(readCodexCorrectionConfig({ PANEL_CODEX_BIN: '/nonexistent-vibe-codex' }, { timeoutMs: 5000 }), /unavailable/);
});

test('stalled config reader and exited subprocess promptly release pending requests', { skip: process.platform === 'win32' }, async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'codex-config-process-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'codex');
  await writeFile(bin, `#!${process.execPath}\nprocess.stdin.resume();\n`, { mode: 0o755 });
  const started = Date.now();
  await assert.rejects(readCodexCorrectionConfig({ PANEL_CODEX_BIN: bin }, { timeoutMs: 100 }), /超时/);
  assert.ok(Date.now() - started < 2000);
  await writeFile(bin, `#!${process.execPath}\nprocess.exit(1);\n`);
  await assert.rejects(readCodexCorrectionConfig({ PANEL_CODEX_BIN: bin }, { timeoutMs: 5000 }), /unavailable/);
});

test('slow response body times out and leaves the original draft intact', async () => {
  const { createServer } = await import('node:http');
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    let state;
    const correct = createTranscriptCorrector({ run: (text, options) => runCodexCorrection(text, '校对', {
      ...options, resolveConfig: async (_env, _reader, { timeoutMs }) => {
        assert.equal(timeoutMs, 100);
        return { url: `http://127.0.0.1:${server.address().port}`, model: 'fixture' };
      },
    }) });
    assert.equal(await correct('保留原文', { timeoutMs: 100, onStatus: status => { state = status; } }), '保留原文');
    assert.equal(state, 'unavailable');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Codex correction has no tools, does not store a session, and ignores reasoning', async () => {
  const output = await runCodexCorrection('请支回复收到', '只校对', {
    resolveConfig: async () => ({ url: 'https://example.test/v1/responses', model: 'selected', headers: {} }),
    fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'selected'); assert.deepEqual(body.tools, []); assert.equal(body.tool_choice, 'none');
      assert.equal(body.store, false); assert.equal(JSON.parse(body.input).transcript, '请支回复收到');
      assert.equal(options.redirect, 'error');
      return Response.json({ status: 'completed', output: [
        { type: 'reasoning', summary: [{ text: 'private' }] },
        { type: 'message', content: [{ type: 'output_text', text: '{"text":"请只回复收到"}' }] },
      ] });
    },
  });
  assert.equal(JSON.parse(JSON.parse(output).result).text, '请只回复收到');
  assert.ok(!output.includes('private'));
});

test('failed, partial and tool-bearing responses cannot become a corrected draft', async () => {
  for (const response of [new Response('', { status: 401 }), Response.json({ status: 'incomplete', output: [] }),
    Response.json({ status: 'completed', output: [{ type: 'function_call' }] }), new Response('x'.repeat(65537))]) {
    await assert.rejects(runCodexCorrection('原文', '校对', {
      resolveConfig: async () => ({ url: 'https://example.test', model: 'm' }), fetchImpl: async () => response,
    }));
  }
});

test('mode switches route each request and failure never retries a different provider', async () => {
  const calls = [], statuses = [];
  const correct = createTranscriptCorrector({ env: {}, run: async (text, { provider }) => {
    calls.push(provider);
    if (provider === 'codex') throw new Error('unavailable');
    return JSON.stringify({ result: JSON.stringify({ text: text + '。' }) });
  } });
  assert.equal(await correct('原文', { provider: 'codex', onStatus: s => statuses.push(s) }), '原文');
  assert.equal(await correct('原文', { provider: 'claude', onStatus: s => statuses.push(s) }), '原文。');
  assert.deepEqual(calls, ['codex', 'claude']); assert.deepEqual(statuses, ['unavailable', 'completed']);
  assert.ok(!correctionArgs({}).includes('--model'));
  await assert.rejects(correctWithProvider('原文', { provider: 'unknown' }), /Unsupported/);
});

test('CLI correction inherits authentication, isolates workspace, and rejects failed/tool turns', { skip: process.platform === 'win32' }, async t => {
  const { runCodexCliCorrection } = await import('./codex-correction.js');
  const dir = await mkdtemp(path.join(tmpdir(), 'correction-cli-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'codex');
  await writeFile(bin, `#!${process.execPath}
const assert = require('node:assert/strict');
assert.notEqual(process.cwd(), process.env.WORKSPACE);
assert.equal(process.env.CODEX_HOME, 'existing-login-home');
assert.ok(process.argv.includes('--ephemeral'));
assert.ok(process.argv.includes('model_reasoning_effort=\"low\"'));
assert.ok(process.argv.includes('features.shell_tool=false'));
assert.ok(process.argv.includes('plugins."example".enabled=false'));
process.stdin.resume();
process.stdin.on('end', () => {
 console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{"text":"请回复收到"}'}}));
 if(process.env.SCENARIO==='tool') console.log(JSON.stringify({type:'item.completed',item:{type:'command_execution'}}));
 console.log(JSON.stringify({type:process.env.SCENARIO==='failed'?'turn.failed':'turn.completed'}));
});`, { mode: 0o755 });
  const options = { env: { PANEL_CODEX_BIN: bin, CODEX_HOME: 'existing-login-home', WORKSPACE: process.cwd() }, readConfig: async () => ({plugins:{example:{enabled:true}}}), timeoutMs: 2000 };
  assert.equal(JSON.parse(await runCodexCliCorrection('请回复收告', '校对', options)).result, '{"text":"请回复收到"}');
  for (const SCENARIO of ['failed','tool']) await assert.rejects(runCodexCliCorrection('原文','校对',{...options,env:{...options.env,SCENARIO}}), /不完整/);
});

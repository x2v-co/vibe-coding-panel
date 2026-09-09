import test from 'node:test';
import assert from 'node:assert/strict';
import { speechFailure, agentFailure } from './user-errors.js';
import { readApiResponse, userError } from '../src/api.ts';
import { speechDiagnostics } from './runtime-info.js';

test('proxy HTML, oversized requests, rate limits and revoked pairing produce recovery guidance', async () => {
  await assert.rejects(readApiResponse(new Response('<html>private upstream error</html>', { status: 502 })), /连接服务.*网络/);
  await assert.rejects(readApiResponse(new Response('<html>login</html>')), /数据格式.*版本/);
  await assert.rejects(readApiResponse(new Response('too large', { status: 413 })), /7 MB/);
  await assert.rejects(readApiResponse(new Response('{}', { status: 429, headers: { 'Retry-After': '23' } })), /等待 23 秒/);
  await assert.rejects(readApiResponse(new Response('{"code":"PAIRING_REQUIRED"}', { status: 401 })), /新的配对码/);
  await assert.rejects(readApiResponse(new Response('{"code":"CONNECTOR_OFFLINE"}', { status: 503 })), /无需重新配对/);
  await assert.rejects(readApiResponse(new Response('{"error":"工作目录不存在"}', { status: 400 })), /工作目录不存在/);
  assert.deepEqual(await readApiResponse(new Response('{"ok":true}')), { ok: true });
  assert.match(userError(new TypeError('Failed to fetch')), /手机网络/);
  assert.doesNotMatch(userError(new Error('secret token stack trace')), /secret/);
});

test('speech failures distinguish installation, model download, memory, configuration and timeout without leaking raw details', () => {
  for (const [reason, code, guidance] of [
    [Object.assign(new Error('spawn /private/whisper ENOENT'), { code: 'ENOENT' }), 'WHISPER_MISSING', /Setup Voice/],
    [new Error('ModuleNotFoundError: No module named torch; /private/path'), 'SPEECH_DEPENDENCIES', /依赖/],
    [new Error('SSL certificate verify failed /private/path token=secret'), 'SPEECH_MODEL_DOWNLOAD', /网络/],
    [new Error('CUDA out of memory /private/path'), 'SPEECH_MEMORY', /内存/],
    [new Error('unrecognized arguments --model-path /private/path'), 'SPEECH_CONFIGURATION', /参数/],
    [new Error('timed out /private/path'), 'SPEECH_TIMEOUT', /缩短录音/],
  ]) {
    const error = speechFailure(reason);
    assert.equal(error.code, code); assert.match(error.message, guidance);
    assert.doesNotMatch(error.message, /private|secret/);
  }
});

test('agent failures separate computer CLI/login/quota/network problems from phone pairing', () => {
  assert.match(agentFailure({ code: 'ENOENT' }, 'claude'), /Claude Code.*安装/);
  assert.match(agentFailure(new Error('Authorization validation failed'), 'claude'), /Claude Code.*手机配对无需重做/);
  assert.match(agentFailure(new Error('usage_limit_reached')), /额度/);
  assert.match(agentFailure(new Error('ECONNREFUSED')), /先查看任务记录/);
  assert.match(agentFailure(new Error('unexpected argument --approve-for-me')), /版本/);
});

test('invalid optional speech configuration is reported without probing or blocking text diagnostics', async () => {
  const report = await speechDiagnostics({ PANEL_WHISPER_BACKEND: 'invalid' }, () => { throw new Error('must not probe'); });
  assert.equal(report.whisper.status, 'configuration');
  assert.match(report.guidance, /openai 或 mlx/);
});

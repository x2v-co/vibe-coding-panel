import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAgentInvocation, normalizeAgentProvider, parseAgentLine } from './agent-providers.js';

test('provider selection falls back to Codex and builds resumable Claude commands', () => {
  assert.equal(normalizeAgentProvider('claude'), 'claude');
  assert.equal(normalizeAgentProvider('unknown'), 'codex');
  const invocation = buildAgentInvocation('claude', {
    prompt: 'continue', cwd: '/tmp/project', threadId: 'session-123', resume: true,
  }, { PANEL_CLAUDE_BIN: '/opt/claude', PANEL_CLAUDE_PERMISSION_MODE: 'plan' });
  assert.equal(invocation.command, '/opt/claude');
  assert.equal(invocation.cwd, '/tmp/project');
  assert.deepEqual(invocation.args.slice(-4), ['--permission-mode', 'plan', '--resume', 'session-123']);
});

test('Claude stream-json becomes the common panel event format', () => {
  const job = { threadId: null, result: '', agentError: null };
  const events = [];
  const emit = (event) => events.push(event);
  parseAgentLine('claude', job, JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc' }), emit);
  parseAgentLine('claude', job, JSON.stringify({
    type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '完成' } },
  }), emit);
  parseAgentLine('claude', job, JSON.stringify({
    type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
  }), emit);
  assert.equal(job.threadId, 'abc');
  assert.equal(job.result, '完成');
  assert.deepEqual(events.map((event) => event.type), ['progress', 'message', 'tool']);
  assert.match(events[2].text, /npm test/);
});

test('Codex JSONL remains compatible with the common event format', () => {
  const job = { threadId: null, result: '', agentError: null };
  const events = [];
  parseAgentLine('codex', job, JSON.stringify({ type: 'thread.started', thread_id: 'thread-1' }), (event) => events.push(event));
  parseAgentLine('codex', job, JSON.stringify({ item: { type: 'agent_message', text: 'done' } }), (event) => events.push(event));
  assert.equal(job.threadId, 'thread-1');
  assert.equal(job.result, 'done');
  assert.deepEqual(events, [{ type: 'message', text: 'done' }]);
});

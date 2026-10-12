import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAgentLine } from './agent-providers.js';
import { pushJobEvent } from './job-events.js';

const newJob = () => ({ threadId: null, result: '', agentError: null, events: [], listeners: new Set(), revision: 0, sequence: 0 });
const line = (data) => JSON.stringify(data);
const delta = (text) => line({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });

function run(provider, lines) {
  const job = newJob();
  const seen = [];
  job.listeners.add((entry) => seen.push({ ...entry }));
  for (const l of lines) parseAgentLine(provider, job, l, (event) => pushJobEvent(job, event));
  return { job, seen };
}

test('Claude partial messages stream into one growing message (no a/ab/abc lines)', () => {
  const { job, seen } = run('claude', [
    line({ type: 'system', subtype: 'init', session_id: 's1' }),
    line({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1', content: [] } } }),
    line({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }),
    delta('a'), delta('b'), delta('c'), delta('d'),
    line({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'text', text: 'abcd' }] } }),
    line({ type: 'stream_event', event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'Bash', input: {} } } }),
    line({ type: 'assistant', message: { id: 'msg_1', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'ls' } }] } }),
    line({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_2', content: [] } } }),
    delta('do'), delta('ne'),
    line({ type: 'assistant', message: { id: 'msg_2', content: [{ type: 'text', text: 'done' }] } }),
    line({ type: 'result', subtype: 'success', is_error: false, result: 'done' }),
  ]);
  const messages = job.events.filter((e) => e.type === 'message');
  assert.deepEqual(messages.map((e) => e.text), ['abcd', 'done']);
  assert.ok(messages.every((e) => !('delta' in e)));
  // Every live update for the first bubble reuses one id and only grows.
  const first = seen.filter((e) => e.id === messages[0].id).map((e) => e.text);
  assert.deepEqual(first, ['a', 'ab', 'abc', 'abcd']);
  assert.equal(new Set(seen.filter((e) => e.type === 'message').map((e) => e.id)).size, 2);
  assert.equal(job.result, 'done');
  assert.equal(job.events.filter((e) => e.type === 'tool').length, 2);
});

test('Claude without partial messages still shows assistant snapshots and result once', () => {
  const { job } = run('claude', [
    line({ type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'hello' }] } }),
    line({ type: 'result', subtype: 'success', result: 'hello' }),
  ]);
  assert.deepEqual(job.events.map((e) => e.text), ['hello']);
  assert.equal(job.result, 'hello');
});

test('cumulative snapshots replace the current bubble; unrelated text starts a new one', () => {
  const job = newJob();
  for (const text of ['a', 'ab', 'abc']) pushJobEvent(job, { type: 'message', text });
  pushJobEvent(job, { type: 'message', text: 'other' });
  assert.deepEqual(job.events.map((e) => e.text), ['abc', 'other']);
});

test('Codex agent messages and app-server deltas are unaffected', () => {
  const { job } = run('codex', [
    line({ item: { type: 'agent_message', text: 'first' } }),
    line({ item: { type: 'command_execution', command: 'ls', status: 'completed' } }),
    line({ item: { type: 'agent_message', text: 'second' } }),
  ]);
  assert.deepEqual(job.events.filter((e) => e.type === 'message').map((e) => e.text), ['first', 'second']);
  const j2 = newJob();
  for (const t of ['he', 'llo']) pushJobEvent(j2, { type: 'message', text: t, delta: true });
  pushJobEvent(j2, { type: 'message', text: 'hello' });
  assert.deepEqual(j2.events.map((e) => e.text), ['hello']);
});

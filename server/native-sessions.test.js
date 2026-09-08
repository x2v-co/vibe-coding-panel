import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NativeSessions } from './native-sessions.js';

test('native sessions are filtered by canonical workspace for Codex and Claude', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vibe-native-sessions-')));
  const workspace = path.join(root, 'repo-with-dash');
  const other = path.join(root, 'other');
  const claudeRoot = path.join(root, '.claude');
  await mkdir(workspace, { recursive: true }); await mkdir(other, { recursive: true });
  const claudeProject = path.join(claudeRoot, 'projects', '-tmp-vibe-native-sessions-repo-with-dash');
  await mkdir(claudeProject, { recursive: true });
  const claudeId = '11111111-1111-4111-8111-111111111111';
  await writeFile(path.join(claudeProject, `${claudeId}.jsonl`), [
    JSON.stringify({ type: 'user', sessionId: claudeId, cwd: workspace, message: { role: 'user', content: '检查这个项目' }, timestamp: '2026-09-08T10:00:00Z' }),
    JSON.stringify({ type: 'assistant', sessionId: claudeId, cwd: workspace, message: { role: 'assistant', content: '已检查' }, timestamp: '2026-09-08T10:01:00Z' }),
  ].join('\n'));
  const codexId = '22222222-2222-4222-8222-222222222222';
  const fakeCodex = {
    async call(method, params) {
      if (method === 'thread/list') return { data: [
        { id: codexId, cwd: workspace, preview: 'Codex 检查', updatedAt: '2026-09-08T10:02:00Z', status: { type: 'notLoaded' } },
        { id: '33333333-3333-4333-8333-333333333333', cwd: other, preview: '不能显示', updatedAt: '2026-09-08T10:03:00Z', status: { type: 'notLoaded' } },
      ] };
      if (method === 'thread/read') return { thread: { id: codexId, cwd: workspace, preview: 'Codex 检查', updatedAt: '2026-09-08T10:02:00Z', status: { type: 'notLoaded' }, turns: [{ status: 'completed', startedAt: '2026-09-08T10:01:00Z', items: [{ type: 'userMessage', text: '检查这个项目' }, { type: 'agentMessage', text: '完成' }] }] } };
      throw new Error(`unexpected ${method}`);
    }, close() {},
  };
  try {
    const sessions = new NativeSessions({ env: { HOME: root, CLAUDE_HOME: claudeRoot }, codex: fakeCodex });
    const codex = await sessions.list('codex', workspace);
    assert.deepEqual(codex.sessions.map((s) => s.id), [codexId]);
    const claude = await sessions.list('claude', workspace);
    assert.deepEqual(claude.sessions.map((s) => s.id), [claudeId]);
    const detail = await sessions.read('claude', workspace, claudeId);
    assert.equal(detail.messages[0].text, '检查这个项目');
    assert.equal(detail.canResume, true);
    await mkdir(path.join(claudeRoot, 'sessions'));
    await writeFile(path.join(claudeRoot, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: claudeId }));
    assert.equal((await sessions.read('claude', workspace, claudeId)).canResume, false);
    await appendFile(path.join(claudeProject, `${claudeId}.jsonl`), '\n' + JSON.stringify({ type: 'assistant', sessionId: claudeId, cwd: workspace, message: { content: [{ type: 'text', text: '终端的新消息' }] } }) + '\n{"partial":');
    assert.equal((await sessions.read('claude', workspace, claudeId)).messages.at(-1).text, '终端的新消息');
    await assert.rejects(() => sessions.read('claude', other, claudeId), /找不到/);
    const codexDetail = await sessions.read('codex', workspace, codexId);
    assert.equal(codexDetail.messages.at(-1).text, '完成');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('native session ids cannot read another workspace', async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'vibe-native-sessions-')));
  const workspace = path.join(root, 'one'); const other = path.join(root, 'two');
  await mkdir(workspace); await mkdir(other);
  const id = '44444444-4444-4444-8444-444444444444';
  const fake = { async call() { return { thread: { id, cwd: workspace, turns: [], status: { type: 'notLoaded' } } }; }, close() {} };
  try { await assert.rejects(() => new NativeSessions({ codex: fake }).read('codex', other, id), /不属于当前 Workspace/); }
  finally { await rm(root, { recursive: true, force: true }); }
});

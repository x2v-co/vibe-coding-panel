import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, realpath, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { NativeSessions, verifiedAgentPid } from './native-sessions.js';

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

test('release validates workspace before any process signal', async () => {
  const root=await mkdtemp(path.join(tmpdir(),'vibe-release-scope-'));
  const one=path.join(root,'one'),two=path.join(root,'two');await mkdir(one);await mkdir(two);
  const id='44444444-4444-4444-8444-444444444444';
  const sessions=new NativeSessions({codex:{async call(){return {thread:{id,cwd:one,turns:[]}}},close(){}}});
  sessions.signalRelease=async()=>assert.fail('must not signal');
  try {await assert.rejects(sessions.release('codex',two,id),/不属于/);await assert.rejects(sessions.release('codex',one,'../../invalid'),/无效/);}
  finally {await rm(root,{recursive:true,force:true});}
});

test('a saved session is already released and receives no signal', async () => {
  const sessions=new NativeSessions({codex:{close(){}}});
  const session={canResume:true,id:'saved'};
  sessions.read=async()=>session;sessions.signalRelease=async()=>assert.fail('must not signal');
  assert.deepEqual(await sessions.release('codex','workspace','saved'),{released:true,state:'released',session});
});

test('release waits for observed ownership loss, or reports timeout without force killing', async () => {
  const sessions=new NativeSessions({codex:{close(){}}});let reads=0,signals=0;
  sessions.read=async()=>({canResume:++reads>=3});sessions.signalRelease=async()=>{signals++;return true;};
  if(process.platform==='win32') {
    await assert.rejects(sessions.release('codex','workspace','id'),/电脑终端/);assert.equal(signals,0);return;
  }
  assert.equal((await sessions.release('codex','workspace','id',{timeoutMs:100,pollMs:1})).state,'released');
  assert.equal(signals,1);assert.ok(reads>=3);
  sessions.read=async()=>({canResume:false});
  await assert.rejects(sessions.release('codex','workspace','id',{timeoutMs:5,pollMs:1}),e=>e.status===408&&e.state==='timeout');
  assert.equal(signals,2);
  sessions.signalRelease=async()=>false;
  await assert.rejects(sessions.release('claude','workspace','id'),e=>e.status===409);
});

test('Codex lock probe observes a live file handle and later release on this OS', async () => {
  const {open}=await import('node:fs/promises');
  const root=await mkdtemp(path.join(tmpdir(),"vibe lock O'Brien $probe "));
  const id='55555555-5555-4555-8555-555555555555';
  await mkdir(path.join(root,'thread-writer-locks'));
  const sessions=new NativeSessions({env:{CODEX_HOME:root},codex:{close(){}}});
  const lock=path.join(root,'thread-writer-locks',id+'.lock');
  // Windows PowerShell startup can exceed a single probe's deadline under CI
  // load. Unknown ownership correctly stays occupied; recovery is eventual.
  const released=async()=>{
    const deadline=Date.now()+15000;
    while(await sessions.attached('codex',id)) {
      assert(Date.now()<deadline,'closed lock must become available within 15 seconds');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  };
  let file;
  try {
    assert.equal(await sessions.attached('codex',id),false);
    await writeFile(lock,'');
    await released(); // Exercise the actual probe, not the missing-file shortcut.
    file=await open(lock,'r+');
    assert.equal(await sessions.attached('codex',id),true);
    await file.close();file=null;
    await released();
  } finally {await file?.close();await rm(root,{recursive:true,force:true});}
});

test('stale Claude session metadata cannot signal an unrelated live process', async () => {
  const {spawn}=await import('node:child_process');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
  const root=await mkdtemp(path.join(tmpdir(),'vibe-stale-pid-'));
  const id='66666666-6666-4666-8666-666666666666';
  try {
    await mkdir(path.join(root,'sessions'));
    await writeFile(path.join(root,'sessions',child.pid+'.json'),JSON.stringify({pid:child.pid,sessionId:id}));
    const sessions=new NativeSessions({env:{CLAUDE_CONFIG_DIR:root},codex:{close(){}}});
    assert.equal(await sessions.signalRelease('claude',id),false);
    assert.equal(child.exitCode,null);
    process.kill(child.pid,0);
  } finally {child.kill();await new Promise(resolve=>child.once('close',resolve));await rm(root,{recursive:true,force:true});}
});


test('Linux Claude identity uses exact kernel start ticks and rejects stale metadata', { skip: process.platform !== 'linux' }, async () => {
  const { fork } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-linux-identity-'));
  const script = path.join(root, 'owner.cjs');
  await writeFile(script, "process.title = 'claude'; process.send('ready'); setInterval(() => {}, 1000);");
  const child = fork(script, [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  try {
    await new Promise((resolve, reject) => { child.once('message', resolve); child.once('error', reject); });
    const raw = await readFile(`/proc/${child.pid}/stat`, 'utf8');
    const ticks = raw.slice(raw.lastIndexOf(')') + 1).trim().split(/\s+/)[19];
    assert.equal(await verifiedAgentPid(child.pid, 'claude', Date.now(), ticks), true);
    assert.equal(await verifiedAgentPid(child.pid, 'claude', Date.now(), String(BigInt(ticks) + 1n)), false);
    assert.equal(await verifiedAgentPid(child.pid, 'claude', 0, ticks), false);
    assert.equal(await verifiedAgentPid(child.pid, 'claude', Date.now(), 'Thu Sep 10 00:00:00 2026'), false);
    assert.equal(child.exitCode, null, 'identity checks must never signal the process');
  } finally {
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill(); await closed;
    await rm(root, { recursive: true, force: true });
  }
});


test('incomplete live Claude metadata blocks resume until ownership is readable', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vibe-partial-owner-'));
  const id = '77777777-7777-4777-8777-777777777777';
  const dir = path.join(root, 'sessions');
  const sessions = new NativeSessions({ env: { CLAUDE_CONFIG_DIR: root }, codex: { close() {} } });
  try {
    await mkdir(dir);
    const file = path.join(dir, `${process.pid}.json`);
    for (const partial of ['', '{"pid":', '{}', '{"pid":1,"sessionId":"invalid"}']) {
      await writeFile(file, partial);
      assert.equal(await sessions.attached('claude', id), true, `live incomplete metadata: ${partial}`);
    }
    await writeFile(file, JSON.stringify({ pid: process.pid, sessionId: '88888888-8888-4888-8888-888888888888' }));
    assert.equal(await sessions.attached('claude', id), false, 'valid unrelated owner must not block this session');
    await writeFile(file, JSON.stringify({ pid: process.pid, sessionId: id }));
    assert.equal(await sessions.attached('claude', id), true);
    await rm(file);
    assert.equal(await sessions.attached('claude', id), false);
    await writeFile(file, '{');
    const dead = new NativeSessions({ env: { CLAUDE_CONFIG_DIR: root }, codex: { close() {} }, alive: () => false });
    assert.equal(await dead.attached('claude', id), false, 'dead incomplete metadata must not block recovery');
    await rm(dir, { recursive: true });
    await writeFile(dir, 'invalid directory');
    assert.equal(await sessions.attached('claude', id), true, 'uninspectable ownership directory must fail closed');
    await rm(dir);
    assert.equal(await sessions.attached('claude', id), false, 'missing directory is an unused Claude installation');
  } finally { await rm(root, { recursive: true, force: true }); }
});

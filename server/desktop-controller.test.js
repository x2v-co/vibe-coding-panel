import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DesktopController, desktopControllerRouter } from './desktop-controller.js';

function fixture(driver) {
  const calls = [];
  const controller = new DesktopController({ title: 'test', driver: async request => {
    calls.push(request);
    return driver ? driver(request) : request.action === 'inspect' ? { fingerprint: '1:2', text: '' } : { dispatched: request.action === 'send' };
  } });
  return { controller, calls };
}
test('confirmed submission retains same binding for another turn without replaying Send', async () => {
  const { controller: c, calls } = fixture(r => ({ fingerprint: '1:2', text: '', dispatched: r.action === 'send', composerCleared: r.action === 'send' }));
  const { bindingId } = await c.bind();
  await c.command({ bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'first' });
  const send = { bindingId, eventId: 'send-0001', revision: 1, action: 'send' };
  const result = await c.command(send);
  assert.equal(result.bound, true); assert.equal(result.revision, 2); assert.equal(result.hasDraft, false);
  assert.deepEqual(await c.command(send), result);
  await c.command({ bindingId, eventId: 'write-002', revision: 2, action: 'write', text: 'second' });
  const second = await c.command({ bindingId, eventId: 'send-0002', revision: 3, action: 'send' });
  assert.equal(second.bindingId, bindingId); assert.equal(second.revision, 4);
  assert.equal(calls.filter(r => r.action === 'send').length, 2);
});
test('Send replay is idempotent even after binding is revoked', async () => {
  const { controller: c, calls } = fixture();
  const { bindingId } = await c.bind();
  await c.command({ bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'hello' });
  const send = { bindingId, eventId: 'send-0001', revision: 1, action: 'send' };
  const result = await c.command(send);
  assert.equal(result.bound, false); assert.equal(result.dispatched, true);
  assert.deepEqual(await c.command(send), result);
  assert.equal(calls.filter(r => r.action === 'send').length, 1);
  await assert.rejects(c.command({ ...send, eventId: 'send-0002' }), /失效/);
});
test('stale revisions and event-ID collisions cannot overwrite newer drafts', async () => {
  const { controller: c, calls } = fixture(); const { bindingId } = await c.bind();
  const write = { bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'one' };
  await c.command(write);
  await assert.rejects(c.command({ ...write, eventId: 'write-002' }), /版本已失效/);
  await assert.rejects(c.command({ ...write, text: 'two' }), /其他指令/);
  assert.equal(calls.length, 2);
});
test('uncertain dispatch invalidates binding and never retries native Send', async () => {
  const { controller: c, calls } = fixture(async r => {
    if (r.action === 'send') throw new Error('timeout after dispatch');
    return { fingerprint: '1:2', text: '' };
  });
  const { bindingId } = await c.bind();
  await c.command({ bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'hello' });
  const send = { bindingId, eventId: 'send-0001', revision: 1, action: 'send' };
  await assert.rejects(c.command(send), /timeout/);
  await assert.rejects(c.command(send), /timeout/);
  assert.equal(c.status().bound, false); assert.equal(calls.filter(r => r.action === 'send').length, 1);
});
test('busy controller rejects simultaneous commands instead of queuing', async () => {
  let release; const { controller: c } = fixture(async r => {
    if (r.action === 'write') await new Promise(resolve => { release = resolve; });
    return { fingerprint: '1:2', text: '' };
  });
  const { bindingId } = await c.bind();
  const first = c.command({ bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'one' });
  await assert.rejects(c.command({ bindingId, eventId: 'write-002', revision: 0, action: 'write', text: 'two' }), /上一条/);
  release(); await first;
});
test('nonempty desktop draft prevents binding', async () => {
  const { controller: c } = fixture(() => ({ fingerprint: '1:2', text: 'user draft' }));
  await assert.rejects(c.bind(), /清空/); assert.equal(c.status().bound, false);
});
test('desktop edits invalidate binding; empty revisions are not reported as drafts', async () => {
  let edited = false;
  const { controller: c } = fixture(r => {
    if (edited) throw new Error('desktop draft changed');
    return { fingerprint: '1:2', text: '' };
  });
  const { bindingId } = await c.bind();
  await c.command({ bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'hello' });
  const cleared = await c.command({ bindingId, eventId: 'write-002', revision: 1, action: 'write', text: '' });
  assert.equal(cleared.hasDraft, false); assert.equal(cleared.busy, false);
  edited = true;
  await assert.rejects(c.command({ bindingId, eventId: 'write-003', revision: 2, action: 'write', text: 'new' }), /desktop draft changed/);
  assert.equal(c.status().bound, false);
});
test('remote requests require pairing, remote binding is denied, form posts cannot mutate', async t => {
  const { controller, calls } = fixture(); const app = express(); app.use(express.json());
  app.use(desktopControllerRouter({ controller, authenticate: async req => req.headers.cookie === 'paired=yes' }));
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const remote = { 'x-forwarded-for': '192.0.2.1', 'content-type': 'application/json' };
  const shell = await fetch(url + '/view', { headers: remote });
  assert.equal(shell.status, 200);
  assert.match(await shell.text(), /id="pairing"/);
  assert.equal((await fetch(url + '/status', { headers: remote })).status, 401);
  assert.equal((await fetch(url + '/command', { method: 'POST', headers: remote, body: '{}' })).status, 401);
  assert.equal((await fetch(url + '/bind', { method: 'POST', headers: { ...remote, cookie: 'paired=yes' }, body: '{}' })).status, 403);
  assert.equal((await fetch(url + '/command', { method: 'POST', headers: { cookie: 'paired=yes', 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(url + '/status', { headers: { ...remote, cookie: 'paired=yes' } })).status, 200);
  assert.equal(calls.length, 0);
});

test('pre-mutation target refusal preserves binding and draft for explicit retry only', async () => {
  let away = false;
  const { controller: c, calls } = fixture(r => {
    if (r.action !== 'inspect' && away) throw Object.assign(new Error('switch back'), { code: 'target_unavailable' });
    return { fingerprint: '1:2', text: '', composerCleared: true };
  });
  const { bindingId } = await c.bind();
  await c.command({ bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'kept' });
  away = true;
  const send = { bindingId, eventId: 'send-0001', revision: 1, action: 'send' };
  await assert.rejects(c.command(send), /switch back/);
  assert.equal(c.status().bindingId, bindingId); assert.equal(c.status().hasDraft, true);
  away = false;
  await assert.rejects(c.command(send), /switch back/); // replay still cannot dispatch
  assert.equal(calls.filter(r => r.action === 'send').length, 1);
  const result = await c.command({ ...send, eventId: 'send-0002' });
  assert.equal(result.bound, true); assert.equal(result.revision, 2);
});

test('explicit local adoption keeps the existing draft as the write precondition', async () => {
  const { controller: c, calls } = fixture(r => ({ fingerprint: '1:2', text: 'existing draft' }));
  const state = await c.bind({ adoptDraft: true });
  assert.equal(state.hasDraft, true);
  await c.command({ bindingId: state.bindingId, eventId: 'write-001', revision: 0, action: 'write', text: 'edited' });
  assert.equal(calls[1].expectedText, 'existing draft');
});

test('local current-session binding uses inspected title and invalidates old target events',async()=>{
 let selected='工作任务';
 const {controller:c,calls}=fixture(r=>({title:r.title || selected,text:'',fingerprint:'pid:'+selected}));
 const first=await c.bind({current:true,adoptDraft:true});
 assert.equal(first.title,'工作任务');assert.equal(calls[0].title,'');
 selected='另一工作任务';const second=await c.bind({current:true,adoptDraft:true});
 assert.equal(second.title,selected);
 await assert.rejects(c.command({bindingId:first.bindingId,eventId:'old-target-01',revision:0,action:'write',text:'old'}),/失效/);
 await c.command({bindingId:second.bindingId,eventId:'new-target-01',revision:0,action:'write',text:'new'});
 assert.equal(calls.at(-1).title,selected);
});

test('append combines desktop draft atomically and replay never duplicates a segment',async()=>{
 const {controller:c,calls}=fixture(()=>({fingerprint:'1:2',text:'原有草稿'}));
 const {bindingId}=await c.bind({adoptDraft:true});
 const first={bindingId,eventId:'segment-0001',revision:0,action:'append',text:'第一段'};
 const result=await c.command(first);assert.equal(result.hasDraft,true);
 assert.equal(calls.at(-1).action,'write');assert.equal(calls.at(-1).expectedText,'原有草稿');assert.equal(calls.at(-1).text,'原有草稿\n第一段');
 await c.command(first);assert.equal(calls.length,2);
 await c.command({...first,eventId:'segment-0002',revision:1,text:'第二段'});
 assert.equal(calls.at(-1).expectedText,'原有草稿\n第一段');assert.equal(calls.at(-1).text,'原有草稿\n第一段\n第二段');
 await assert.rejects(c.command({...first,eventId:'segment-0003'}),/失效/);
});
test('append rejects combined draft overflow before native mutation',async()=>{
 const {controller:c,calls}=fixture(()=>({fingerprint:'1:2',text:'a'.repeat(15999)}));
 const {bindingId}=await c.bind({adoptDraft:true});
 await assert.rejects(c.command({bindingId,eventId:'segment-0001',revision:0,action:'append',text:'中文'}),/长度限制/);
 assert.equal(calls.length,1);assert.equal(c.status().bound,true);
});

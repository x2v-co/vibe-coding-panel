import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';
import { ManagedClaude } from './managed-claude.js';
import { DesktopController, desktopControllerRouter } from './desktop-controller.js';

async function fixture(options = {}) {
  const writes = [], processes = [];
  const managed = new ManagedClaude({ ...options, spawnImpl: (bin,args,options) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new Writable({ write(data,_encoding,done) { writes.push(JSON.parse(data)); done(); } });
    child.kill = () => { child.killed = true; };
    processes.push({bin,args,options,child}); return child;
  } });
  await managed.start(tmpdir());
  const controller = new DesktopController({title:'',provider:'claude',target:'claude-code',driver:r=>managed.driver(r)});
  await controller.bind({current:true,adoptDraft:true});
  let seq = 0;
  const command = (action,text) => controller.command({...controller.status(),eventId:`event-${String(++seq).padStart(8,'0')}`,action,text});
  return {managed,controller,command,writes,processes};
}
test('an idle managed session restores its draft and resumes the same Claude session ID',async()=>{
  const f=await fixture();await f.command('append','保留的草稿');
  const old=f.managed.snapshot();f.managed.stop(old.id);
  await f.managed.restore(old);
  assert.equal(f.managed.snapshot().text,'保留的草稿');assert.equal(f.managed.snapshot().id,old.id);
  await f.controller.bind({adoptDraft:true,current:true});await f.command('send');
  assert.ok(f.processes[0].args.includes('--resume'));assert.ok(!f.processes[0].args.includes('--session-id'));
  f.managed.close();
  await assert.rejects(f.managed.restore({...old,running:true}),/无法恢复/);
});

test('phone segments share one computer draft; only Send starts Claude and all turns use one process',async()=>{
  const f=await fixture();
  await f.command('append','第一段');await f.command('append','第二段');
  assert.equal(f.managed.snapshot().text,'第一段\n第二段');assert.equal(f.processes.length,0);
  const send={...f.controller.status(),action:'send',eventId:'send-once-0001'};
  await f.controller.command(send);await f.controller.command(send);
  assert.equal(f.writes.length,1);assert.equal(f.writes[0].message.content,'第一段\n第二段');
  assert.equal(f.managed.snapshot().text,'');
  await f.command('append','下一轮');
  await assert.rejects(f.command('send'),/上一轮/);assert.equal(f.writes.length,1);
  f.managed.receive(f.managed.session,{type:'result',is_error:false});await f.command('send');
  assert.equal(f.processes.length,1);assert.equal(f.writes.length,2);
  assert.equal(f.writes[0].session_id,f.writes[1].session_id);
  assert.equal(f.processes[0].args.includes('--dangerously-skip-permissions'),false);
  f.managed.close();
});

test('stale edits, replaced targets and duplicate permissions cannot mutate the new session',async()=>{
  const f=await fixture();const stale={...f.controller.status(),action:'write',text:'stale',eventId:'stale-edit-0001'};
  await f.command('append','新草稿');await assert.rejects(f.controller.command(stale),/失效/);
  await f.command('send');const old=f.managed.session;
  f.managed.receive(old,{type:'control_request',request_id:'permission-1',request:{subtype:'can_use_tool',tool_name:'Bash',input:{command:'echo hello'}}});
  f.managed.permission(old.id,'permission-1',false);
  assert.equal(f.writes.at(-1).response.response.behavior,'deny');
  await assert.rejects(async()=>f.managed.permission(old.id,'permission-1',true),/失效/);
  f.managed.stop(old.id);await f.managed.start(tmpdir());
  f.managed.receive(old,{type:'assistant',message:{content:[{type:'text',text:'late old output'}]}});
  assert.equal(f.managed.snapshot().output,'');
  await assert.rejects(f.command('append','旧手机录音'),/目标会话已变化/);
  assert.equal(f.managed.snapshot().text,'');f.managed.close();
});

test('process failure closes the target without replaying input or erasing a following draft',async()=>{
  const f=await fixture();await f.command('append','发送');await f.command('send');await f.command('append','保留');
  f.processes[0].child.emit('error',new Error('fixture'));
  assert.equal(f.managed.snapshot().active,false);assert.equal(f.managed.snapshot().text,'保留');
  await assert.rejects(f.command('send'),/启动/);assert.equal(f.writes.length,1);
});

test('only the computer can read output, start/stop sessions or approve tools',async t=>{
  const f=await fixture(),app=express();app.use(express.json());
  app.use(desktopControllerRouter({controller:f.controller,managed:f.managed,authenticate:async()=>true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  t.after(()=>{f.managed.close();server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const route of ['view','state','start','stop','permission','recover']) {
    const response=await fetch(base+'/managed/'+route,{method:['view','state'].includes(route)?'GET':'POST',headers:{'x-forwarded-for':'192.0.2.1','Content-Type':'application/json'},...(!['view','state'].includes(route)?{body:'{}'}:{})});
    assert.equal(response.status,403);
  }
  const phone=await fetch(base+'/status',{headers:{'x-forwarded-for':'192.0.2.1'}}).then(r=>r.json());
  assert.equal(phone.provider,'claude');assert.equal(phone.output,undefined);assert.equal(phone.text,undefined);
  assert.equal((await fetch(base+'/managed/view')).status,200);
  assert.equal((await fetch(base+'/managed/state')).status,200);
});

async function statePath(t) { const directory=await mkdtemp(path.join(tmpdir(),'vibe-recovery-'));t.after(()=>rm(directory,{recursive:true,force:true}));return path.join(directory,'managed.json'); }
test('durable unsent drafts restore without launching a CLI or inventing existing history',async t=>{
 const file=await statePath(t),f=await fixture({stateFile:file});await f.command('append','尚未发送');
 const original=f.managed.snapshot();f.managed.close();let launched=0;
 const restored=new ManagedClaude({stateFile:file,spawnImpl:()=>{launched++;throw new Error('unexpected launch');}});
 assert.equal(await restored.restoreSaved(),true);assert.equal(restored.snapshot().id,original.id);
 assert.equal(restored.snapshot().text,'尚未发送');assert.equal(restored.session.resume,false);assert.equal(launched,0);
 // Windows uses inherited ACLs; POSIX mode bits do not describe its access control.
 if (process.platform !== 'win32') assert.equal((await stat(file)).mode & 0o777,0o600);
});
test('an interrupted submitted turn restores only the next draft and requires local acknowledgement',async t=>{
 const file=await statePath(t),f=await fixture({stateFile:file});await f.command('append','已发出的任务');await f.command('send');await f.command('append','下一条草稿');
 const saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.text,'下一条草稿');assert.equal(saved.lastSubmission,'已发出的任务');assert.equal(saved.running,true);
 const restored=new ManagedClaude({stateFile:file});await restored.restoreSaved();
 assert.equal(restored.snapshot().recoveryRequired,true);assert.equal(restored.snapshot().text,'下一条草稿');
 await assert.rejects(restored.driver({action:'send',fingerprint:saved.id,expectedText:'下一条草稿'}),/核对/);
 restored.recover(saved.id);assert.equal(restored.snapshot().recoveryRequired,false);assert.equal(restored.session.resume,true);
 assert.equal(f.writes.length,1);f.managed.close();
});
test('completed turns clear interrupted submission markers and explicit stop stays stopped',async t=>{
 const file=await statePath(t),f=await fixture({stateFile:file});await f.command('append','完成任务');await f.command('send');
 f.managed.receive(f.managed.session,{type:'result',is_error:false});
 let saved=JSON.parse(await readFile(file,'utf8'));assert.equal(saved.running,false);assert.equal(saved.lastSubmission,'');
 f.managed.stop(saved.id);const restored=new ManagedClaude({stateFile:file});await restored.restoreSaved();assert.equal(restored.snapshot().active,false);
});
test('recovery refuses a still-live previous process and a stale session ID',async t=>{
 const file=await statePath(t),f=await fixture({stateFile:file});f.managed.session.previousPid=process.pid;f.managed.checkpoint();
 const restored=new ManagedClaude({stateFile:file});await restored.restoreSaved();
 assert.throws(()=>restored.recover('stale'),/变化/);assert.throws(()=>restored.recover(restored.snapshot().id),/仍在运行/);
 assert.equal(restored.snapshot().recoveryRequired,true);f.managed.close();
});
test('failed durable draft writes keep the original draft and never launch a child',async t=>{
 const file=await statePath(t),f=await fixture({stateFile:file});await f.command('append','原草稿');
 f.managed.stateFile=path.dirname(file);await assert.rejects(f.command('append','不能保存'));
 assert.equal(f.managed.snapshot().text,'原草稿');assert.equal(f.processes.length,0);
});

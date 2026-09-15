import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { ControllerHub } from './controller-hub.js';
import { DesktopController,desktopControllerRouter } from './desktop-controller.js';

function fixture() {
  const drafts = {'codex-app':'原有 Codex 草稿','claude-app':'原有 Claude 草稿'};
  const calls=[];
  const controllers=Object.fromEntries(Object.keys(drafts).map(target=>[target,new DesktopController({title:target,target,provider:target==='codex-app'?'codex':'claude',driver:async r=>{
    calls.push([target,r.action]);
    if(r.action==='inspect')return {title:target,fingerprint:target,text:drafts[target]};
    assert.equal(r.expectedText,drafts[target]);drafts[target]=r.text;return {};
  }})]));
  return {hub:new ControllerHub(controllers),drafts,calls};
}
test('switching requires a fresh binding, keeps both computer drafts, and cannot replay old input',async()=>{
  const {hub,drafts,calls}=fixture();const old=await hub.bind({adoptDraft:true});
  const command={...old,action:'append',text:'旧录音',eventId:'old-input-0001'};
  hub.select('claude-app');assert.equal(hub.status().bound,false);assert.equal(hub.provider,'claude');
  assert.throws(()=>hub.command(command),/目标或绑定已变化/);
  assert.deepEqual(drafts,{'codex-app':'原有 Codex 草稿','claude-app':'原有 Claude 草稿'});
  await hub.bind({adoptDraft:true});hub.select('codex-app');assert.equal(hub.status().bound,false);
  const current=await hub.bind({adoptDraft:true});assert.notEqual(current.bindingId,old.bindingId);
  assert.throws(()=>hub.command(command),/已变化/);assert.ok(calls.every(([,action])=>action==='inspect'));
});
test('selection cannot race an in-flight desktop write',async()=>{
  let release;
  const one=new DesktopController({title:'one',driver:async r=>{if(r.action==='inspect')return {fingerprint:'one',text:''};await new Promise(r=>{release=r;});return {};}});
  const hub=new ControllerHub({'codex-app':one,'claude-app':new DesktopController({title:'two'})});
  const old=await hub.bind();const writing=hub.command({...old,action:'append',text:'一段',eventId:'write-flight-0001'});
  assert.throws(()=>hub.select('claude-app'),/稍候切换/);release();await writing;hub.select('claude-app');
});
test('one paired phone can use status across targets, but cannot choose a target',async t=>{
  const {hub}=fixture(),app=express();app.use(express.json());app.use(desktopControllerRouter({controller:hub,authenticate:async r=>r.headers.cookie==='paired=yes'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`,remote={'x-forwarded-for':'192.0.2.1',cookie:'paired=yes','Content-Type':'application/json'};
  assert.equal((await fetch(base+'/target',{method:'POST',headers:remote,body:'{"target":"claude-app"}'})).status,403);
  assert.equal((await fetch(base+'/targets',{headers:remote})).status,403);
  assert.equal((await fetch(base+'/status',{headers:remote})).status,200);
  const switched=await fetch(base+'/target',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"target":"claude-app"}'});
  assert.equal(switched.status,200);
  const status=await fetch(base+'/status',{headers:remote}).then(r=>r.json());assert.equal(status.provider,'claude');assert.equal(status.unified,true);
});

test('automatic binding discovers a sole available app without modifying drafts',async()=>{
  const {hub,drafts,calls}=fixture();
  hub.controllers['claude-app'].driver=async()=>{throw new Error('not open');};
  await hub.bind({auto:true});
  assert.equal(hub.status().target,'codex-app');assert.equal(hub.status().bound,true);
  assert.equal(hub.binding.text,drafts['codex-app']);
  assert.ok(calls.every(([,action])=>action==='inspect'));
});
test('ambiguous discovery preserves the existing binding and requires a choice',async()=>{
  const {hub}=fixture();await hub.bind({adoptDraft:true,current:true});const binding=hub.binding;
  await assert.rejects(hub.bind({auto:true}),/多个/);assert.equal(hub.binding,binding);
  hub.select('claude-app');await hub.bind({auto:true});assert.equal(hub.activeTarget,'claude-app');
});
test('discovery excludes concurrent switching and commands',async()=>{
  const {hub}=fixture();let release;
  hub.controllers['codex-app'].driver=()=>new Promise(resolve=>{release=()=>resolve({title:'Codex',text:'',fingerprint:'one'});});
  const pending=hub.bind({auto:true});
  assert.throws(()=>hub.select('claude-app'),/稍候/);assert.throws(()=>hub.command({}),/识别/);
  release();await assert.rejects(pending,/多个/);assert.equal(hub.busy,false);
});
test('foreground app wins over a remembered target',async()=>{
  const {hub}=fixture();hub.select('claude-app');
  hub.controllers['codex-app'].driver=async()=>({title:'Codex',text:'keep',fingerprint:'one',foreground:true});
  await hub.bind({auto:true});assert.equal(hub.activeTarget,'codex-app');assert.equal(hub.binding.text,'keep');
});
test('remembered target survives restart without restoring a stale binding',async t=>{
  const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');
  const dir=await mkdtemp(tmpdir()+'/controller-target-');t.after(()=>rm(dir,{recursive:true,force:true}));
  const {hub}=fixture();const saved=new ControllerHub(hub.controllers,'codex-app',dir+'/target.json');
  saved.select('claude-app');
  const restored=new ControllerHub(fixture().hub.controllers,'codex-app',dir+'/target.json');
  assert.equal(restored.activeTarget,'claude-app');assert.equal(restored.status().bound,false);
  await restored.bind({auto:true});assert.equal(restored.activeTarget,'claude-app');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { DesktopController, desktopControllerRouter } from './desktop-controller.js';

async function fixture(t, correctTranscript, recognition = {text:'请回复收告',candidateText:''}) {
 const controller=new DesktopController({title:'test',driver:async()=>({fingerprint:'test',text:''})});
 const binding=await controller.bind();
 const app=express();app.use(express.json());
 app.use(desktopControllerRouter({controller,authenticate:async()=>false,liveSpeech:{transcribe:async()=>({...recognition})},correctTranscript}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const post=body=>fetch(`http://127.0.0.1:${server.address().port}/speech`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({bindingId:binding.bindingId,pcm:'fixture',...body})});
 return {controller,post};
}
test('only final recognition uses ordinary correction; no desktop mutation occurs',async t=>{
 const calls=[];
 const f=await fixture(t,async(text,options)=>{calls.push({text,options});return '请回复收到';});
 assert.equal((await(await f.post({final:false})).json()).text,'请回复收告');
 assert.equal(calls.length,0);
 assert.equal((await(await f.post({final:true})).json()).text,'请回复收到');
 assert.equal(calls.length,1);assert.ok(calls[0].options.timeoutMs<=50000);
 assert.equal(f.controller.status().revision,0);
});
test('correction keeps low-confidence candidates under manual review',async t=>{
 const f=await fixture(t,async()=> '请回复收到',{text:'',candidateText:'请回复收告'});
 const result=await(await f.post({final:true})).json();
 assert.equal(result.text,'');assert.equal(result.candidateText,'请回复收到');
});
test('correction failure retains original, and silence does not invoke correction',async t=>{
 const f=await fixture(t,async()=>{throw new Error('provider failure');});
 assert.equal((await(await f.post({final:true})).json()).text,'请回复收告');
 let calls=0;const silent=await fixture(t,async()=>{calls++;return 'invented';},{text:'',candidateText:''});
 assert.equal((await(await silent.post({final:true})).json()).text,'');assert.equal(calls,0);
});
test('rebind during correction rejects the late result',async t=>{
 let entered,finish;
 const started=new Promise(resolve=>{entered=resolve;});
 const f=await fixture(t,async()=>{entered();return await new Promise(resolve=>{finish=resolve;});});
 const pending=f.post({final:true});await started;await f.controller.bind();finish('请回复收到');
 assert.equal((await pending).status,409);assert.equal(f.controller.status().hasDraft,false);
});

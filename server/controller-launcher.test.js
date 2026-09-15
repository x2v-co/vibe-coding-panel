import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
async function fixture(t, payload, status = 200) {
  let requests = 0;
  const server = http.createServer((req,res) => { requests++; res.writeHead(status, {'content-type':'application/json'});res.end(JSON.stringify(payload)); });
  server.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  return {port:server.address().port,requests:()=>requests};
}
test('launcher reuses an existing controller without requiring CLI or speech installation', {skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t,{enabled:true,bound:true,title:'正在使用'});
 const result=await exec(process.execPath,['scripts/controller.mjs'],{env:{...process.env,PANEL_CONTROLLER_HUB_CONFIG:"/nonexistent-vibe-hub-profile",PANEL_API_PORT:String(f.port),PANEL_LIVE_PYTHON:'/missing-python'},timeout:5000});
 assert.match(result.stdout,/复用现有服务/);assert.equal(f.requests(),1);
});
test('launcher refuses an occupied non-controller port instead of replacing it', {skip:process.platform!=='darwin'},async t=>{
 const f=await fixture(t,{error:'other app'},404);
 await assert.rejects(exec(process.execPath,['scripts/controller.mjs'],{env:{...process.env,PANEL_CONTROLLER_HUB_CONFIG:"/nonexistent-vibe-hub-profile",PANEL_API_PORT:String(f.port)},timeout:5000}),e=>/已由其他服务使用/.test(e.stderr));
 assert.equal(f.requests(),1);
});
test('Claude launcher reuses only a matching target and reports its desktop console',async t=>{
 const f=await fixture(t,{enabled:true,bound:false,target:'claude-code'});
 const result=await exec(process.execPath,['scripts/controller.mjs','--claude'],{env:{...process.env,PANEL_CONTROLLER_HUB_CONFIG:"/nonexistent-vibe-hub-profile",PANEL_API_PORT:String(f.port)},timeout:5000});
 assert.match(result.stdout,/managed\/view/);
 const wrong=await fixture(t,{enabled:true,bound:true,target:'codex-app'});
 await assert.rejects(exec(process.execPath,['scripts/controller.mjs','--claude'],{env:{...process.env,PANEL_CONTROLLER_HUB_CONFIG:"/nonexistent-vibe-hub-profile",PANEL_API_PORT:String(wrong.port)},timeout:5000}),e=>/另一种外设/.test(e.stderr));
});

test('fresh launcher starts API and Relay without CLI login and shuts down its API child', {skip:process.platform!=='darwin',timeout:15000},async t=>{
 const {createRelayServer}=await import('./relay.js');
 const {mkdtemp,readFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {spawn}=await import('node:child_process');
 const path=await import('node:path');
 const dir=await mkdtemp(path.join(tmpdir(),'vibe-controller-launch-'));
 const relay=createRelayServer();relay.server.listen(0,'127.0.0.1');await new Promise(resolve=>relay.server.once('listening',resolve));
 const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await new Promise(resolve=>reservation.once('listening',resolve));
 const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 const child=spawn(process.execPath,['scripts/controller.mjs','--text-only'],{env:{...process.env,PANEL_CONTROLLER_HUB_CONFIG:"/nonexistent-vibe-hub-profile",PATH:'',PANEL_API_PORT:String(port),PANEL_DESKTOP_THREAD:'',PANEL_RELAY_URL:`http://127.0.0.1:${relay.server.address().port}`,PANEL_RELAY_PUBLIC_URL:'',PANEL_DEVICE_STORE:path.join(dir,'devices.json'),PANEL_RELAY_STATE:path.join(dir,'relay.json')},stdio:'ignore'});
 const exit=new Promise(resolve=>child.once('exit',resolve));
 t.after(async()=>{
  child.kill('SIGTERM');await exit;
  for(const ws of relay.connectors.values())ws.terminate();
  relay.server.closeAllConnections();await new Promise(resolve=>relay.server.close(resolve));
  await rm(dir,{recursive:true,force:true});
 });
 const until=Date.now()+10000;let status;
 while(Date.now()<until){
  try{status=await(await fetch(`http://127.0.0.1:${port}/api/desktop-controller/status`,{signal:AbortSignal.timeout(300)})).json();if(status.enabled&&relay.connectors.size)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.equal(status?.enabled,true);assert.equal(status.title,'');assert.equal(status.bound,false);
 const {connectorId}=JSON.parse(await readFile(path.join(dir,'relay.json'),'utf8'));
 const view=await fetch(`http://127.0.0.1:${relay.server.address().port}/api/desktop-controller/view`,{headers:{cookie:`vibe_relay_connector=${connectorId}`}});
 assert.equal(view.status,200);assert.match(await view.text(),/绑定当前 Codex 会话/);
 const relayBase=`http://127.0.0.1:${relay.server.address().port}`;
 const selector=`vibe_relay_connector=${connectorId}`;
 assert.equal((await fetch(relayBase+'/api/desktop-controller/status',{headers:{cookie:selector}})).status,401);
 const code=await fetch(`http://127.0.0.1:${port}/api/pairing-codes`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json());
 const paired=await fetch(relayBase+'/api/pair',{method:'POST',headers:{cookie:selector,'Content-Type':'application/json'},body:JSON.stringify({code:code.code,deviceName:'Fresh install acceptance'})});
 assert.equal(paired.status,201);
 const cookie=[selector,...paired.headers.getSetCookie().map(value=>value.split(';')[0])].join('; ');
 const phone=await fetch(relayBase+'/api/desktop-controller/status',{headers:{cookie}}).then(r=>r.json());
 assert.equal(phone.enabled,true);assert.equal(phone.local,false);assert.equal(phone.bound,false);
 child.kill('SIGTERM');await exit;
 await assert.rejects(fetch(`http://127.0.0.1:${port}/api/desktop-controller/status`,{signal:AbortSignal.timeout(500)}));
});

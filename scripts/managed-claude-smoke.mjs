// Real CLI, isolated workspace/config and local fixture only; no external model requests.
import http from 'node:http';
import {mkdtemp,rm,writeFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {ManagedClaude} from '../server/managed-claude.js';
import assert from 'node:assert/strict';
const dir=await mkdtemp(path.join(tmpdir(),'managed-claude-smoke-'));
await writeFile(path.join(dir,'settings.json'),JSON.stringify({permissions:{defaultMode:'manual'}}));
const deniedFile=path.join(dir,'must-not-exist.txt');
let requests=0;
const server=http.createServer(async(req,res)=>{
 let body='';for await(const chunk of req)body+=chunk;
 if(req.url.includes('count_tokens')){res.setHeader('content-type','application/json');return res.end(JSON.stringify({input_tokens:30}));}
 if(!req.url.includes('/messages')){res.writeHead(404);return res.end('{}');}
 requests++;
 const text='MOCK_REPLY_'+requests;
 const msg={id:'msg_fixture_'+requests,type:'message',role:'assistant',model:'fixture',content:[{type:'text',text}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:30,output_tokens:10}};
 if(requests===3){msg.content=[{type:'tool_use',id:'tool_fixture',name:'Write',input:{file_path:deniedFile,content:'denied'}}];msg.stop_reason='tool_use';}
 if(JSON.parse(body).stream){
 res.writeHead(200,{'content-type':'text/event-stream'});
 const event=(type,value)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...value})}\n\n`);
 event('message_start',{message:{...msg,content:[],stop_reason:null}});
 event('content_block_start',{index:0,content_block:requests===3?{...msg.content[0],input:{}}:{type:'text',text:''}});
 event('content_block_delta',{index:0,delta:requests===3?{type:'input_json_delta',partial_json:JSON.stringify(msg.content[0].input)}:{type:'text_delta',text}});
 event('content_block_stop',{index:0});event('message_delta',{delta:{stop_reason:msg.stop_reason,stop_sequence:null},usage:{output_tokens:10}});event('message_stop',{});res.end();
 }else {res.setHeader('content-type','application/json');res.end(JSON.stringify(msg));}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const managed=new ManagedClaude({env:{...process.env,CLAUDE_CONFIG_DIR:dir,ANTHROPIC_BASE_URL:`http://127.0.0.1:${server.address().port}`,ANTHROPIC_API_KEY:'fixture-key',ANTHROPIC_AUTH_TOKEN:'',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}});
try{
 await managed.start(dir);
 for(const text of ['只回复收到，不调用工具。','第二轮，只回复收到，不调用工具。']){
  const s=managed.session;
  await managed.driver({action:'write',fingerprint:s.id,expectedText:s.text,text});
  await managed.driver({action:'send',fingerprint:s.id,expectedText:text});
  const until=Date.now()+25000;
  while(managed.snapshot().running&&Date.now()<until)await new Promise(r=>setTimeout(r,100));
  assert.equal(managed.snapshot().error, '');
  assert.match(managed.snapshot().output, new RegExp('MOCK_REPLY_'+requests));
  if(managed.snapshot().running||!managed.snapshot().active)throw new Error('CLI did not complete');
 }
 assert.equal(requests,2);
 assert.ok(managed.session.child.pid);
 const archived=managed.snapshot();
 const exited=new Promise(resolve=>managed.session.child.once('exit',resolve));
 managed.stop(archived.id);await exited;await managed.restore(archived);
 assert.equal(managed.session.id,archived.id);
 const s=managed.session;
 await managed.driver({action:'write',fingerprint:s.id,expectedText:'',text:'请求写入测试文件，由电脑拒绝授权。'});
 await managed.driver({action:'send',fingerprint:s.id,expectedText:s.text});
 let denied=false;const until=Date.now()+25000;
 while(managed.snapshot().running&&Date.now()<until){
  for(const request of managed.snapshot().permissions){managed.permission(s.id,request.id,false);denied=true;}
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(denied,true);assert.equal(managed.snapshot().running,false);
 await assert.rejects(access(deniedFile));
 console.log('Claude Code actual CLI: multi-turn input, session restoration and computer permission denial passed against the local fixture.');
}finally{managed.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}

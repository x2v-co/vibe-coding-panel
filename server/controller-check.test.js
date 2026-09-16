import test from 'node:test';
import assert from 'node:assert/strict';
import {checkController} from '../scripts/controller-check.mjs';
test('fresh App diagnostics report missing installation without running an agent or asking for permission',()=>{
 const calls=[];const rows=checkController({target:'codex-app',platform:'darwin',node:'22.12.0',exists:()=>false,run:(bin,args)=>{calls.push([bin,args]);return {status:1};}});
 assert.ok(rows.some(row=>row.name==='目标 App'&&row.ready===false));
 assert.ok(rows.some(row=>row.name==='辅助功能权限'&&row.ready===null));
 assert.equal(calls.length,2);assert.equal(calls[0][0],'/usr/bin/xcrun');assert.equal(calls[1][0],'/usr/bin/mdfind');
});
test('Claude diagnostics distinguish installation from login and do not expose auth output',()=>{
 const calls=[];const rows=checkController({target:'claude-code',platform:'linux',node:'22.12.0',env:{},run:(bin,args)=>{calls.push(args);return {status:0,stdout:args[0]==='auth'?'{"loggedIn":false,"token":"DO_NOT_PRINT"}':'Claude Code'};}});
 assert.ok(rows.some(row=>row.name==='Claude Code'&&row.ready));
 assert.ok(rows.some(row=>row.name==='Claude Code 登录'&&row.ready===false));
 assert.equal(JSON.stringify(rows).includes('DO_NOT_PRINT'),false);
 assert.deepEqual(calls,[['--version'],['auth','status']]);
});

test('App diagnostics recognize bundle identifiers even when the application is renamed',()=>{
 const rows=checkController({target:'codex-app',platform:'darwin',node:'26.0.0',exists:p=>p==='/Applications/ChatGPT.app',run:bin=>({status:0,stdout:bin.endsWith('mdfind')?'/Applications/ChatGPT.app\n':'/usr/bin/swift'})});
 assert.ok(rows.find(row=>row.name==='目标 App').ready);
});

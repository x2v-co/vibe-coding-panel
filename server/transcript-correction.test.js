import test from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptCorrector, correctionArgs, parseCorrection, runCorrection, runCorrectionApi, correctionConfig } from './transcript-correction.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const result = text => JSON.stringify({ result: JSON.stringify({ text }) });

test('correction returns a draft, never executes the transcript', async () => {
  const original = '请支回复四个字，连接正常';
  const correct = createTranscriptCorrector({ env: {}, run: async input => {
    assert.equal(input, original); return result('请只回复四个字，连接正常。');
  } });
  assert.equal(await correct(original), '请只回复四个字，连接正常。');
  const args = correctionArgs({});
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--strict-mcp-config'));
  assert.ok(args.includes('--disable-slash-commands'));
  assert.ok(args.includes('--no-session-persistence'));
  assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), { disableAllHooks: true });
});

test('invalid, empty, truncated, error or overly rewritten output preserves original', async () => {
  const original = '请支回复四个字，连接正常';
  for (const output of ['not json', '{}', result(''), result('连接正常'), result('重复'.repeat(100)), JSON.stringify({is_error:true,result:'{}'})]) {
    const correct = createTranscriptCorrector({ env: {}, run: async () => output });
    assert.equal(await correct(original), original);
  }
  const unavailable = createTranscriptCorrector({ env: {}, run: async () => { throw new Error('timeout'); } });
  assert.equal(await unavailable(original), original);
});

test('protects code, paths, URLs, English identifiers and numbers including order/count', () => {
  const original = '打开 /tmp/app.ts，把 port 从 8811 改成 8812，运行 `npm test`，访问 https://example.com。';
  assert.equal(parseCorrection(result(original), original), original);
  for (const changed of [original.replace('app.ts','app.js'), original.replace('8811','8812'), original.replace('npm test','rm -rf /'), original.replace('example.com','evil.test'), original.replace('8811 改成 8812','8812 改成 8811')]) {
    assert.throws(() => parseCorrection(result(changed), original), /protected/);
  }
});

test('concurrent requests fall back without spawning another model and recover after failure', async () => {
  let finish; let count=0;
  const correct = createTranscriptCorrector({ env: {}, run: () => { count++; return new Promise(resolve => {finish=resolve;}); } });
  const first=correct('第一句');
  assert.equal(await correct('第二句'),'第二句'); assert.equal(count,1);
  finish('invalid'); assert.equal(await first,'第一句');
  const third=correct('第三句'); finish(result('第三句。')); assert.equal(await third,'第三句。');
});

test('disabled, blank and oversized inputs skip model calls', async () => {
  const run=async()=>assert.fail('must not run');
  assert.equal(await createTranscriptCorrector({env:{PANEL_TRANSCRIPT_CORRECTION:'off'},run})('原文'),'原文');
  for (const input of ['', ' ', '字'.repeat(3001)]) assert.equal(await createTranscriptCorrector({env:{},run})(input),input);
});

test('text API sends transcript as data only and ignores private reasoning', async () => {
  const original='请支回复四个字';
  const output=await runCorrectionApi(original,{url:'https://example.test/v1/messages',token:'fixture',model:'fixture'}, {fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    assert.equal(JSON.parse(body.messages[0].content).transcript,original);
    assert.equal(body.tools,undefined); assert.equal(options.redirect,'error');
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'thinking',thinking:'private'},{type:'text',text:JSON.stringify({text:'请只回复四个字'})}]}));
  }});
  assert.equal(parseCorrection(output,original),'请只回复四个字'); assert.ok(!output.includes('private'));
});

test('API errors, token-limit stops, oversized responses and tool attempts are rejected', async () => {
  const config={url:'https://example.test',token:'fixture',model:'fixture'};
  for (const response of [new Response('',{status:429}), new Response('x'.repeat(65537)), new Response(JSON.stringify({stop_reason:'max_tokens',content:[]})), new Response(JSON.stringify({stop_reason:'end_turn',content:[{type:'tool_use'}]}))]) {
    await assert.rejects(runCorrectionApi('原文',config,{fetchImpl:async()=>response}));
  }
});

test('missing executable falls back and API credentials need no CLI process', async () => {
  await assert.rejects(runCorrection('原文',{env:{PANEL_CLAUDE_BIN:path.join(tmpdir(),'vibe-nonexistent-executable')},timeoutMs:1000}));
  const dir=await mkdtemp(path.join(tmpdir(),'vibe-config-test-'));
  try {
    assert.equal(await correctionConfig({CLAUDE_CONFIG_DIR:dir}),null);
    const config=await correctionConfig({CLAUDE_CONFIG_DIR:dir,ANTHROPIC_API_KEY:'fixture',PANEL_CORRECTION_MODEL:'selected'});
    assert.equal(config.model,'selected');assert.equal(config.bearer,false);
    await assert.rejects(correctionConfig({CLAUDE_CONFIG_DIR:dir,ANTHROPIC_API_KEY:'fixture',ANTHROPIC_BASE_URL:'http://remote.test'}));
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('provider timeout aborts a stalled response body and returns the original draft', async () => {
  const { createServer } = await import('node:http');
  const server=createServer((req,res)=> { res.writeHead(200,{'content-type':'application/json'}); res.write('{'); });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const config={url:`http://127.0.0.1:${server.address().port}`,token:'fixture',model:'fixture'};
    const correct=createTranscriptCorrector({env:{},run:text=>runCorrectionApi(text,config,{timeoutMs:100})});
    assert.equal(await correct('请支回复四个字'),'请支回复四个字');
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); }
});

test('slow transcription leaves a bounded correction budget or skips it', async () => {
  let budget;
  const correct=createTranscriptCorrector({env:{},run:async(text,options)=>{budget=options.timeoutMs;return result(text);}});
  assert.equal(await correct('原文',{timeoutMs:50}),'原文');assert.equal(budget,50);
  assert.equal(await correct('原文',{timeoutMs:60000}),'原文');assert.equal(budget,25000);
  budget=null;assert.equal(await correct('原文',{timeoutMs:0}),'原文');assert.equal(budget,null);
});

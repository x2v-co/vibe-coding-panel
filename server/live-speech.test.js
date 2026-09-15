import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { LiveSpeech } from './live-speech.js';

function fixture() {
  const child = new EventEmitter();
  child.stdout = new PassThrough(); child.stdin = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('exit', 1)); };
  const service = new LiveSpeech({ spawnProcess: () => child }); service.start();
  const emit = value => child.stdout.write(JSON.stringify(value) + '\n');
  return { service, child, emit };
}
const pcm = Buffer.alloc(32000).toString('base64');
test('warm worker rejects invalid input, waits for readiness and serializes requests', async t => {
  const f = fixture(); t.after(() => f.service.close());
  assert.throws(() => f.service.transcribe(pcm), /正在加载/);
  f.emit({ ready: true }); assert.equal(f.service.status().ready, true);
  assert.throws(() => f.service.transcribe('invalid!'), /格式/);
  const result = f.service.transcribe(pcm);
  assert.throws(() => f.service.transcribe(pcm), /忙/);
  f.emit({ id: 99, text: 'wrong response' }); assert.equal(f.service.status().busy, true);
  f.emit({ id: 1, text: '你好', inferenceMs: 42, speechEnded: true, diagnostics: null });
  assert.deepEqual(await result, { text: '你好', candidateText: '', inferenceMs: 42, speechEnded: true, diagnostics: null });
  assert.equal(f.service.status().busy, false);
});
test('worker exit rejects pending recognition and cannot return stale output', async t => {
  const f = fixture(); t.after(() => f.service.close()); f.emit({ ready: true });
  const pending = f.service.transcribe(pcm); f.child.emit('exit', 1);
  await assert.rejects(pending, /已退出/);
  assert.equal(f.service.status().ready, false);
  assert.throws(() => f.service.transcribe(pcm), /已退出/);
});

test('status exposes bounded stage diagnostics without retaining text or audio', async t => {
  const f = fixture(); t.after(() => f.service.close()); f.emit({ready:true});
  const pending = f.service.transcribe(pcm);
  f.emit({id:1,text:'',diagnostics:{reason:'filtered',audioMs:5000,speechMs:4000,rmsDb:-65,text:'private',pcm:'private'}});
  const result = await pending;
  assert.deepEqual(result.diagnostics,{reason:'filtered',audioMs:5000,speechMs:4000,rmsDb:-65});
  assert.deepEqual(f.service.status().lastDiagnostics,result.diagnostics);
  assert.equal(JSON.stringify(f.service.status()).includes('private'),false);
});

test('review candidate reaches caller but is not retained in diagnostic status', async t => {
 const f=fixture();t.after(()=>f.service.close());f.emit({ready:true});
 const result=f.service.transcribe(pcm);
 f.emit({id:1,text:'',candidateText:'完整的待确认文字',diagnostics:{reason:'filtered',audioMs:1000,speechMs:800,rmsDb:-44}});
 assert.equal((await result).candidateText,'完整的待确认文字');
 assert.equal(JSON.stringify(f.service.status()).includes('完整'),false);
});

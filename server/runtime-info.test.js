import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { releaseInfo, speechDiagnostics, cachedDiagnostics, probeCommand } from './runtime-info.js';

test('portable revision wins and source archives do not inherit an unrelated parent Git version', async () => {
  const directory=await mkdtemp(path.join(tmpdir(),'vibe-version-'));
  try {
    await writeFile(path.join(directory,'package.json'),'{"version":"0.1.0"}');
    assert.deepEqual(releaseInfo(directory),{version:'0.1.0',revision:null,distribution:'source'});
    const revision='a'.repeat(40);
    await writeFile(path.join(directory,'bundle.json'),JSON.stringify({version:revision}));
    assert.deepEqual(releaseInfo(directory),{version:'0.1.0',revision,distribution:'portable'});
    await writeFile(path.join(directory,'bundle.json'),'{"version":"invalid"}');
    assert.equal(releaseInfo(directory).revision,null);
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('speech diagnostics expose bounded versions/status, never raw errors or paths', async () => {
  const info=await speechDiagnostics({PANEL_WHISPER_BACKEND:'mlx',PANEL_WHISPER_BIN:'custom-whisper',PANEL_FFMPEG_BIN:'custom-ffmpeg'},async(command,args)=>{
    if(command==='custom-whisper')return {status:'timeout',output:'secret'};
    if(command==='custom-ffmpeg')return {status:'ok',output:'ffmpeg version 7.1-static build details'};
    assert.fail('unexpected command');
  });
  assert.equal(info.backend,'mlx');assert.equal(info.whisper.status,'timeout');
  assert.equal(info.ffmpeg.version,'7.1-static');assert.equal(info.whisper.version,null);
  assert.ok(!JSON.stringify(info).includes('secret'));
  assert.ok(!JSON.stringify(info).includes('custom-ffmpeg'));
});

test('missing optional speech components do not throw and disabled correction is reported',async()=>{
  const info=await speechDiagnostics({PANEL_TRANSCRIPT_CORRECTION:'off'},async()=>({status:'missing',output:''}));
  assert.equal(info.whisper.status,'missing');assert.equal(info.ffmpeg.status,'missing');assert.equal(info.correction,'off');
});

test('concurrent diagnostic requests share a probe; failures can be retried',async()=>{
  let finish,count=0;
  const collect=cachedDiagnostics(()=>{count++;return new Promise(resolve=>{finish=resolve})});
  const first=collect(),second=collect();await Promise.resolve();finish({ok:true});
  assert.deepEqual(await first,{ok:true});assert.deepEqual(await second,{ok:true});
  await collect();assert.equal(count,1);
  let attempts=0;const retry=cachedDiagnostics(async()=>{if(++attempts===1)throw Error('unavailable');return {ok:true}});
  await assert.rejects(retry());assert.deepEqual(await retry(),{ok:true});
});

test('command probe handles missing executables and terminates stalled probes',async()=>{
  assert.equal((await probeCommand(path.join(tmpdir(),'vibe-no-such-binary'),[],process.env,100)).status,'missing');
  assert.equal((await probeCommand(process.execPath,['-e','setInterval(()=>{},1000)'],process.env,100)).status,'timeout');
});

test('diagnostics use the same Python ffmpeg fallback as the Connector', async()=>{
  const info=await speechDiagnostics({PANEL_PYTHON_BIN:'fixture-python'},async(command,args)=>{
    if(command==='fixture-python')return {status:'ok',output:'/fixture/ffmpeg'};
    if(command==='/fixture/ffmpeg')return {status:'ok',output:'ffmpeg version 7.1 fixture'};
    return {status:'missing',output:''};
  });
  assert.equal(info.ffmpeg.status,'ok');assert.equal(info.ffmpeg.version,'7.1');
});

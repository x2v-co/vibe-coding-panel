import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../public/controller.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const settle = () => new Promise(resolve => setImmediate(resolve));
const binding = id => ({ enabled:true, title:'test', bound:true, bindingId:id, revision:0, hasDraft:false, busy:false });
test('target changes preserve pending text and require explicit review before sending',async()=>{
  const h=harness();await settle();
  h.$('text').value='尚未提交的片段';h.$('text').oninput();
  h.setBinding({...binding('new-target'),target:'claude-app'});await h.tickPoll();
  assert.equal(h.$('text').value,'尚未提交的片段');assert.equal(h.$('send').disabled,true);
  assert.match(h.$('status').textContent,/核对/);
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
});
test('phone displays target changes even when both targets are unbound',async()=>{
  const h=harness({initial:{...binding(null),bound:false,target:'codex-app'}});await settle();
  h.setBinding({...binding(null),bound:false,target:'claude-app'});await h.tickPoll();
  assert.equal(h.$('target-kind').textContent,'Claude App');assert.equal(h.$('mic').disabled,true);
});
function harness({ storage = new Map(), preferences = new Map(), initial = binding('old'), startOffline = false, hangStatus = false, delayMicrophone = false, requirePair = false } = {}) {
  const elements = new Map(), details = { open:false }, calls = [], intervals = [], handlers = {}, timers = new Map(); let timerId = 0, resolveMicrophone, stoppedTracks = 0;
  const $ = id => { if(id==='fragment-details')return details; if (!elements.has(id)) elements.set(id, { value:'', textContent:'', hidden:false, attributes:{}, showModal(){this.open=true;}, close(){this.open=false;}, focus(){}, setAttribute(name,value){this.attributes[name]=value;}, classList:{toggle(){} } }); return elements.get(id); };
  $('pairing').hidden = true;
  let paired = !requirePair;
  let commandError = false, offline = startOffline;
  let current = initial, resolveTranscript, resolveLive, micCalls = 0, active;
  class Capture { async start() {} snapshot() { return { samples: 16000, pcm: 'test-pcm' }; } stop() {} }
  class Recorder {
    static isTypeSupported() { return true; }
    constructor() { active = this; this.mimeType='audio/webm'; }
    start() { this.state='recording'; }
    stop() { this.state='inactive'; this.ondataavailable?.({data:new Blob(['audio'])}); this.onstop?.(); }
  }
  class Reader { readAsDataURL() { this.result='data:audio/webm;base64,YQ=='; this.onload(); } }
  const context = vm.createContext({ AbortController, localStorage: { getItem:k=>preferences.get(k) ?? null,setItem:(k,v)=>preferences.set(k,v) }, sessionStorage: { getItem:k=>storage.get(k) ?? null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k) }, document:{getElementById:$, querySelector:()=>details, hidden:false},
    window:{MediaRecorder:Recorder,LiveCapture:Capture,addEventListener:(name, fn)=>{handlers[name]=fn;}}, MediaRecorder:Recorder, FileReader:Reader, Blob,
    crypto:{randomUUID:()=> 'event-0001'}, setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;}, clearTimeout(id){timers.delete(id);}, clearInterval(){}, setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},
    navigator:{mediaDevices:{getUserMedia:async()=>{micCalls++;const value={getTracks:()=>[{stop(){stoppedTracks++;}}]};if(delayMicrophone)return new Promise(resolve=>{resolveMicrophone=()=>resolve(value);});return value;}}},
    fetch:async(path, options)=>{
      calls.push({path,body:options?.body && JSON.parse(options.body)});
      if(path.endsWith('/speech/status')) return {ok:true,json:async()=>({enabled:true,ready:true})};
      if(path.endsWith('/speech')) return new Promise(resolve=>{resolveLive=(text,speechEnded=false,diagnostics=null,candidateText='')=>resolve({ok:true,json:async()=>({text,speechEnded,diagnostics,candidateText})});});
      if(path.endsWith('/status') && hangStatus) return new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('aborted'),{name:'AbortError'})));});
      if(path.endsWith('/status') && offline) throw new TypeError('网络暂时不可用');
      if(path === '/api/pair') { if (JSON.parse(options.body).code !== 'GOODCODE') return {ok:false,status:400,json:async()=>({error:'配对码无效'})}; paired=true;return {ok:true,json:async()=>({ok:true})}; }
      if(path.endsWith('/status') && !paired) return {ok:false,status:401,json:async()=>({error:'未配对'})};
      if(path.endsWith('/status')) return {ok:true,json:async()=>({...current})};
      if(path.endsWith('/transcriptions')) return new Promise(resolve=>{ resolveTranscript=(text='保留这段识别文字',ok=true)=>resolve({ok,status:ok?200:503,json:async()=>ok?{text}:{error:'识别失败'}}); });
      if(path.endsWith('/command')) { if(commandError) return {ok:false,status:409,json:async()=>({error:'请切回目标会话，无需重新绑定'})}; current={...current,revision:current.revision+1,hasDraft:true}; return {ok:true,json:async()=>({...current})}; }
      throw new Error('Unexpected path '+path);
    }
  });
  vm.runInContext(script,context);
  return { $,calls,details,storage, timeoutStatus:()=>[...timers.values()].find(t=>t.ms===8000).fn(), allowMicrophone:()=>resolveMicrophone(), stoppedTracks:()=>stoppedTracks,setBinding:value=>{current=value;},micCalls:()=>micCalls,stop:()=>active.stop(),transcribe:(text,ok)=>resolveTranscript(text,ok),tickLive:()=>intervals.find(x=>x.ms===3000).fn(),tickPoll:()=>intervals.find(x=>x.ms===5000).fn(),resolveLive:(text,ended,diagnostics,candidate)=>resolveLive(text,ended,diagnostics,candidate),failCommand:value=>{commandError=value;},hide:()=>handlers.pagehide(),resume:()=>handlers.pageshow(),online:()=>handlers.online(),setOffline:value=>{offline=value;},visibility:value=>{context.document.hidden=value;handlers.visibilitychange();} };
}
test('live partial and final revisions update one binding without automatically sending',async()=>{
  const h=harness();await settle();h.$('live').checked=true;await h.$('mic').onclick();
  h.tickLive();await settle();h.resolveLive('第一段');await settle();await settle();
  const stopping=h.$('mic').onclick();await settle();h.resolveLive('第一段修订');await stopping;
  const commands=h.calls.filter(x=>x.path.endsWith('/command')).map(x=>x.body);
  assert.deepEqual(h.calls.filter(x=>x.path.endsWith('/speech')).map(x=>x.body.final),[false,true]);
  assert.equal(commands.length,2);assert.deepEqual(commands.map(x=>x.revision),[0,1]);
  assert.ok(commands.every(x=>x.action==='write'&&x.bindingId==='old'));
  assert.equal(h.$('text').value,'第一段修订');assert.equal(h.$('send').disabled,false);
});
test('leaving during live recognition prevents a late transcript from writing',async()=>{
  const h=harness();await settle();h.$('live').checked=true;await h.$('mic').onclick();
  h.tickLive();await settle();h.hide();h.resolveLive('迟到结果');await settle();await settle();
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
});
test('recording refreshes an old phone binding before microphone capture',async()=>{
  const h=harness(); await settle(); h.setBinding(binding('new'));
  await h.$('mic').onclick(); assert.equal(h.micCalls(),1);
  h.stop(); await settle(); h.transcribe(); await settle(); await settle();
  const writes=h.calls.filter(r=>r.path.endsWith('/command'));
  assert.equal(writes.length,1); assert.equal(writes[0].body.bindingId,'new');
  assert.equal(h.$('text').value,''); assert.equal(h.details.open,false);
});
test('rebind during recognition retains text without writing into the new binding',async()=>{
  const h=harness(); await settle(); await h.$('mic').onclick(); h.stop(); await settle();
  h.setBinding(binding('replacement')); h.transcribe(); await settle(); await settle();
  assert.equal(h.calls.filter(r=>r.path.endsWith('/command')).length,0);
  assert.equal(h.$('text').value,'保留这段识别文字'); assert.equal(h.details.open,true);
  assert.match(h.$('error').textContent,/已保留/);
});
test('missing binding is discovered before microphone permission is requested',async()=>{
  const h=harness();await settle();h.setBinding({...binding('old'),bound:false,bindingId:null});
  await h.$('mic').onclick();assert.equal(h.micCalls(),0);
  assert.match(h.$('error').textContent,/先在电脑绑定/);
});

test('VAD end stops capture and finishes recognition without sending',async()=>{
  const h=harness();await settle();h.$('live').checked=true;await h.$('mic').onclick();
  h.tickLive();await settle();h.resolveLive('有效人声',true);await settle();await settle();
  assert.equal(h.$('mic').disabled,true);
  h.resolveLive('有效人声',true);await settle();await settle();
  assert.equal(h.$('mic').ariaLabel,'开始录音');assert.equal(h.$('send').disabled,false);
  assert.equal(h.calls.filter(x=>x.body?.action==='send').length,0);
});
test('failed partial write preserves text; explicit Send writes it before sending',async()=>{
  const h=harness();await settle();h.$('live').checked=true;await h.$('mic').onclick();
  h.failCommand(true);h.tickLive();await settle();h.resolveLive('尚未写入的文字');await settle();await settle();
  assert.equal(h.$('text').value,'尚未写入的文字');assert.equal(h.$('send').disabled,false);
  assert.equal(h.calls.filter(x=>x.body?.action==='send').length,0);
  h.failCommand(false);await h.$('send').onclick();
  const actions=h.calls.filter(x=>x.path.endsWith('/command')).map(x=>x.body.action);
  assert.deepEqual(actions,['write','write','send']);
});

test('empty final recognition explains which stage rejected audio',async()=>{
  for (const [reason,message] of [['no_signal',/没有声音/],['no_speech',/未检测到人声/],['filtered',/可信度不足/]]) {
    const h=harness();await settle();h.$('live').checked=true;await h.$('mic').onclick();
    const stopping=h.$('mic').onclick();await settle();h.resolveLive('',false,{reason});await stopping;
    assert.match(h.$('status').textContent,message);
    assert.equal(h.$('send').disabled,true);
    assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
  }
});

test('uncertain transcript remains editable and requires confirmation before desktop write',async()=>{
 const h=harness();await settle();h.$('live').checked=true;await h.$('mic').onclick();
 const stopping=h.$('mic').onclick();await settle();
 h.resolveLive('',false,{reason:'filtered'},'不要修改文件');await stopping;
 assert.equal(h.$('text').value,'不要修改文件');assert.equal(h.$('text').readOnly,false);
 assert.equal(h.$('send').disabled,true);assert.equal(h.$('write').textContent,'确认文字并写入电脑');
 await h.$('send').onclick();assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
 h.$('text').value='请不要修改文件';h.$('text').oninput();await h.$('write').onclick();
 assert.equal(h.$('send').disabled,false);
 assert.deepEqual(h.calls.filter(x=>x.path.endsWith('/command')).map(x=>x.body.text),['请不要修改文件']);
});

test('phone reload restores unsent text for review without writing or sending',async()=>{
 const storage=new Map();const first=harness({storage});await settle();
 first.$('text').value='保留未发内容';first.$('text').oninput();
 const reloaded=harness({storage,initial:binding('different-target')});await settle();
 assert.equal(reloaded.$('text').value,'保留未发内容');assert.equal(reloaded.$('send').disabled,true);
 assert.equal(reloaded.calls.filter(x=>x.path.endsWith('/command')).length,0);
 await reloaded.$('write').onclick();await reloaded.$('send').onclick();
 assert.equal(storage.size,0);assert.equal(reloaded.$('text').value,'');
});
test('desktop-only controls stay hidden on a paired phone',async()=>{
 const phone=harness({initial:{...binding('phone'),local:false}});await settle();
 assert.equal(phone.$('desktop-controls').hidden,true);
 const desktop=harness({initial:{...binding('desktop'),local:true}});await settle();
 assert.equal(desktop.$('desktop-controls').hidden,false);
 desktop.$('text').value='test';await desktop.$('write').onclick();
 assert.equal(desktop.$('desktop-controls').hidden,false);
});

test('ordinary segments append separately while the complete draft stays on desktop',async()=>{
 const h=harness({initial:{...binding('old'),hasDraft:true}});await settle();
 for(const text of ['第一段','第二段']){
  await h.$('mic').onclick();h.stop();await settle();h.transcribe(text);await settle();await settle();
  assert.equal(h.$('text').value,'');assert.equal(h.details.open,false);
  assert.equal(h.$('mic').disabled,false);assert.equal(h.$('send').disabled,false);
 }
 const calls=h.calls.filter(x=>x.path.endsWith('/command')).map(x=>x.body);
 assert.deepEqual(calls.map(x=>[x.action,x.text,x.revision]),[['append','第一段',0],['append','第二段',1]]);
 assert.equal(h.storage.size,0);
});
test('failed ordinary transcription can retry the same recording without opening microphone again',async()=>{
 const h=harness();await settle();await h.$('mic').onclick();h.stop();await settle();h.transcribe('',false);await settle();await settle();
 assert.equal(h.$('retry').hidden,false);
 const retry=h.$('retry').onclick();await settle();h.transcribe('重试成功');await retry;
 assert.equal(h.micCalls(),1);assert.equal(h.calls.filter(x=>x.body?.action==='append').length,1);assert.equal(h.$('retry').hidden,true);
});
test('ordinary recognition finishing after page exit never appends',async()=>{
 const h=harness();await settle();await h.$('mic').onclick();h.stop();await settle();h.hide();h.transcribe('迟到结果');await settle();await settle();
 assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
});

test('input templates persist without changing pending text, binding or recording', async () => {
  const preferences = new Map();
  const h = harness({ preferences }); await settle();
  h.$('text').value = '保留手机待处理片段'; h.$('text').oninput();
  const before = h.calls.length;
  h.$('template-micro').onclick();
  assert.equal(h.$('template-micro').ariaPressed, 'true');
  assert.equal(h.$('text').value, '保留手机待处理片段');
  assert.equal(h.calls.length, before);
  const restored = harness({ preferences }); await settle();
  assert.equal(restored.$('template-micro').ariaPressed, 'true');
  await restored.$('mic').onclick();
  const recordingCalls = restored.calls.length;
  restored.$('template-bar').onclick();
  assert.equal(restored.$('template-bar').ariaPressed, 'true');
  assert.equal(restored.$('mic').ariaLabel, '结束录音并识别');
  assert.equal(restored.calls.length, recordingCalls);
  assert.equal(restored.calls.filter(x => x.path.endsWith('/command')).length, 0);
});

test('unsupported main-branch keys never write, send, clear or change the binding', async () => {
  const h = harness(); await settle();
  h.$('text').value = '保留草稿'; h.$('text').oninput();
  const before = h.calls.length;
  for (const id of ['micro-quick','micro-approve','micro-decline','micro-fork','bar-stop','bar-capture','joystick-center']) {
    h.$(id).onclick();
    assert.match(h.$('error').textContent, /尚未支持/);
    assert.equal(h.$('text').value, '保留草稿');
    assert.equal(h.calls.length, before);
  }
});

test('all eight layouts and appearance sheets preserve the pending fragment without sending', async () => {
  const preferences = new Map(); const h = harness({preferences}); await settle();
  h.$('text').value = '不要丢失的补充'; h.$('text').oninput();
  const before = h.calls.length;
  for (const id of ['console','bar','matrix','hardware-tri','hardware-vibebar','hardware-five','hardware-aha','micro']) {
    h.$('open-settings').onclick();
    h.$('template-'+id).onclick();
    assert.equal(preferences.get('vibe-controller-template'),id);
    assert.equal(h.$('template-'+id).ariaPressed,'true');
    h.$('theme-ice').onclick(); h.$('close-settings').onclick();
    h.$('open-text').onclick(); assert.equal(h.$('text-sheet').open,true);
    h.$('close-text').onclick(); assert.equal(h.$('text-sheet').open,false);
    assert.equal(h.$('text').value,'不要丢失的补充');
    assert.equal(h.calls.length,before);
  }
});
test('TriKey voice-approve submits a ready draft only after the key is pressed', async () => {
  const h = harness({initial:{...binding('old'),hasDraft:true}}); await settle();
  h.$('template-hardware-tri').onclick();
  assert.equal(h.$('mic').ariaLabel,'发送电脑草稿');
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
  await h.$('mic').onclick();
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,1);
  assert.equal(h.calls.find(x=>x.path.endsWith('/command')).body.action,'send');
  assert.equal(h.micCalls(),0);
});

test('a saved Micro shortcut appends once to the bound computer draft without sending', async () => {
  const preferences = new Map(); const h = harness({preferences}); await settle();
  h.$('edit-quick').onclick(); h.$('command-action').value='prompt'; h.$('command-prompt').value='检查当前改动，先不要修改文件。'; h.$('save-command').onclick();
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
  const restored = harness({preferences}); await settle();
  assert.equal(restored.$('label-quick').textContent,'快捷指令');
  await restored.$('micro-quick').onclick();
  const commands=restored.calls.filter(x=>x.path.endsWith('/command'));
  assert.equal(commands.length,1); assert.equal(commands[0].body.action,'append');
  assert.equal(commands[0].body.bindingId,'old');
  assert.equal(commands[0].body.text,'检查当前改动，先不要修改文件。');
  assert.equal(restored.micCalls(),0);
});
test('Micro shortcuts preserve pending phone text and reject stale computer bindings', async () => {
  const preferences = new Map([['vibe-controller-command-keys-v1',JSON.stringify({quick:{action:'prompt',prompt:'继续'}})]]);
  const h=harness({preferences}); await settle();
  h.$('text').value='尚未写入'; h.$('text').oninput();
  assert.equal(h.$('micro-quick').disabled,true); await h.$('micro-quick').onclick();
  assert.equal(h.$('text').value,'尚未写入');
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
  h.$('discard').onclick(); h.setBinding(binding('replacement'));
  await h.$('micro-quick').onclick();
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
  assert.match(h.$('error').textContent,/已更新/);
});
test('resetting one Micro key preserves other assignments and rejects empty shortcuts', async () => {
  const preferences=new Map(); const h=harness({preferences}); await settle();
  h.$('command-action').value='prompt';h.$('command-prompt').value=' ';h.$('save-command').onclick();
  assert.match(h.$('command-config-error').textContent,/填写/);
  assert.equal(preferences.has('vibe-controller-command-keys-v1'),false);
  h.$('command-action').value='text';h.$('save-command').onclick();
  h.$('edit-fork').onclick();h.$('command-action').value='refresh';h.$('save-command').onclick();
  h.$('edit-quick').onclick();h.$('reset-command').onclick();
  assert.equal(h.$('label-quick').textContent,'FAST');assert.equal(h.$('label-fork').textContent,'刷新连接');
  const saved=JSON.parse(preferences.get('vibe-controller-command-keys-v1'));
  assert.equal(saved.quick,undefined);assert.equal(saved.fork.action,'refresh');
});
test('Micro shortcuts cannot dispatch twice while a prior append is in flight',async()=>{
  const preferences=new Map([['vibe-controller-command-keys-v1',JSON.stringify({quick:{action:'prompt',prompt:'继续'}})]]);
  const h=harness({preferences});await settle();
  const first=h.$('micro-quick').onclick();const second=h.$('micro-quick').onclick();await Promise.all([first,second]);
  assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,1);
});

test('disconnect and online recovery preserve pending text and never replay a command',async()=>{
 const h=harness();await settle();h.$('text').value='断线期间保留';h.$('text').oninput();
 h.setOffline(true);await h.tickPoll();assert.equal(h.$('mic').disabled,true);assert.match(h.$('error').textContent,/网络/);
 h.setOffline(false);await h.online();
 assert.equal(h.$('error').textContent,'');assert.equal(h.$('text').value,'断线期间保留');
 assert.equal(h.$('pairing').hidden,true);assert.equal(h.$('send').disabled,true);
 assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
});
test('initial connection failure recovers without retaining the old error',async()=>{
 const h=harness({startOffline:true});await settle();assert.match(h.$('error').textContent,/网络/);
 h.setOffline(false);await h.tickPoll();assert.equal(h.$('error').textContent,'');assert.equal(h.$('mic').disabled,false);
});
test('a page restored from cache can record again without reviving the interrupted recording',async()=>{
 const h=harness();await settle();await h.$('mic').onclick();h.hide();await h.resume();
 assert.equal(h.$('mic').disabled,false);assert.equal(h.$('mic').ariaLabel,'开始录音');assert.match(h.$('status').textContent,/中断/);
 await h.$('mic').onclick();assert.equal(h.micCalls(),2);
 assert.equal(h.calls.filter(x=>x.path.endsWith('/transcriptions')||x.path.endsWith('/command')).length,0);
});
test('a service restart requires rebind and preserves the unsent phone fragment',async()=>{
 const h=harness();await settle();h.$('text').value='重启后保留';h.$('text').oninput();
 h.setBinding({...binding(null),bound:false});await h.tickPoll();
 assert.equal(h.$('mic').disabled,true);assert.equal(h.$('text').value,'重启后保留');
 h.setBinding(binding('after-restart'));await h.tickPoll();
 assert.equal(h.$('mic').disabled,false);assert.equal(h.$('send').disabled,true);
 assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
});
test('an ASR result arriving after background and resume cannot auto-append',async()=>{
 const h=harness();await settle();await h.$('mic').onclick();h.stop();await settle();h.hide();await h.resume();
 h.transcribe('后台迟到的结果');await settle();await settle();
 assert.equal(h.$('text').value,'后台迟到的结果');assert.equal(h.$('text-sheet').open,true);
 assert.equal(h.calls.filter(x=>x.path.endsWith('/command')).length,0);
});

test('a hung status request times out and releases the busy UI',async()=>{
 const h=harness({hangStatus:true});await settle();h.timeoutStatus();await settle();
 assert.match(h.$('error').textContent,/连接超时/);assert.equal(h.$('refresh').disabled,false);
});
test('microphone permission granted after returning from background is discarded',async()=>{
 const h=harness({delayMicrophone:true});await settle();const starting=h.$('mic').onclick();await settle();
 h.hide();await h.resume();h.allowMicrophone();await starting;
 assert.equal(h.stoppedTracks(),1);assert.equal(h.$('mic').ariaLabel,'开始录音');
 assert.match(h.$('error').textContent,/启动已中断/);
 assert.equal(h.calls.filter(x=>x.path.endsWith('/transcriptions')||x.path.endsWith('/command')).length,0);
});

test('new phone pairs inside settings and returns to remote without navigation',async()=>{
  const h=harness({requirePair:true});await settle();
  assert.equal(h.$('settings-sheet').open,true);assert.equal(h.$('pairing').hidden,false);
  h.$('pair-code').value='BAD';h.$('pairing').onsubmit({preventDefault(){}});await settle();
  assert.equal(h.$('settings-sheet').open,true);assert.match(h.$('settings-connection-error').textContent,/配对码无效/);
  h.$('pair-code').value='GOOD-CODE';h.$('pairing').onsubmit({preventDefault(){}});await settle();
  assert.equal(h.$('settings-sheet').open,false);assert.equal(h.$('pairing').hidden,true);
  assert.equal(h.calls.filter(c=>c.path.endsWith('/command')).length,0);
});
test('manual pairing stays open across status polling',async()=>{
  const h=harness();await settle();h.$('settings-pair').onclick();await h.tickPoll();await settle();
  assert.equal(h.$('pairing').hidden,false);
});

test('pairing input accepts lowercase, separators and fullwidth paste without manual formatting',async()=>{
  const h=harness({requirePair:true});await settle();
  h.$('pair-code').value='ｇｏｏｄ－ｃｏｄｅ';h.$('pair-code').oninput();
  assert.equal(h.$('pair-code').value,'GOODCODE');
  h.$('pairing').onsubmit({preventDefault(){}});await settle();
  assert.equal(h.calls.find(c=>c.path==='/api/pair').body.code,'GOODCODE');
  assert.equal(h.$('settings-sheet').open,false);
});

test('successful pairing followed by network failure does not ask for another code',async()=>{
  const h=harness({requirePair:true});await settle();h.setOffline(true);
  h.$('pair-code').value='GOODCODE';h.$('pairing').onsubmit({preventDefault(){}});await settle();
  assert.equal(h.$('settings-sheet').open,false);assert.equal(h.$('pairing').hidden,true);
  assert.match(h.$('error').textContent,/配对已成功/);
  h.setOffline(false);await h.tickPoll();await settle();
  assert.equal(h.$('error').textContent,'');
  assert.equal(h.calls.filter(c=>c.path==='/api/pair').length,1);
});

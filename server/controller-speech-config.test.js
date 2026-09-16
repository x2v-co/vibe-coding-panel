import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {controllerSpeechEnv} from './controller-speech-config.js';
test('speech profile persists model choice, allows explicit overrides, and ignores unrelated keys',t=>{
 const dir=mkdtempSync(path.join(tmpdir(),'controller-speech-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=path.join(dir,'profile.json');writeFileSync(file,JSON.stringify({PANEL_WHISPER_BACKEND:'mlx',PANEL_WHISPER_MODEL:'large',PANEL_REQUIRE_PAIRING:'0',PATH:'bad'}));
 assert.deepEqual(controllerSpeechEnv({PANEL_WHISPER_MODEL:'explicit'},file),{PANEL_LIVE_SPEECH:'0',PANEL_WHISPER_BACKEND:'mlx',PANEL_WHISPER_MODEL:'explicit'});
 assert.equal(controllerSpeechEnv({PANEL_LIVE_SPEECH:'1'},file).PANEL_LIVE_SPEECH,'1');
 assert.equal(controllerSpeechEnv({},path.join(dir,'missing')).PANEL_LIVE_SPEECH,'0');
});

import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const defaultFile = fileURLToPath(new URL('../.vibe-panel/controller-speech.json', import.meta.url));
const keys = ['PANEL_WHISPER_BACKEND','PANEL_WHISPER_MODEL','PANEL_WHISPER_BIN','PANEL_PYTHON_BIN','PANEL_FFMPEG_BIN','PANEL_WHISPER_MODEL_DIR'];
// Local machine speech profile; explicit environment values always win.
export function controllerSpeechEnv(env = process.env, file = env.PANEL_CONTROLLER_SPEECH_CONFIG || defaultFile) {
  let saved = {};
  try {
    const parsed = JSON.parse(readFileSync(file,'utf8'));
    for (const key of keys) if (typeof parsed[key] === 'string' && parsed[key].trim()) saved[key] = parsed[key];
  } catch {}
  return {PANEL_LIVE_SPEECH:'0',...saved,...env};
}

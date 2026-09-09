import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function speechHome(env = process.env) {
  return path.resolve(env.PANEL_SPEECH_HOME || path.join(homedir(), '.vibe-panel', 'speech'));
}

// Explicit speech configuration always wins over the optional managed install.
export function managedSpeechEnv(env = process.env) {
  if (env.PANEL_WHISPER_BACKEND || env.PANEL_WHISPER_BIN) return { ...env };
  try {
    const config = JSON.parse(readFileSync(path.join(speechHome(env), 'current.json'), 'utf8'));
    if (config.schema !== 1 || config.platform !== process.platform || config.arch !== process.arch
      || !['python', 'whisper', 'ffmpeg', 'modelDir'].every(key => typeof config[key] === 'string' && path.isAbsolute(config[key]) && existsSync(config[key]))
      || !existsSync(path.join(config.modelDir, 'small.pt'))) return { ...env };
    return { PANEL_WHISPER_BACKEND: 'openai', PANEL_WHISPER_BIN: config.whisper,
      PANEL_PYTHON_BIN: config.python, PANEL_FFMPEG_BIN: config.ffmpeg,
      PANEL_WHISPER_MODEL_DIR: config.modelDir, ...env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
  } catch { return { ...env }; }
}

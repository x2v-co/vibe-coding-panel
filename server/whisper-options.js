export function resolveWhisperBackend(env = process.env) {
  const backend = env.PANEL_WHISPER_BACKEND || 'openai';
  if (!['openai', 'mlx'].includes(backend)) throw new Error('PANEL_WHISPER_BACKEND must be openai or mlx');
  return backend;
}

export function resolveWhisperBinary(env = process.env) {
  return env.PANEL_WHISPER_BIN || (resolveWhisperBackend(env) === 'mlx' ? 'mlx_whisper' : 'whisper');
}

export function resolveWhisperModel(env = process.env) {
  return env.PANEL_WHISPER_MODEL || (resolveWhisperBackend(env) === 'mlx' ? 'mlx-community/whisper-large-v3-turbo-q4' : 'small');
}

export function speechConfiguration(env = process.env) {
  try { return { backend: resolveWhisperBackend(env), model: resolveWhisperModel(env) }; }
  catch { return { backend: 'unknown', model: 'unknown', guidance: '语音后端配置无效。请在电脑将 PANEL_WHISPER_BACKEND 设置为 openai 或 mlx，或移除此自定义设置后重启；仍可使用文字输入。' }; }
}

export function resolveWhisperTimeout(env = process.env) {
  const configured = Number(env.PANEL_WHISPER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 20 * 60 * 1000;
}

export function buildWhisperArgs(inputPath, model, language, outputDir, backend = 'openai', env = process.env) {
  const args = [
    inputPath,
    '--model', model,
    '--language', language,
    '--task', 'transcribe',
    '--condition_on_previous_text', 'False',
    '--output_format', 'txt',
    '--output_dir', outputDir,
    '--verbose', 'False',
  ];
  if (backend === 'openai' && env.PANEL_WHISPER_MODEL_DIR) args.push('--model_dir', env.PANEL_WHISPER_MODEL_DIR);
  // mlx-whisper uses hyphenated flags; OpenAI Whisper uses underscores.
  return backend === 'mlx' ? args.map(arg => arg.startsWith('--') ? arg.replaceAll('_', '-') : arg) : args;
}

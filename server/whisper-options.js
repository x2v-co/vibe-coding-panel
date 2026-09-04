export function resolveWhisperModel(env = process.env) {
  return env.PANEL_WHISPER_MODEL || 'small';
}

export function resolveWhisperTimeout(env = process.env) {
  const configured = Number(env.PANEL_WHISPER_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 20 * 60 * 1000;
}

export function buildWhisperArgs(inputPath, model, language, outputDir) {
  return [
    inputPath,
    '--model', model,
    '--language', language,
    '--task', 'transcribe',
    '--condition_on_previous_text', 'False',
    '--output_format', 'txt',
    '--output_dir', outputDir,
    '--verbose', 'False',
  ];
}

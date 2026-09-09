// Finding a binary on PATH is insufficient: its shared libraries may be missing.
export async function resolveFfmpeg({ configured, pythonCandidates, readProcess }) {
  for (const binary of [...new Set([configured, 'ffmpeg'].filter(Boolean))]) {
    try {
      await readProcess(binary, ['-version']);
      return binary;
    } catch { /* Try another installation. */ }
  }
  for (const python of [...new Set(pythonCandidates.filter(Boolean))]) {
    try {
      const binary = (await readProcess(python, ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'])).trim();
      if (!binary) continue;
      await readProcess(binary, ['-version']);
      return binary;
    } catch { /* This Python or its bundled ffmpeg is unavailable. */ }
  }
  throw Object.assign(new Error('没有可运行的 ffmpeg。请在电脑运行 Setup Voice 并重启 Connector；使用自定义语音环境时，请修复该环境的 imageio-ffmpeg 或录音解码程序。'), { status: 503, code: 'FFMPEG_MISSING' });
}

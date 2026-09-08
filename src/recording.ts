export const MIN_RECORDING_MS = 700;

export function recordingMimeTypes(userAgent: string, maxTouchPoints = 0) {
  const appleMobile = /iPhone|iPad|iPod/.test(userAgent)
    || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
  const safari = /Safari/.test(userAgent) && !/Chrome|Chromium|Edg/.test(userAgent);
  return appleMobile || safari
    ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']
    : ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];
}

// Validate actual audio frames, not Blob size: a container header alone is nonempty.
export async function validateRecording(blob: Blob) {
  if (!blob.size) throw new Error('没有录到声音，请重新录音');
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await blob.arrayBuffer());
    if (!audio.length || audio.duration < MIN_RECORDING_MS / 1000) {
      throw new Error('录音太短，请等待录音开始后说完一句话，再结束录音');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('录音太短')) throw error;
    throw new Error('浏览器未生成完整录音，请重新录音；仍失败可使用系统录音上传');
  } finally {
    await context.close().catch(() => {});
  }
}

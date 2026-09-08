import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';

export async function decodeRecording(ffmpeg, input, output) {
  await new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', input,
      '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', output],
    { stdio: ['ignore', 'ignore', 'pipe'] });
    let details = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(Object.assign(new Error('录音解码超时，请缩短录音后重试'), { status: 422 }));
    }, 30000);
    child.stderr.on('data', (chunk) => { details = (details + chunk.toString()).slice(-2000); });
    child.on('error', () => {
      clearTimeout(timer);
      reject(new Error('无法启动录音解码器，请重启电脑 Connector 检查 ffmpeg'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      // Invalid browser recordings must not incur Whisper model loading/inference.
      const message = /End of file|Invalid data|does not contain any stream|matches no streams/i.test(details)
        ? '录音不完整或没有音频数据。请重新录音，说完一句话后再结束；仍失败可使用系统录音上传。'
        : '无法解码这段录音，请重新录音或使用系统录音上传。';
      reject(Object.assign(new Error(message), { status: 422, code: 'INVALID_RECORDING' }));
    });
  });
  const { size } = await stat(output);
  // Mono PCM16 at 16 kHz; reject headers and clips shorter than roughly 250 ms.
  if (size < 8044) throw Object.assign(new Error('录音太短或没有音频数据，请说完一句话后再结束录音'), { status: 422 });
}

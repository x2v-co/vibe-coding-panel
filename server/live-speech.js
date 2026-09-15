import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const error = (message, status = 503) => Object.assign(new Error(message), { status });
export class LiveSpeech {
  constructor({ python = process.env.PANEL_LIVE_PYTHON || process.env.PANEL_PYTHON_BIN || 'python3', spawnProcess = spawn } = {}) {
    this.python = python; this.spawnProcess = spawnProcess; this.child = null; this.ready = false; this.pending = null; this.seq = 0; this.failure = null; this.lastDiagnostics = null;
  }
  start() {
    if (this.child) return;
    this.failure = null;
    const child = this.spawnProcess(this.python, ['-u', fileURLToPath(new URL('../scripts/live-whisper.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const lines = createInterface({ input: child.stdout }); child.stderr.resume();
    this.startTimer = setTimeout(() => this.fail('语音模型加载超时，请检查电脑'), 120000);
    lines.on('line', line => {
      let result; try { result = JSON.parse(line); } catch { return; }
      if (result.ready) { this.ready = true; clearTimeout(this.startTimer); return; }
      if (result.id !== this.pending?.id) return;
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer);
      if (result.error) pending.reject(error(result.error));
      else {
        const d = result.diagnostics;
        this.lastDiagnostics = d && ['ok', 'no_signal', 'no_speech', 'filtered', 'asr_empty'].includes(d.reason)
          ? { reason: d.reason, audioMs: Number(d.audioMs), speechMs: Number(d.speechMs), rmsDb: Number(d.rmsDb) } : null;
        pending.resolve({ text: String(result.text || ''), candidateText: String(result.candidateText || ''), inferenceMs: result.inferenceMs, speechEnded: result.speechEnded === true, diagnostics: this.lastDiagnostics });
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', () => { if (this.child === child) this.fail('无法启动语音进程，请检查 Python 和 Whisper'); });
    child.on('exit', () => { lines.close(); if (this.child === child) this.fail('语音进程已退出，请重启原型'); });
  }
  fail(message) {
    const child = this.child; this.child = null; this.ready = false; this.failure = message;
    clearTimeout(this.startTimer);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error(message)); this.pending = null; }
    child?.kill('SIGKILL');
  }
  status() { return { ready: this.ready, busy: Boolean(this.pending), error: this.failure, lastDiagnostics: this.lastDiagnostics }; }
  transcribe(pcm) {
    if (typeof pcm !== 'string' || pcm.length > 2560000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(pcm)) throw error('音频格式无效', 400);
    const size = Buffer.from(pcm, 'base64').length;
    if (size < 1600 || size > 1920000 || size % 2) throw error('录音长度无效（最多 60 秒）', 400);
    if (!this.ready || !this.child) throw error(this.failure || '语音模型正在加载，请稍候');
    if (this.pending) throw error('语音识别忙，请稍候', 429);
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending = { id, resolve, reject, timer: setTimeout(() => this.fail('语音识别超时，请重启原型'), 50000) };
      this.child.stdin.write(JSON.stringify({ id, pcm }) + '\n');
    });
  }
  close() { this.fail('语音服务已停止'); }
}

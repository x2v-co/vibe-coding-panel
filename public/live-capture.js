// PCM capture for the experimental controller. No browser/cloud speech service.
class LiveCapture {
  async start(onLimit) {
    this.frames = []; this.length = 0;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      this.context = new Context(); await this.context.resume();
      this.rate = this.context.sampleRate;
      this.source = this.context.createMediaStreamSource(this.stream);
      // ScriptProcessor remains available on target Safari/Chrome; a production
      // build should replace it with AudioWorklet after device acceptance.
      this.processor = this.context.createScriptProcessor(4096, 1, 1);
      this.gain = this.context.createGain(); this.gain.gain.value = 0;
      this.processor.onaudioprocess = event => {
        if (this.stopped) return;
        const input = event.inputBuffer.getChannelData(0);
        const remaining = this.rate * 60 - this.length;
        if (remaining > 0) { const frame = input.slice(0, remaining); this.frames.push(frame); this.length += frame.length; }
        if (this.length >= this.rate * 60) { this.stop(); onLimit(); }
      };
      this.source.connect(this.processor); this.processor.connect(this.gain); this.gain.connect(this.context.destination);
    } catch (error) { this.stop(); throw error; }
  }
  snapshot() {
    const input = new Float32Array(this.length); let offset = 0;
    for (const frame of this.frames) { input.set(frame, offset); offset += frame.length; }
    const count = Math.floor(input.length * 16000 / this.rate), bytes = new Uint8Array(count * 2), view = new DataView(bytes.buffer);
    for (let i = 0; i < count; i++) {
      const start = Math.floor(i * this.rate / 16000), end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * this.rate / 16000)));
      let sum = 0; for (let j = start; j < end; j++) sum += input[j];
      const value = Math.max(-1, Math.min(1, sum / (end - start)));
      view.setInt16(i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
    }
    let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return { pcm: btoa(binary), samples: count };
  }
  stop() { this.stopped = true; if (this.processor) this.processor.onaudioprocess = null; this.source?.disconnect(); this.processor?.disconnect(); this.gain?.disconnect(); this.stream?.getTracks().forEach(t => t.stop()); this.context?.close().catch(() => {}); }
}
window.LiveCapture = LiveCapture;

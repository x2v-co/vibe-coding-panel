"""Warm Whisper with local Silero VAD; cumulative PCM snapshots over JSON lines."""
import base64
import contextlib
import importlib.metadata
import json
import os
import sys
import time

import numpy as np


class SpeechGate:
    """16 kHz Silero ONNX inference, with per-snapshot recurrent state.

    Load the packaged ONNX asset directly: no torchaudio or remote model loader.
    Never treat amplitude alone as evidence that speech is present.
    """
    def __init__(self):
        import onnxruntime as ort
        path = importlib.metadata.distribution('silero-vad').locate_file('silero_vad/data/silero_vad.onnx')
        options = ort.SessionOptions()
        options.inter_op_num_threads = options.intra_op_num_threads = 1
        self.model = ort.InferenceSession(str(path), sess_options=options, providers=['CPUExecutionProvider'])

    def trim(self, audio):
        state = np.zeros((2, 1, 128), dtype=np.float32)
        context = np.zeros((1, 64), dtype=np.float32)
        start = None
        last = 0
        voiced = 0
        ended = False
        for offset in range(0, len(audio), 512):
            chunk = np.zeros((1, 512), dtype=np.float32)
            part = audio[offset:offset + 512]
            chunk[0, :len(part)] = part
            inputs = np.concatenate((context, chunk), axis=1)
            probability, state = self.model.run(None, {'input': inputs, 'state': state, 'sr': np.array(16000, dtype=np.int64)})
            context = inputs[:, -64:]
            if float(probability[0, 0]) >= 0.5:
                if start is None:
                    start = offset
                last = min(offset + 512, len(audio))
                voiced += len(part)
            # A sustained pause ends this utterance, even if later noise or
            # another voice appears before the next browser snapshot arrives.
            if start is not None and offset + len(part) - last >= 24000:
                if voiced >= 3072:
                    ended = True
                    break
                start = None
                voiced = 0
        if start is None or voiced < 3072:
            return np.empty(0, dtype=np.float32), False
        return audio[max(0, start - 3840):min(len(audio), last + 3840)], ended


def reliable_text(result):
    # VAD already confirmed speech. Whisper's no_speech_prob alone can be high
    # on quiet but confidently decoded speech; use text confidence jointly.
    # Still reject uncertain or repetitive segments, never bypass the VAD.
    return ''.join(s.get('text', '') for s in result.get('segments', [])
                   if (s.get('no_speech_prob', 1) < 0.5 or s.get('avg_logprob', -99) >= -0.35)
                   and s.get('avg_logprob', -99) >= -0.8
                   and s.get('compression_ratio', 99) <= 2.4).strip()


def transcript_outcome(result):
    raw = result.get('text', '').strip()
    accepted = reliable_text(result)
    # Keep the full utterance for review if any segment was rejected. Dropping
    # only a negation/constraint could silently change the user's instruction.
    if raw and accepted != raw:
        return '', raw
    return accepted, ''


def main():
    with contextlib.redirect_stdout(sys.stderr):
        import torch
        import whisper
        torch.set_num_threads(max(1, min(4, os.cpu_count() or 1)))
        gate = SpeechGate()
        model = whisper.load_model(os.environ.get('PANEL_LIVE_MODEL', 'small'),
                                   download_root=os.environ.get('PANEL_WHISPER_MODEL_DIR'))
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            raw = base64.b64decode(request['pcm'], validate=True)
            if not 1600 <= len(raw) <= 16000 * 2 * 60 or len(raw) % 2:
                raise ValueError('invalid PCM length')
            audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
            started = time.monotonic()
            with contextlib.redirect_stdout(sys.stderr):
                speech, ended = gate.trim(audio)
                result = {} if not len(speech) else model.transcribe(
                    speech, language='zh', fp16=False, condition_on_previous_text=False,
                    temperature=0, verbose=None)
                text, candidate = transcript_outcome(result)
                reason = ('ok' if text else 'no_signal' if np.max(np.abs(audio)) < 0.00003
                          else 'no_speech' if not len(speech) else 'filtered' if result.get('text', '').strip() else 'asr_empty')
                diagnostics = {'reason': reason, 'audioMs': round(len(audio) / 16),
                               'speechMs': round(len(speech) / 16),
                               'rmsDb': round(20 * np.log10(max(float(np.sqrt(np.mean(audio * audio))), 1e-8)), 1)}
            print(json.dumps({'id': request['id'], 'text': text, 'candidateText': candidate, 'speechEnded': ended, 'diagnostics': diagnostics,
                              'inferenceMs': round((time.monotonic() - started) * 1000)}, ensure_ascii=False), flush=True)
        except Exception:
            print(json.dumps({'id': request.get('id'), 'error': '本地实时识别失败'}), flush=True)


if __name__ == '__main__':
    main()

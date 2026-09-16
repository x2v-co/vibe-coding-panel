"""Run with the same Python as PANEL_LIVE_PYTHON; no Whisper download required."""
import importlib.util
from pathlib import Path
import sys
import unittest
import numpy as np
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('live_whisper', Path(__file__).with_name('live-whisper.py'))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class SpeechGateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gate = worker.SpeechGate()

    def test_non_speech_never_reaches_transcription(self):
        samples = 16000 * 5
        rng = np.random.default_rng(3)
        for audio in [np.zeros(samples), rng.normal(0, .05, samples),
                      .06 * np.sin(np.arange(samples) * 2 * np.pi * 440 / 16000)]:
            cleaned, ended = self.gate.trim(audio.astype(np.float32))
            self.assertEqual(len(cleaned), 0)
            self.assertFalse(ended)

    def test_confident_quiet_speech_is_not_rejected_by_no_speech_score_alone(self):
        segment = dict(text='这是一次语音输入测试', no_speech_prob=.865, avg_logprob=-.268, compression_ratio=.866)
        self.assertEqual(worker.reliable_text({'segments': [segment]}), segment['text'])

    def test_partial_rejection_preserves_whole_instruction_for_review(self):
        good = dict(text='检查代码，', no_speech_prob=.01, avg_logprob=-.2, compression_ratio=1)
        rejected = dict(good, text='不要修改文件', no_speech_prob=.9, avg_logprob=-.7)
        result = dict(text=good['text'] + rejected['text'], segments=[good, rejected])
        self.assertEqual(worker.transcript_outcome(result), ('', result['text']))
        self.assertEqual(worker.transcript_outcome({}), ('', ''))

    def test_gate_has_no_state_leak_between_recordings(self):
        noise = np.random.default_rng(8).normal(0, .03, 16000).astype(np.float32)
        self.gate.trim(noise)
        cleaned, ended = self.gate.trim(np.zeros(16000, dtype=np.float32))
        self.assertEqual(len(cleaned), 0)
        self.assertFalse(ended)

    def test_uncertain_or_repetitive_segments_are_not_draft_text(self):
        good = dict(text='有效人声', no_speech_prob=.01, avg_logprob=-.2, compression_ratio=1.2)
        segments = [good, dict(good, text='杂音', no_speech_prob=.8, avg_logprob=-.6),
                    dict(good, text='猜测', avg_logprob=-1.2),
                    dict(good, text='重复', compression_ratio=3), {'text': '缺少置信度'}]
        self.assertEqual(worker.reliable_text({'segments': segments}), '有效人声')


if __name__ == '__main__':
    unittest.main()

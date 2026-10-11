"""Synthetic 16 kHz mono s16 PCM generation for tests. No real audio files."""

import numpy as np

from asr.pipeline import SAMPLE_RATE_HZ


def sine_pcm(duration_seconds: float, frequency_hz: float = 440.0) -> bytes:
    sample_count = int(SAMPLE_RATE_HZ * duration_seconds)
    t = np.arange(sample_count) / SAMPLE_RATE_HZ
    samples = (np.sin(2 * np.pi * frequency_hz * t) * 32767 * 0.5).astype("<i2")
    return samples.tobytes()


def silence_pcm(duration_seconds: float) -> bytes:
    return b"\x00" * int(SAMPLE_RATE_HZ * duration_seconds * 2)

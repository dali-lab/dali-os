"""Manual benchmark: run dali-asr's model calls on a local WAV file.

    modal run asr/bench.py --wav-path path/to/meeting.wav

Converts the WAV to 16 kHz mono s16 PCM locally, then runs Parakeet and
pyannote on a T4 using the same image as modal_app.py, and prints stage
timings. Never touches S3 — --local is the only mode today, kept as an
explicit flag so a presigned-URL mode against a deployed app can be
added later without changing the CLI.
"""

from __future__ import annotations

import time
import wave
from pathlib import Path
from typing import Optional

import modal

from modal_app import _run_parakeet, _run_pyannote, image

app = modal.App("dali-asr-bench", image=image)


def _read_wav_as_pcm16k_mono(path: Path) -> bytes:
    import audioop

    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        rate = wav_file.getframerate()
        sample_width = wav_file.getsampwidth()
        frames = wav_file.readframes(wav_file.getnframes())

    if sample_width != 2:
        raise ValueError(f"expected 16-bit PCM, got {sample_width * 8}-bit")
    if channels == 2:
        frames = audioop.tomono(frames, sample_width, 0.5, 0.5)
    if rate != 16000:
        frames, _ = audioop.ratecv(frames, sample_width, 1, rate, 16000, None)
    return frames


@app.function(gpu="T4", timeout=600)
def bench_transcribe(pcm: bytes, max_speakers: Optional[int]) -> dict:
    timings = {}

    t0 = time.monotonic()
    words = _run_parakeet(pcm)
    timings["transcribe_s"] = round(time.monotonic() - t0, 2)

    t0 = time.monotonic()
    segments = _run_pyannote(pcm, max_speakers)
    timings["diarize_s"] = round(time.monotonic() - t0, 2)

    return {"timings": timings, "word_count": len(words), "segment_count": len(segments)}


@app.local_entrypoint()
def main(wav_path: str, local: bool = True, max_speakers: int = 0):
    if not local:
        raise SystemExit("only --local is supported today; see asr/README.md")

    pcm = _read_wav_as_pcm16k_mono(Path(wav_path))
    print(f"loaded {len(pcm) / 32000:.1f}s of 16kHz mono PCM from {wav_path}")

    t0 = time.monotonic()
    result = bench_transcribe.remote(pcm, max_speakers or None)
    total_s = round(time.monotonic() - t0, 2)

    print(f"words: {result['word_count']}, speaker segments: {result['segment_count']}")
    print(f"transcribe: {result['timings']['transcribe_s']}s, diarize: {result['timings']['diarize_s']}s")
    print(f"total (incl. cold start + roundtrip): {total_s}s")

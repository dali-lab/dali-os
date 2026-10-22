"""Manual benchmark: run dali-asr's model calls on a local WAV file.

    cd asr && uv run modal run --env staging bench.py --wav-path path/to/meeting.wav [--gpu L4] [--repeat 2]

Converts the WAV to 16 kHz mono s16 PCM locally, then runs Parakeet and
pyannote on a GPU (T4 unless --gpu says otherwise) using the same image as
modal_app.py, and prints stage timings. Pass 1 includes model load; later
passes (--repeat) are warm. Never touches S3 — --local is the only mode today, kept as an
explicit flag so a presigned-URL mode against a deployed app can be
added later without changing the CLI.
"""

from __future__ import annotations

import time
import wave
from pathlib import Path
from typing import Optional

import modal

import pipeline
from modal_app import _get_asr_model, _pcm_to_float32, _run_parakeet, _run_pyannote, image

# The weight-baking build step leaves a copy of modal_app.py in the image;
# mount the current file over it so the bench runs what is on disk.
app = modal.App("dali-asr-bench", image=image.add_local_python_source("modal_app"))


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
def bench_transcribe(pcm: bytes, max_speakers: Optional[int], repeat: int = 1) -> dict:
    # Peek at the raw token stream on the first 30 s only; the full file goes
    # through _run_parakeet, which windows it the way the deployed job does.
    raw = _get_asr_model().recognize(_pcm_to_float32(pcm[: 30 * 32000]), sample_rate=16000)
    tokens_head = list(zip((raw.tokens or [])[:12], (raw.timestamps or [])[:12]))

    passes = []
    for _ in range(repeat):
        timings = {}
        t0 = time.monotonic()
        words = pipeline.transcribe_windowed(pcm, _run_parakeet)
        timings["transcribe_s"] = round(time.monotonic() - t0, 2)

        t0 = time.monotonic()
        segments = _run_pyannote(pcm, max_speakers)
        timings["diarize_s"] = round(time.monotonic() - t0, 2)
        passes.append(timings)

    return {
        "passes": passes,
        "word_count": len(words),
        "segment_count": len(segments),
        "tokens_head": tokens_head,
        "words_head": words[:8],
        "segments_head": segments[:4],
    }


@app.local_entrypoint()
def main(wav_path: str, local: bool = True, max_speakers: int = 0, gpu: str = "T4", repeat: int = 1):
    if not local:
        raise SystemExit("only --local is supported today; see asr/README.md")

    pcm = _read_wav_as_pcm16k_mono(Path(wav_path))
    print(f"loaded {len(pcm) / 32000:.1f}s of 16kHz mono PCM from {wav_path}")

    t0 = time.monotonic()
    result = bench_transcribe.with_options(gpu=gpu).remote(pcm, max_speakers or None, max(1, repeat))
    total_s = round(time.monotonic() - t0, 2)

    print(f"gpu: {gpu}")
    print(f"words: {result['word_count']}, speaker segments: {result['segment_count']}")
    for number, timings in enumerate(result["passes"], start=1):
        print(f"pass {number}: transcribe {timings['transcribe_s']}s, diarize {timings['diarize_s']}s")
    print(f"total (incl. cold start + roundtrip): {total_s}s")
    print("first tokens:", result["tokens_head"])
    print("first words:", result["words_head"])
    print("first segments:", result["segments_head"])

"""ASR windowing: long segments are split for Parakeet, whose ONNX export
fails past ~400 s, and word times are offset back onto the segment clock."""

from asr.pipeline import Channel, Chunk, Segment, process_channel, split_pcm_windows
from asr.tests.fixtures import silence_pcm, sine_pcm


def test_short_pcm_is_one_window():
    pcm = sine_pcm(30)
    assert split_pcm_windows(pcm) == [(0.0, pcm)]


def test_windows_cover_pcm_exactly_and_respect_max():
    pcm = sine_pcm(700)
    windows = split_pcm_windows(pcm)

    assert len(windows) == 3
    assert b"".join(w for _, w in windows) == pcm
    assert all(len(w) <= 300 * 32000 for _, w in windows)
    assert all(len(w) % 640 == 0 for _, w in windows[:-1])
    offsets = [o for o, _ in windows]
    assert offsets[0] == 0.0
    assert offsets == [sum(len(w) for _, w in windows[:i]) / 32000 for i in range(3)]


def test_cut_lands_in_the_quiet_gap_before_the_target():
    # 296 s of tone, 1 s of silence, then more tone: the cut should land in
    # the silence (296..297 s), not at the 300 s target mid-tone.
    pcm = sine_pcm(296) + silence_pcm(1) + sine_pcm(100)
    windows = split_pcm_windows(pcm)

    assert len(windows) == 2
    cut_seconds = windows[1][0]
    assert 296.0 <= cut_seconds <= 297.0


def test_process_channel_offsets_words_by_window_start(monkeypatch):
    import asr.pipeline as pipeline

    original = pipeline.split_pcm_windows
    monkeypatch.setattr(pipeline, "split_pcm_windows", lambda pcm: original(pcm, 10, 2))

    pcm = sine_pcm(30)
    channel = Channel(
        channel="mic",
        segments=(Segment(start_seconds=1000.0, chunks=(Chunk(seq=0, url="u"),)),),
        max_speakers=None,
    )
    seen = []

    def fake_transcribe(window):
        seen.append(len(window))
        return [{"start": 1.0, "end": 1.5, "text": "hi"}]

    def fake_diarize(whole, max_speakers):
        assert len(whole) == len(pcm)
        return []

    result = process_channel(channel, lambda url: pcm, fake_transcribe, fake_diarize)

    assert len(seen) >= 3
    assert sum(seen) == len(pcm)
    starts = [w["s"] for w in result["words"]]
    assert starts[0] == 1001.0
    assert all(b - a >= 8 for a, b in zip(starts, starts[1:]))

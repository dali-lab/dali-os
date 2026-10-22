"""Model calls are mocked here — this exercises the real orchestration
(PCM assembly, absolute-time offsets, JSON shaping) with fake transcribe
and diarize callables, no GPU/Modal/torch involved."""

from asr.pipeline import Channel, Chunk, Segment, channel_audio_seconds, process_channel
from asr.tests.fixtures import sine_pcm


def _fetch_from_memory(urls_to_bytes):
    def fetch(url):
        return urls_to_bytes[url]

    return fetch


def test_offsets_applied_per_segment_and_words_sorted():
    chunk = sine_pcm(20)
    urls = {"seg0-chunk0": chunk, "seg1-chunk0": chunk}
    channel = Channel(
        channel="mic",
        segments=(
            Segment(start_seconds=100.0, chunks=(Chunk(seq=0, url="seg1-chunk0"),)),
            Segment(start_seconds=0.0, chunks=(Chunk(seq=0, url="seg0-chunk0"),)),
        ),
        max_speakers=None,
    )

    def fake_transcribe(pcm):
        return [{"start": 1.0, "end": 1.5, "text": "hi"}]

    def fake_diarize(pcm, max_speakers):
        assert max_speakers is None
        return [{"start": 0.0, "end": 2.0, "speaker": "SPEAKER_00"}]

    result = process_channel(channel, _fetch_from_memory(urls), fake_transcribe, fake_diarize)

    assert result["words"] == [
        {"s": 1.0, "e": 1.5, "w": "hi"},
        {"s": 101.0, "e": 101.5, "w": "hi"},
    ]
    assert result["segments"] == [
        {"s": 0.0, "e": 2.0, "speaker": 1},
        {"s": 100.0, "e": 102.0, "speaker": 1},
    ]


def test_max_speakers_forwarded_to_diarize():
    chunk = sine_pcm(20)
    channel = Channel(
        channel="mic",
        segments=(Segment(start_seconds=0.0, chunks=(Chunk(seq=0, url="u"),)),),
        max_speakers=1,
    )

    seen = {}

    def fake_diarize(pcm, max_speakers):
        seen["max_speakers"] = max_speakers
        return []

    process_channel(channel, _fetch_from_memory({"u": chunk}), lambda pcm: [], fake_diarize)

    assert seen["max_speakers"] == 1


def test_integer_speaker_labels_pass_through_unchanged():
    chunk = sine_pcm(20)
    channel = Channel(
        channel="call",
        segments=(Segment(start_seconds=0.0, chunks=(Chunk(seq=0, url="u"),)),),
        max_speakers=None,
    )

    result = process_channel(
        channel,
        _fetch_from_memory({"u": chunk}),
        lambda pcm: [],
        lambda pcm, max_speakers: [{"start": 0.0, "end": 1.0, "speaker": 3}],
    )

    assert result["segments"] == [{"s": 0.0, "e": 1.0, "speaker": 3}]


def test_channel_audio_seconds_sums_chunk_counts():
    channel = Channel(
        channel="mic",
        segments=(
            Segment(start_seconds=0.0, chunks=(Chunk(seq=0, url="a"), Chunk(seq=1, url="b"))),
            Segment(start_seconds=100.0, chunks=(Chunk(seq=0, url="c"),)),
        ),
        max_speakers=None,
    )
    assert channel_audio_seconds(channel) == 3 * 20


def _one_segment(urls):
    return Channel(
        channel="mic",
        segments=(Segment(start_seconds=0.0, chunks=tuple(Chunk(seq=i, url=u) for i, u in enumerate(urls))),),
    )


def test_chunks_are_fetched_concurrently():
    import threading

    barrier = threading.Barrier(3, timeout=5)

    def fetch(url):
        barrier.wait()
        return b"\x00\x00"

    process_channel(_one_segment(["a", "b", "c"]), fetch, lambda pcm: [], lambda pcm, n: [])


def test_chunks_finishing_out_of_order_assemble_in_seq_order():
    import threading

    second_done = threading.Event()
    seen = []

    def fetch(url):
        if url == "first":
            second_done.wait(timeout=5)
            return b"\x01\x00"
        second_done.set()
        return b"\x02\x00"

    def fake_transcribe(pcm):
        seen.append(pcm)
        return []

    process_channel(_one_segment(["first", "second"]), fetch, fake_transcribe, lambda pcm, n: [])

    assert seen == [b"\x01\x00\x02\x00"]


def test_chunks_land_in_their_own_segment():
    seen = []
    channel = Channel(
        channel="mic",
        segments=(
            Segment(start_seconds=0.0, chunks=(Chunk(seq=0, url="s0"),)),
            Segment(start_seconds=50.0, chunks=(Chunk(seq=0, url="s1"),)),
        ),
    )
    process_channel(
        channel,
        lambda url: b"\x01\x00" if url == "s0" else b"\x02\x00",
        lambda pcm: seen.append(pcm[:2]) or [],
        lambda pcm, n: [],
    )
    assert seen == [b"\x01\x00", b"\x02\x00"]


def test_a_failed_fetch_fails_the_channel():
    import pytest

    def fetch(url):
        if url == "b":
            raise RuntimeError("chunk fetch failed: HTTP 500")
        return b"\x00\x00"

    with pytest.raises(RuntimeError, match="HTTP 500"):
        process_channel(_one_segment(["a", "b", "c"]), fetch, lambda pcm: [], lambda pcm, n: [])


def test_timings_report_each_stage():
    ticks = iter([0.0, 2.0, 2.0, 5.0, 5.0, 11.0])
    timings = {}
    process_channel(
        _one_segment(["a"]),
        lambda url: b"\x00\x00",
        lambda pcm: [],
        lambda pcm, n: [],
        timings=timings,
        clock=lambda: next(ticks),
    )
    assert timings == {"fetch_s": 2.0, "transcribe_s": 3.0, "diarize_s": 6.0}

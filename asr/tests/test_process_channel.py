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

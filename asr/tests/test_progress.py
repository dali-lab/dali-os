from asr.pipeline import (
    CHUNK_SECONDS,
    Channel,
    Chunk,
    ProgressReporter,
    Segment,
    labeling_hook,
    process_channel,
    transcribe_windowed,
)
from asr.tests.fixtures import silence_pcm, sine_pcm


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now


def _reporter(sent, clock, send=None):
    return ProgressReporter("rec1", send or sent.append, clock)


def test_payload_shape():
    sent = []
    _reporter(sent, Clock()).report("fetching", 1, 2, 3, 10, 60.0)
    assert sent == [
        {
            "recordingId": "rec1",
            "progress": {
                "stage": "fetching",
                "channel": 1,
                "channels": 2,
                "completed": 3,
                "total": 10,
                "audioSeconds": 60.0,
            },
        }
    ]


def test_throttles_within_interval_and_resumes_after():
    sent, clock = [], Clock()
    reporter = _reporter(sent, clock)
    reporter.report("fetching", 1, 1, 1, 10, 0.0)
    clock.now = 1.0
    reporter.report("fetching", 1, 1, 2, 10, 0.0)
    clock.now = 2.9
    reporter.report("fetching", 1, 1, 3, 10, 0.0)
    assert [b["progress"]["completed"] for b in sent] == [1]
    clock.now = 3.0
    reporter.report("fetching", 1, 1, 4, 10, 0.0)
    assert [b["progress"]["completed"] for b in sent] == [1, 4]


def test_stage_and_channel_boundaries_always_send():
    sent, clock = [], Clock()
    reporter = _reporter(sent, clock)
    reporter.report("fetching", 1, 2, 1, 1, 0.0)
    reporter.report("transcribing", 1, 2, 0, 5, 0.0)
    reporter.report("fetching", 2, 2, 1, 1, 0.0)
    assert [(b["progress"]["stage"], b["progress"]["channel"]) for b in sent] == [
        ("fetching", 1),
        ("transcribing", 1),
        ("fetching", 2),
    ]


def test_raising_sender_does_not_propagate():
    def boom(body):
        raise RuntimeError("down")

    reporter = _reporter([], Clock(), send=boom)
    reporter.report("fetching", 1, 1, 1, 1, 0.0)
    reporter.report("labeling", 1, 1, 1, 1, 0.0)


def test_for_channel_binds_channel_info():
    sent = []
    _reporter(sent, Clock()).for_channel(2, 3, 40.0)("labeling", 5, 100)
    assert sent[0]["progress"] == {
        "stage": "labeling",
        "channel": 2,
        "channels": 3,
        "completed": 5,
        "total": 100,
        "audioSeconds": 40.0,
    }


def test_transcribe_windowed_calls_on_window_per_window():
    pcm = sine_pcm(650)
    calls = []
    transcribe_windowed(pcm, lambda window: [], on_window=lambda: calls.append(1))
    assert len(calls) == 3


def test_transcribe_windowed_without_callback_still_offsets_words():
    pcm = sine_pcm(650)
    words = transcribe_windowed(pcm, lambda window: [{"start": 0.0, "end": 1.0, "text": "a"}])
    assert len(words) == 3
    assert words[0]["start"] == 0.0 and words[1]["start"] > 0


def test_labeling_hook_maps_steps_to_fraction():
    out = []
    hook = labeling_hook(lambda completed, total: out.append((completed, total)))
    hook("segmentation", None, file={}, total=10, completed=5)
    hook("segmentation", None, file={}, total=10, completed=10)
    hook("embeddings", None, file={}, total=4, completed=2)
    hook("embeddings", None, file={}, total=4, completed=4)
    assert out == [(25, 100), (50, 100), (75, 100), (100, 100)]


def test_labeling_hook_ignores_calls_without_total_or_unknown_steps():
    out = []
    hook = labeling_hook(lambda completed, total: out.append((completed, total)))
    hook("segmentation", None)
    hook("segmentation", None, total=None, completed=None)
    hook("segmentation", None, total=0, completed=0)
    hook("speaker_counting", None, total=3, completed=1)
    assert out == []


def test_process_channel_emits_stages_in_order():
    chunk = sine_pcm(CHUNK_SECONDS)
    channel = Channel(
        channel="mic",
        segments=(
            Segment(start_seconds=0.0, chunks=(Chunk(seq=0, url="a"), Chunk(seq=1, url="b"))),
            Segment(start_seconds=100.0, chunks=(Chunk(seq=0, url="c"),)),
        ),
    )
    events = []

    def fake_diarize(pcm, max_speakers, hook=None):
        hook("segmentation", None, total=2, completed=2)
        hook("embeddings", None, total=2, completed=2)
        return []

    process_channel(
        channel,
        lambda url: chunk,
        lambda pcm: [],
        fake_diarize,
        on_progress=lambda stage, completed, total: events.append((stage, completed, total)),
    )

    assert events == [
        ("fetching", 1, 3),
        ("fetching", 2, 3),
        ("fetching", 3, 3),
        ("transcribing", 1, 2),
        ("transcribing", 2, 2),
        ("labeling", 50, 200),
        ("labeling", 100, 200),
        ("labeling", 150, 200),
        ("labeling", 200, 200),
    ]


def test_process_channel_without_progress_keeps_two_arg_diarize():
    channel = Channel(channel="mic", segments=(Segment(0.0, (Chunk(seq=0, url="a"),)),))
    result = process_channel(channel, lambda url: silence_pcm(CHUNK_SECONDS), lambda pcm: [], lambda pcm, n: [])
    assert result == {"words": [], "segments": []}

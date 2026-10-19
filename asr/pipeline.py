"""Pure logic for the dali-asr Modal app.

PCM assembly, request/response shaping, and HMAC signing — no GPU, no
torch, no Modal SDK import here, so this module is testable with plain
pytest. See specs/meeting-transcription.md ("dali-asr (Modal, T4)" and
"Security") for the design this implements.
"""

from __future__ import annotations

import hashlib
import hmac
import threading
from array import array
from dataclasses import dataclass
from typing import Callable, Optional

SAMPLE_RATE_HZ = 16000
BYTES_PER_SAMPLE = 2
CHUNK_SECONDS = 20
CHUNK_BYTES = SAMPLE_RATE_HZ * BYTES_PER_SAMPLE * CHUNK_SECONDS  # 640,000

# Security section bounds: seq <= 720 per segment (4h), segments <= 20.
MAX_SEGMENTS_PER_CHANNEL = 20
MAX_SEQ = 720
VALID_CHANNELS = {"mic", "call"}


class ValidationError(ValueError):
    """A /process request body doesn't match the spec's JSON shape."""


@dataclass(frozen=True)
class Chunk:
    seq: int
    url: str


@dataclass(frozen=True)
class Segment:
    start_seconds: float
    chunks: tuple[Chunk, ...]


@dataclass(frozen=True)
class Channel:
    channel: str
    segments: tuple[Segment, ...]
    max_speakers: Optional[int] = None


@dataclass(frozen=True)
class ProcessRequest:
    recording_id: str
    callback_url: str
    channels: tuple[Channel, ...]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ValidationError(message)


def parse_process_request(body: dict) -> ProcessRequest:
    """Validate and parse a POST /process body into a ProcessRequest.

    Raises ValidationError on any violation of the spec's JSON shape or
    the Security section's bounds (channel names, segment/seq counts,
    required fields).
    """
    _require(isinstance(body, dict), "body must be a JSON object")

    recording_id = body.get("recordingId")
    _require(isinstance(recording_id, str) and bool(recording_id), "recordingId is required")

    callback_url = body.get("callbackUrl")
    _require(isinstance(callback_url, str) and bool(callback_url), "callbackUrl is required")

    raw_channels = body.get("channels")
    _require(isinstance(raw_channels, list) and len(raw_channels) > 0, "channels must be a non-empty list")

    channels = []
    for raw_channel in raw_channels:
        _require(isinstance(raw_channel, dict), "each channel must be an object")

        name = raw_channel.get("channel")
        _require(name in VALID_CHANNELS, f"channel must be one of {sorted(VALID_CHANNELS)}, got {name!r}")

        raw_segments = raw_channel.get("segments")
        _require(isinstance(raw_segments, list), "segments must be a list")
        _require(
            len(raw_segments) <= MAX_SEGMENTS_PER_CHANNEL,
            f"segments must be <= {MAX_SEGMENTS_PER_CHANNEL}, got {len(raw_segments)}",
        )

        max_speakers = raw_channel.get("maxSpeakers")
        _require(
            max_speakers is None or (isinstance(max_speakers, int) and max_speakers >= 1),
            "maxSpeakers must be a positive integer when present",
        )

        segments = []
        for raw_segment in raw_segments:
            _require(isinstance(raw_segment, dict), "each segment must be an object")

            start_seconds = raw_segment.get("startSeconds")
            _require(
                isinstance(start_seconds, (int, float)) and start_seconds >= 0,
                "startSeconds must be a non-negative number",
            )

            raw_chunks = raw_segment.get("chunks")
            _require(isinstance(raw_chunks, list) and len(raw_chunks) > 0, "chunks must be a non-empty list")
            _require(
                len(raw_chunks) <= MAX_SEQ,
                f"a segment may have at most {MAX_SEQ} chunks, got {len(raw_chunks)}",
            )

            chunks = []
            for raw_chunk in raw_chunks:
                _require(isinstance(raw_chunk, dict), "each chunk must be an object")

                seq = raw_chunk.get("seq")
                _require(
                    isinstance(seq, int) and not isinstance(seq, bool) and 0 <= seq <= MAX_SEQ,
                    f"seq must be an integer in [0, {MAX_SEQ}], got {seq!r}",
                )

                url = raw_chunk.get("url")
                _require(isinstance(url, str) and bool(url), "chunk url is required")

                chunks.append(Chunk(seq=seq, url=url))

            segments.append(Segment(start_seconds=float(start_seconds), chunks=tuple(chunks)))

        channels.append(Channel(channel=name, segments=tuple(segments), max_speakers=max_speakers))

    return ProcessRequest(recording_id=recording_id, callback_url=callback_url, channels=tuple(channels))


def silence(num_bytes: int) -> bytes:
    return b"\x00" * num_bytes


def assemble_segment_pcm(chunk_bytes_by_seq: dict) -> bytes:
    """Concatenate a segment's chunks in seq order, filling any missing
    seq with CHUNK_SECONDS of silence so later timestamps stay absolute.

    Only fills gaps *within* the observed range (0..max seq present) —
    it never guesses at chunks beyond the highest seq actually fetched.
    """
    if not chunk_bytes_by_seq:
        return b""

    max_seq = max(chunk_bytes_by_seq)
    parts = []
    for seq in range(max_seq + 1):
        data = chunk_bytes_by_seq.get(seq)
        parts.append(data if data is not None else silence(CHUNK_BYTES))
    return b"".join(parts)


def pcm_duration_seconds(pcm: bytes) -> float:
    return len(pcm) / (SAMPLE_RATE_HZ * BYTES_PER_SAMPLE)


# The Parakeet ONNX export's relative positional table covers about 5,000
# encoder frames (80 ms each, ~400 s of audio); a longer input fails inside
# the encoder. ASR therefore runs on windows of at most ASR_WINDOW_SECONDS.
# Each cut lands on the quietest 20 ms frame in the ASR_CUT_SEARCH_SECONDS
# before the target so a word is not split across two windows. Diarization
# is unaffected and still sees the whole segment.
ASR_WINDOW_SECONDS = 300
ASR_CUT_SEARCH_SECONDS = 10
_CUT_FRAME_BYTES = int(SAMPLE_RATE_HZ * BYTES_PER_SAMPLE * 0.02)


def _frame_energy(pcm: bytes, offset: int) -> int:
    samples = array("h", pcm[offset : offset + _CUT_FRAME_BYTES])
    return sum(abs(x) for x in samples)


def split_pcm_windows(
    pcm: bytes,
    max_seconds: float = ASR_WINDOW_SECONDS,
    search_seconds: float = ASR_CUT_SEARCH_SECONDS,
) -> list:
    """-> [(offset_seconds, pcm_bytes), ...] covering `pcm` exactly, in
    order, each at most `max_seconds` long and cut on a 20 ms frame edge."""
    max_bytes = int(SAMPLE_RATE_HZ * BYTES_PER_SAMPLE * max_seconds) // _CUT_FRAME_BYTES * _CUT_FRAME_BYTES
    search_bytes = int(SAMPLE_RATE_HZ * BYTES_PER_SAMPLE * search_seconds) // _CUT_FRAME_BYTES * _CUT_FRAME_BYTES
    windows: list = []
    start = 0
    while len(pcm) - start > max_bytes:
        target = start + max_bytes
        cut = target
        quietest = None
        for offset in range(target - search_bytes, target, _CUT_FRAME_BYTES):
            if offset <= start:
                continue
            energy = _frame_energy(pcm, offset)
            if quietest is None or energy < quietest:
                quietest, cut = energy, offset
        windows.append((start / (SAMPLE_RATE_HZ * BYTES_PER_SAMPLE), pcm[start:cut]))
        start = cut
    windows.append((start / (SAMPLE_RATE_HZ * BYTES_PER_SAMPLE), pcm[start:]))
    return windows


# onnx-asr's timestamped result is per SentencePiece token (a leading "▁"
# marks a word start) with one emission time per token and no end times.
# A word ends where the next word begins; the last word gets this tail.
WORD_START = "▁"
LAST_WORD_TAIL_SECONDS = 0.25


def tokens_to_words(tokens: list, timestamps: list) -> list:
    """SentencePiece tokens + per-token times -> [{start, end, text}]."""
    words: list = []
    for token, ts in zip(tokens, timestamps):
        if token in ("<unk>", "<pad>", "<s>", "</s>", "<blk>", ""):
            continue
        # SentencePiece marks word starts with "\u2581"; some tokenizers (the
        # Parakeet v3 export among them) use a plain leading space instead.
        starts_word = token.startswith(WORD_START) or token.startswith(" ")
        piece = token[1:] if starts_word else token
        if not piece:
            continue
        if starts_word or not words:
            words.append({"start": float(ts), "end": float(ts), "text": piece})
        else:
            words[-1]["text"] += piece
            words[-1]["end"] = float(ts)
    for i, w in enumerate(words):
        nxt = words[i + 1]["start"] if i + 1 < len(words) else w["end"] + LAST_WORD_TAIL_SECONDS
        w["end"] = max(w["end"], nxt) if i + 1 < len(words) else nxt
    return words


def transcribe_windowed(
    pcm: bytes,
    transcribe: Callable[[bytes], list],
    on_window: Optional[Callable[[], None]] = None,
    windows: Optional[list] = None,
) -> list:
    """Run `transcribe` per ASR window and return model-shaped words
    ({start, end, text}) relative to the start of `pcm`. `on_window` fires
    after each window; `windows` lets a caller that already split `pcm`
    skip the second split."""
    words: list = []
    for window_start, window in windows if windows is not None else split_pcm_windows(pcm):
        window_words = transcribe(window)
        if on_window is not None:
            on_window()
        for w in window_words:
            words.append(
                {
                    "start": float(w["start"]) + window_start,
                    "end": float(w["end"]) + window_start,
                    "text": w["text"],
                }
            )
    return words


def shape_words(raw_words: list, offset_seconds: float) -> list:
    """Model word output -> spec shape {s, e, w}, offset to absolute time."""
    return [
        {
            "s": round(float(w["start"]) + offset_seconds, 3),
            "e": round(float(w["end"]) + offset_seconds, 3),
            "w": w["text"],
        }
        for w in raw_words
    ]


def speaker_label_to_index(label: str) -> int:
    """pyannote speaker labels look like 'SPEAKER_00'; the spec wants a
    1-indexed int per channel ('SPEAKER_00' -> 1, 'SPEAKER_01' -> 2, ...)."""
    digits = "".join(ch for ch in label if ch.isdigit())
    return int(digits) + 1 if digits else 1


# Adjacent turns by the same speaker separated by less than this are one
# turn; pyannote emits them split at every brief pause or overlap.
SEGMENT_MERGE_GAP_SECONDS = 0.5


def merge_adjacent_segments(raw_segments: list) -> list:
    """Coalesce consecutive same-speaker segments (model output shape)."""
    merged: list = []
    for seg in sorted(raw_segments, key=lambda x: float(x["start"])):
        last = merged[-1] if merged else None
        if (
            last is not None
            and last["speaker"] == seg["speaker"]
            and float(seg["start"]) - float(last["end"]) <= SEGMENT_MERGE_GAP_SECONDS
        ):
            last["end"] = max(float(last["end"]), float(seg["end"]))
        else:
            merged.append({"start": float(seg["start"]), "end": float(seg["end"]), "speaker": seg["speaker"]})
    return merged


def shape_segments(raw_segments: list, offset_seconds: float) -> list:
    """Model diarization output -> spec shape {s, e, speaker}, offset to
    absolute time. Adjacent same-speaker turns are merged first."""
    raw_segments = merge_adjacent_segments(raw_segments)
    shaped = []
    for seg in raw_segments:
        speaker = seg["speaker"]
        shaped.append(
            {
                "s": round(float(seg["start"]) + offset_seconds, 3),
                "e": round(float(seg["end"]) + offset_seconds, 3),
                "speaker": speaker if isinstance(speaker, int) else speaker_label_to_index(speaker),
            }
        )
    return shaped


def channel_audio_seconds(channel: Channel) -> float:
    """Approximate total audio seconds in a channel (chunk count * chunk
    length), for logging only — never exact to the byte for a trailing
    partial chunk, which is fine for a stage-timing log line."""
    return sum(len(segment.chunks) for segment in channel.segments) * CHUNK_SECONDS


PROGRESS_INTERVAL_SECONDS = 3.0
PROGRESS_STAGES = ("fetching", "transcribing", "labeling")
LABELING_SCALE = 100
# pyannote reports batch counts for these two steps; the rest are fast.
_LABELING_STEP_RANGES = {"segmentation": (0.0, 0.5), "embeddings": (0.5, 1.0)}

ProgressCallback = Callable[[str, int, int], None]


def build_progress_body(
    recording_id: str,
    stage: str,
    channel: int,
    channels: int,
    completed: int,
    total: int,
    audio_seconds: float,
) -> dict:
    return {
        "recordingId": recording_id,
        "progress": {
            "stage": stage,
            "channel": channel,
            "channels": channels,
            "completed": completed,
            "total": total,
            "audioSeconds": audio_seconds,
        },
    }


class ProgressReporter:
    """Throttled, never-raising progress emitter. `send(body)` does the
    I/O; the first event of each (stage, channel) always goes out, later
    ones at most once per `interval` seconds."""

    def __init__(
        self,
        recording_id: str,
        send: Callable[[dict], None],
        clock: Callable[[], float],
        interval: float = PROGRESS_INTERVAL_SECONDS,
    ):
        self._recording_id = recording_id
        self._send = send
        self._clock = clock
        self._interval = interval
        self._last_key: Optional[tuple] = None
        self._last_sent_at: Optional[float] = None

    def for_channel(self, channel: int, channels: int, audio_seconds: float) -> ProgressCallback:
        def on_progress(stage: str, completed: int, total: int) -> None:
            self.report(stage, channel, channels, completed, total, audio_seconds)

        return on_progress

    def report(
        self, stage: str, channel: int, channels: int, completed: int, total: int, audio_seconds: float
    ) -> None:
        now = self._clock()
        key = (stage, channel)
        boundary = key != self._last_key
        if not boundary and now - self._last_sent_at < self._interval:
            return
        self._last_key = key
        self._last_sent_at = now
        body = build_progress_body(self._recording_id, stage, channel, channels, completed, total, audio_seconds)
        try:
            self._send(body)
        except Exception:
            pass


class LatestOnlySender:
    """Delivers progress bodies on one background thread with a single pending
    slot: while a post is in flight a newer body replaces the pending one, so
    a slow endpoint can never build a backlog. `close` drops whatever is
    pending and waits at most `timeout` seconds for the in-flight post."""

    def __init__(self, post: Callable[[dict], None]):
        self._post = post
        self._cond = threading.Condition()
        self._pending: Optional[dict] = None
        self._closed = False
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def submit(self, body: dict) -> None:
        with self._cond:
            if self._closed:
                return
            self._pending = body
            self._cond.notify()

    def close(self, timeout: float = 1.0) -> None:
        with self._cond:
            self._closed = True
            self._pending = None
            self._cond.notify_all()
        self._thread.join(timeout)

    def _run(self) -> None:
        while True:
            with self._cond:
                while self._pending is None and not self._closed:
                    self._cond.wait()
                if self._closed:
                    return
                body, self._pending = self._pending, None
            try:
                self._post(body)
            except Exception:
                pass


def labeling_hook(emit: Callable[[int, int], None]) -> Callable:
    """Adapt pyannote's hook(step_name, artifact, file=, total=, completed=)
    to emit(completed, LABELING_SCALE): segmentation fills the first half,
    embeddings the second. Calls without a total are ignored."""

    def hook(step_name, step_artifact, file=None, total=None, completed=None):
        step_range = _LABELING_STEP_RANGES.get(step_name)
        if step_range is None or not total or completed is None:
            return
        low, high = step_range
        fraction = low + (high - low) * min(max(completed / total, 0.0), 1.0)
        emit(round(fraction * LABELING_SCALE), LABELING_SCALE)

    return hook


def process_channel(
    channel: Channel,
    fetch_chunk: Callable[[str], bytes],
    transcribe: Callable[[bytes], list],
    diarize: Callable[..., list],
    on_progress: Optional[ProgressCallback] = None,
) -> dict:
    """Assemble each segment's PCM, run the injected model callables, and
    shape the combined output for one channel.

    No GPU/Modal import here — transcribe/diarize are plain callables so
    tests can mock the models and exercise the real orchestration.
    """
    words: list = []
    segments: list = []
    emit = on_progress or (lambda stage, completed, total: None)

    total_chunks = sum(len(segment.chunks) for segment in channel.segments)
    fetched = 0
    pcms = []
    for segment in channel.segments:
        chunk_bytes_by_seq = {}
        for chunk in segment.chunks:
            chunk_bytes_by_seq[chunk.seq] = fetch_chunk(chunk.url)
            fetched += 1
            emit("fetching", fetched, total_chunks)
        pcms.append(assemble_segment_pcm(chunk_bytes_by_seq))

    split = [split_pcm_windows(pcm) for pcm in pcms]
    total_windows = sum(len(windows) for windows in split)
    done_windows = 0

    def window_done() -> None:
        nonlocal done_windows
        done_windows += 1
        emit("transcribing", done_windows, total_windows)

    for segment, pcm, windows in zip(channel.segments, pcms, split):
        raw_words = transcribe_windowed(pcm, transcribe, on_window=window_done, windows=windows)
        words.extend(shape_words(raw_words, segment.start_seconds))

    segment_count = len(channel.segments)
    for index, (segment, pcm) in enumerate(zip(channel.segments, pcms)):
        if on_progress is None:
            raw_segments = diarize(pcm, channel.max_speakers)
        else:
            hook = labeling_hook(
                lambda completed, total, index=index: emit(
                    "labeling", index * LABELING_SCALE + completed, segment_count * LABELING_SCALE
                )
            )
            raw_segments = diarize(pcm, channel.max_speakers, hook=hook)
        segments.extend(shape_segments(raw_segments, segment.start_seconds))

    words.sort(key=lambda w: w["s"])
    segments.sort(key=lambda s: s["s"])
    return {"words": words, "segments": segments}


def build_callback_body(recording_id: str, channels: dict, error: Optional[str]) -> dict:
    return {"recordingId": recording_id, "channels": channels, "error": error}


def build_error_callback(recording_id: str, error: str) -> dict:
    return build_callback_body(recording_id, {}, error)


def sign_callback(secret: str, timestamp: int, raw_body: bytes) -> str:
    """HMAC-SHA256 over '{timestamp}.{rawBody}', per the spec's callback
    signature scheme (X-Dali-Signature: sha256=...)."""
    message = f"{timestamp}.".encode("utf-8") + raw_body
    digest = hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def check_bearer_token(header_value: Optional[str], expected_secret: str) -> bool:
    if not header_value or not header_value.startswith("Bearer "):
        return False
    token = header_value[len("Bearer "):]
    return hmac.compare_digest(token, expected_secret)


def redact_request(raw_body: dict) -> dict:
    """Strip presigned chunk URLs (and the callback URL) from a request
    body for logging. Only ids, channel names, and counts survive — this
    is what gets logged (or included in an error callback) on exception.
    """
    channels = raw_body.get("channels") if isinstance(raw_body, dict) else None
    redacted_channels = []
    if isinstance(channels, list):
        for ch in channels:
            if not isinstance(ch, dict):
                continue
            raw_segments = ch.get("segments")
            segments = raw_segments if isinstance(raw_segments, list) else []
            chunk_count = sum(
                len(s.get("chunks", [])) for s in segments if isinstance(s, dict) and isinstance(s.get("chunks"), list)
            )
            redacted_channels.append(
                {
                    "channel": ch.get("channel"),
                    "segments": len(segments),
                    "chunks": chunk_count,
                    "maxSpeakers": ch.get("maxSpeakers"),
                }
            )
    return {
        "recordingId": raw_body.get("recordingId") if isinstance(raw_body, dict) else None,
        "channels": redacted_channels,
    }

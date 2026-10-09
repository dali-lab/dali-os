"""Pure logic for the dali-asr Modal app.

PCM assembly, request/response shaping, and HMAC signing — no GPU, no
torch, no Modal SDK import here, so this module is testable with plain
pytest. See specs/meeting-transcription.md ("dali-asr (Modal, T4)" and
"Security") for the design this implements.
"""

from __future__ import annotations

import hashlib
import hmac
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


def shape_segments(raw_segments: list, offset_seconds: float) -> list:
    """Model diarization output -> spec shape {s, e, speaker}, offset to
    absolute time."""
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


def process_channel(
    channel: Channel,
    fetch_chunk: Callable[[str], bytes],
    transcribe: Callable[[bytes], list],
    diarize: Callable[[bytes, Optional[int]], list],
) -> dict:
    """Assemble each segment's PCM, run the injected model callables, and
    shape the combined output for one channel.

    No GPU/Modal import here — transcribe/diarize are plain callables so
    tests can mock the models and exercise the real orchestration.
    """
    words: list = []
    segments: list = []

    for segment in channel.segments:
        chunk_bytes_by_seq = {chunk.seq: fetch_chunk(chunk.url) for chunk in segment.chunks}
        pcm = assemble_segment_pcm(chunk_bytes_by_seq)

        words.extend(shape_words(transcribe(pcm), segment.start_seconds))
        segments.extend(shape_segments(diarize(pcm, channel.max_speakers), segment.start_seconds))

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

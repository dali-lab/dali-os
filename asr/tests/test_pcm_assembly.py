from asr.pipeline import (
    CHUNK_BYTES,
    CHUNK_SECONDS,
    assemble_segment_pcm,
    pcm_duration_seconds,
    silence,
)
from asr.tests.fixtures import sine_pcm


def test_full_chunk_is_chunk_seconds_long():
    chunk = sine_pcm(CHUNK_SECONDS)
    assert len(chunk) == CHUNK_BYTES


def test_empty_input_returns_empty_bytes():
    assert assemble_segment_pcm({}) == b""


def test_single_chunk_passthrough():
    chunk = sine_pcm(CHUNK_SECONDS)
    assert assemble_segment_pcm({0: chunk}) == chunk


def test_gap_is_filled_with_silence_and_total_length_is_correct():
    chunk0 = sine_pcm(CHUNK_SECONDS, frequency_hz=200.0)
    chunk2 = sine_pcm(CHUNK_SECONDS, frequency_hz=600.0)
    result = assemble_segment_pcm({0: chunk0, 2: chunk2})

    assert len(result) == 3 * CHUNK_BYTES
    assert result[0:CHUNK_BYTES] == chunk0
    assert result[CHUNK_BYTES : 2 * CHUNK_BYTES] == silence(CHUNK_BYTES)
    assert result[2 * CHUNK_BYTES :] == chunk2


def test_does_not_guess_beyond_highest_seq_present():
    chunk0 = sine_pcm(CHUNK_SECONDS)
    result = assemble_segment_pcm({0: chunk0})
    assert len(result) == CHUNK_BYTES


def test_pcm_duration_seconds_matches_elapsed_chunks_including_gap():
    chunk0 = sine_pcm(CHUNK_SECONDS)
    chunk2 = sine_pcm(CHUNK_SECONDS)
    result = assemble_segment_pcm({0: chunk0, 2: chunk2})
    assert pcm_duration_seconds(result) == 3 * CHUNK_SECONDS


def test_last_chunk_may_be_shorter_than_a_full_chunk():
    partial = sine_pcm(5.0)
    result = assemble_segment_pcm({0: sine_pcm(CHUNK_SECONDS), 1: partial})
    assert len(result) == CHUNK_BYTES + len(partial)

from pipeline import tokens_to_words


def test_groups_sentencepiece_tokens_into_words():
    tokens = ["▁hel", "lo", "▁wor", "ld", "▁there"]
    timestamps = [0.10, 0.18, 0.50, 0.58, 1.00]
    words = tokens_to_words(tokens, timestamps)
    assert [w["text"] for w in words] == ["hello", "world", "there"]
    assert [w["start"] for w in words] == [0.10, 0.50, 1.00]
    # Each word ends where the next begins; the last gets a short tail.
    assert words[0]["end"] == 0.50
    assert words[1]["end"] == 1.00
    assert words[2]["end"] == 1.25


def test_skips_special_tokens_and_handles_empty():
    assert tokens_to_words([], []) == []
    words = tokens_to_words(["<unk>", "▁ok", "<blk>"], [0.0, 0.3, 0.4])
    assert words == [{"start": 0.3, "end": 0.55, "text": "ok"}]


def test_leading_continuation_token_starts_a_word():
    words = tokens_to_words(["ing", "▁next"], [0.0, 0.4])
    assert [w["text"] for w in words] == ["ing", "next"]


def test_space_prefixed_tokens_start_words():
    words = tokens_to_words([" Hel", "lo", "?", " there"], [0.1, 0.2, 0.3, 0.9])
    assert [w["text"] for w in words] == ["Hello?", "there"]
    assert words[0]["end"] == 0.9


def test_merge_adjacent_segments():
    from pipeline import merge_adjacent_segments

    raw = [
        {"start": 1.0, "end": 1.2, "speaker": "A"},
        {"start": 1.3, "end": 2.0, "speaker": "A"},
        {"start": 2.1, "end": 2.5, "speaker": "B"},
        {"start": 4.0, "end": 4.5, "speaker": "B"},
    ]
    merged = merge_adjacent_segments(raw)
    assert merged == [
        {"start": 1.0, "end": 2.0, "speaker": "A"},
        {"start": 2.1, "end": 2.5, "speaker": "B"},
        {"start": 4.0, "end": 4.5, "speaker": "B"},
    ]

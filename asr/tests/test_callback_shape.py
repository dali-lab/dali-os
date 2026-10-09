import json

from asr.pipeline import build_callback_body, build_error_callback, redact_request


def test_callback_body_shape():
    channels = {
        "mic": {
            "words": [{"s": 1.0, "e": 1.5, "w": "hi"}],
            "segments": [{"s": 0.0, "e": 2.0, "speaker": 1}],
        },
    }
    body = build_callback_body("rec_1", channels, error=None)
    assert body == {"recordingId": "rec_1", "channels": channels, "error": None}


def test_error_callback_has_no_channels_and_sets_error():
    body = build_error_callback("rec_1", "processing_failed")
    assert body == {"recordingId": "rec_1", "channels": {}, "error": "processing_failed"}


def test_redact_request_strips_urls():
    raw_body = {
        "recordingId": "rec_1",
        "callbackUrl": "https://api.example.test/callback",
        "channels": [
            {
                "channel": "mic",
                "maxSpeakers": 2,
                "segments": [
                    {
                        "startSeconds": 0,
                        "chunks": [{"seq": 0, "url": "https://s3.example.com/secret-presigned-url"}],
                    }
                ],
            }
        ],
    }

    redacted = redact_request(raw_body)
    dumped = json.dumps(redacted)

    assert "http" not in dumped
    assert "secret-presigned-url" not in dumped
    assert redacted == {
        "recordingId": "rec_1",
        "channels": [{"channel": "mic", "segments": 1, "chunks": 1, "maxSpeakers": 2}],
    }


def test_redact_request_handles_malformed_input_without_raising():
    assert redact_request({}) == {"recordingId": None, "channels": []}
    assert redact_request({"channels": "not-a-list"}) == {"recordingId": None, "channels": []}

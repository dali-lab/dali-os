import pytest

from asr.pipeline import ValidationError, parse_process_request


def _valid_body(**overrides):
    body = {
        "recordingId": "rec_1",
        "callbackUrl": "https://api.example.test/callback",
        "channels": [
            {
                "channel": "mic",
                "segments": [
                    {"startSeconds": 0, "chunks": [{"seq": 0, "url": "https://s3.example/0.pcm"}]}
                ],
            }
        ],
    }
    body.update(overrides)
    return body


def test_valid_request_parses():
    req = parse_process_request(_valid_body())
    assert req.recording_id == "rec_1"
    assert req.callback_url == "https://api.example.test/callback"
    assert req.channels[0].channel == "mic"
    assert req.channels[0].segments[0].start_seconds == 0.0
    assert req.channels[0].segments[0].chunks[0].seq == 0


def test_rejects_bad_channel_name():
    body = _valid_body()
    body["channels"][0]["channel"] = "system"
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_missing_url():
    body = _valid_body()
    del body["channels"][0]["segments"][0]["chunks"][0]["url"]
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_blank_url():
    body = _valid_body()
    body["channels"][0]["segments"][0]["chunks"][0]["url"] = ""
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_more_than_20_segments():
    segment = {"startSeconds": 0, "chunks": [{"seq": 0, "url": "https://s3.example/0.pcm"}]}
    body = _valid_body()
    body["channels"][0]["segments"] = [segment] * 21
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_accepts_exactly_20_segments():
    segment = {"startSeconds": 0, "chunks": [{"seq": 0, "url": "https://s3.example/0.pcm"}]}
    body = _valid_body()
    body["channels"][0]["segments"] = [segment] * 20
    parse_process_request(body)


def test_rejects_more_than_720_chunks_in_one_segment():
    chunks = [{"seq": i, "url": f"https://s3.example/{i}.pcm"} for i in range(721)]
    body = _valid_body()
    body["channels"][0]["segments"][0]["chunks"] = chunks
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_seq_value_over_720():
    body = _valid_body()
    body["channels"][0]["segments"][0]["chunks"][0]["seq"] = 721
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_accepts_seq_value_of_exactly_720():
    body = _valid_body()
    body["channels"][0]["segments"][0]["chunks"][0]["seq"] = 720
    parse_process_request(body)


def test_rejects_negative_seq():
    body = _valid_body()
    body["channels"][0]["segments"][0]["chunks"][0]["seq"] = -1
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_missing_recording_id():
    body = _valid_body()
    del body["recordingId"]
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_missing_callback_url():
    body = _valid_body()
    del body["callbackUrl"]
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_empty_channels_list():
    body = _valid_body()
    body["channels"] = []
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_rejects_invalid_max_speakers():
    body = _valid_body()
    body["channels"][0]["maxSpeakers"] = 0
    with pytest.raises(ValidationError):
        parse_process_request(body)


def test_accepts_valid_max_speakers():
    body = _valid_body()
    body["channels"][0]["maxSpeakers"] = 3
    req = parse_process_request(body)
    assert req.channels[0].max_speakers == 3

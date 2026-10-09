import hashlib
import hmac

from asr.pipeline import check_bearer_token, sign_callback


def test_signature_matches_independently_computed_reference():
    secret = "topsecret"
    timestamp = 1733760000
    raw_body = b'{"recordingId":"rec_1","channels":{},"error":null}'

    reference = hmac.new(
        secret.encode("utf-8"),
        f"{timestamp}.".encode("utf-8") + raw_body,
        hashlib.sha256,
    ).hexdigest()

    assert sign_callback(secret, timestamp, raw_body) == f"sha256={reference}"


def test_signature_changes_with_timestamp():
    secret = "topsecret"
    raw_body = b"{}"
    assert sign_callback(secret, 1, raw_body) != sign_callback(secret, 2, raw_body)


def test_signature_changes_with_body():
    secret = "topsecret"
    assert sign_callback(secret, 1, b"{}") != sign_callback(secret, 1, b'{"a":1}')


def test_replay_with_a_fresh_timestamp_changes_the_signature():
    secret = "topsecret"
    raw_body = b'{"recordingId":"rec_1"}'
    first = sign_callback(secret, 1000, raw_body)
    second = sign_callback(secret, 1300, raw_body)
    assert first != second


def test_check_bearer_token_accepts_matching_secret():
    assert check_bearer_token("Bearer abc123", "abc123") is True


def test_check_bearer_token_rejects_wrong_secret():
    assert check_bearer_token("Bearer wrong", "abc123") is False


def test_check_bearer_token_rejects_missing_header():
    assert check_bearer_token(None, "abc123") is False


def test_check_bearer_token_rejects_non_bearer_scheme():
    assert check_bearer_token("Basic abc123", "abc123") is False


def test_check_bearer_token_rejects_empty_header():
    assert check_bearer_token("", "abc123") is False

"""pipeline.fetch_chunk against httpx's in-process MockTransport: no network."""

import httpx
import pytest

from asr.pipeline import fetch_chunk

SECRET_URL = "https://bucket.s3.amazonaws.com/recordings/r1/mic/0/0000.pcm?X-Amz-Signature=secret"


def _client(handler):
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_returns_the_chunk_bytes():
    with _client(lambda request: httpx.Response(200, content=b"\x01\x02")) as client:
        assert fetch_chunk(client, SECRET_URL) == b"\x01\x02"


@pytest.mark.parametrize("status", [403, 404])
def test_a_missing_chunk_is_a_gap(status):
    with _client(lambda request: httpx.Response(status)) as client:
        assert fetch_chunk(client, SECRET_URL) is None


def test_a_server_error_fails_without_the_url():
    with _client(lambda request: httpx.Response(500)) as client:
        with pytest.raises(RuntimeError) as info:
            fetch_chunk(client, SECRET_URL)
    assert str(info.value) == "chunk fetch failed: HTTP 500"
    assert info.value.__suppress_context__


def test_a_transport_error_fails_without_the_url():
    def handler(request):
        raise httpx.ConnectTimeout(f"timed out connecting to {request.url}", request=request)

    with _client(handler) as client:
        with pytest.raises(RuntimeError) as info:
            fetch_chunk(client, SECRET_URL)
    assert str(info.value) == "chunk fetch failed: ConnectTimeout"
    assert info.value.__suppress_context__


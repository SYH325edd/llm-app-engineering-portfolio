import pytest

from app.ark import ArkClient, ArkModelError


class FakeResponse:
    headers = {"content-type": "application/json"}

    def raise_for_status(self):
        return None

    def json(self):
        return {"choices": [{"message": {"content": '{"ok":true}'}}]}


class FakeStreamResponse:
    def __init__(self, lines):
        self._lines = lines
        self.headers = {"content-type": "text/event-stream"}

    def raise_for_status(self):
        return None

    def iter_lines(self):
        yield from self._lines


class FakeStreamContext:
    def __init__(self, response):
        self.response = response

    def __enter__(self):
        return self.response

    def __exit__(self, exc_type, exc, tb):
        return False


class FakeClient:
    last_json = None
    last_timeout = None
    used_stream = False

    def __init__(self, *, timeout):
        FakeClient.last_timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def post(self, url, *, headers, json):
        FakeClient.last_json = json
        return FakeResponse()

    def stream(self, method, url, *, headers, json):
        FakeClient.used_stream = True
        FakeClient.last_json = json
        lines = [
            'data: {"choices":[{"delta":{"reasoning_content":"thinking"}}]}',
            'data: {"choices":[{"delta":{"content":"{\\"ok\\":"}}]}',
            'data: {"choices":[{"delta":{"content":"true}"}}]}',
            'data: [DONE]',
        ]
        return FakeStreamContext(FakeStreamResponse(lines))


def test_generate_text_uses_streaming_and_concatenates_content(monkeypatch):
    FakeClient.used_stream = False
    monkeypatch.setattr("app.ark.httpx.Client", FakeClient)
    client = ArkClient(api_key="k", model="m", timeout_seconds=300)
    text = client.generate_text("system", "user")
    assert text == '{"ok":true}'
    assert FakeClient.used_stream is True
    assert FakeClient.last_json["stream"] is True
    assert FakeClient.last_timeout.read == 300
    assert FakeClient.last_timeout.connect == 30


def test_generate_json_timeout_error_includes_stage(monkeypatch):
    def fail(self, *args, **kwargs):
        raise ArkModelError("Ark read timed out after 300s")

    monkeypatch.setattr(ArkClient, "generate_text", fail)
    client = ArkClient(api_key="k", model="m", timeout_seconds=300)
    with pytest.raises(ArkModelError, match="story_bible"):
        client.generate_json("story_bible", "system", {"x": 1})

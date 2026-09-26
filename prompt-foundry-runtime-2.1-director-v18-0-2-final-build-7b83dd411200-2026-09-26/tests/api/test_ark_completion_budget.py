import pytest

from app.ark import ArkClient, ArkModelError


class FakeStreamResponse:
    def __init__(self, lines):
        self._lines = lines

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


class SequenceClient:
    calls = []
    streams = []

    def __init__(self, *, timeout):
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, *, headers, json):
        SequenceClient.calls.append(json)
        lines = SequenceClient.streams.pop(0)
        return FakeStreamContext(FakeStreamResponse(lines))


def test_stream_length_without_content_reports_completion_budget(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=16384)
    with pytest.raises(ArkModelError, match="completion token budget") as exc:
        client.generate_text("system", "user")
    assert "finish_reason=length" in str(exc.value)
    assert "reasoning_chars=" in str(exc.value)
    assert SequenceClient.calls[0]["max_completion_tokens"] == 16384


def test_generate_json_recovers_once_when_stream_stops_after_reasoning_only(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [
        [
            'data: {"choices":[{"delta":{"reasoning_content":"analysis"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
        ],
        [
            'data: {"choices":[{"delta":{"content":"{\\"scenes\\":[]}"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
        ],
    ]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=16384)
    result = client.generate_json("scene_plan", "Return JSON only.", {"story_bible": {}})
    assert result == {"scenes": []}
    assert len(SequenceClient.calls) == 2
    assert "FINAL JSON" in SequenceClient.calls[1]["messages"][0]["content"]


def test_stream_content_filter_without_content_is_specific_error(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{},"finish_reason":"content_filter"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m")
    with pytest.raises(ArkModelError, match="content_filter"):
        client.generate_text("system", "user")



def test_generate_json_recovers_reasoning_only_when_finish_reason_is_missing(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [
        [
            'data: {"choices":[{"delta":{"reasoning_content":"analysis"},"finish_reason":null}]}',
            'data: [DONE]',
        ],
        [
            'data: {"choices":[{"delta":{"content":"{\\"scenes\\":[]}"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: [DONE]',
        ],
    ]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=16384)
    result = client.generate_json("scene_plan", "Return JSON only.", {"story_bible": {}})
    assert result == {"scenes": []}
    assert len(SequenceClient.calls) == 2


def test_generate_json_requests_json_mode(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"content":"{\\"scenes\\":[]}"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=16384)
    assert client.generate_json("scene_plan", "JSON output required.", {"output_contract": {}}) == {"scenes": []}
    assert SequenceClient.calls[0]["response_format"] == {"type": "json_object"}
    assert SequenceClient.calls[0]["max_completion_tokens"] == 16384


def test_structural_json_stages_disable_deep_thinking(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"content":"{\\"scene\\":{\\"shots\\":[]}}"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    result = client.generate_json("storyboard_scene", "Return JSON only.", {"output_contract": {}})
    assert result == {"scene": {"shots": []}}
    assert SequenceClient.calls[0]["thinking"] == {"type": "disabled"}


def test_director_high_fanout_json_stage_uses_deterministic_provider_settings(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"content":"{\\"director\\":{}}"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    result = client.generate_json("director_shot", "Return JSON only.", {"output_contract": {}})
    assert result == {"director": {}}
    call = SequenceClient.calls[0]
    assert call["thinking"] == {"type": "disabled"}
    assert call["temperature"] == 0.0
    assert call["max_completion_tokens"] == 6144


def test_length_error_with_reasoning_points_to_deep_thinking_not_only_more_tokens(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    with pytest.raises(ArkModelError) as exc:
        client.generate_text("system", "user")
    message = str(exc.value)
    assert "deep thinking" in message.lower() or "深度思考" in message
    assert "reasoning_chars=" in message


def test_structural_json_stages_use_zero_temperature(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"content":"{\\"scene\\":{\\"shots\\":[]}}"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    client.generate_json("storyboard_scene", "Return JSON only.", {"output_contract": {}})
    assert SequenceClient.calls[0]["temperature"] == 0.0


def test_visual_design_json_stage_uses_deterministic_provider_settings(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"content":"{\\"production_visual\\":{}}"},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    result = client.generate_json("psb_scene", "Return JSON only.", {"output_contract": {}})
    assert result == {"production_visual": {}}
    call = SequenceClient.calls[0]
    assert call["thinking"] == {"type": "disabled"}
    assert call["temperature"] == 0.0
    assert call["max_completion_tokens"] == 6144


def test_length_error_when_thinking_was_disabled_reports_provider_ignored_or_unsupported(monkeypatch):
    SequenceClient.calls = []
    SequenceClient.streams = [[
        'data: {"choices":[{"delta":{"reasoning_content":"thinking..."},"finish_reason":null}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}',
        'data: [DONE]',
    ]]
    monkeypatch.setattr("app.ark.httpx.Client", SequenceClient)

    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    with pytest.raises(ArkModelError) as exc:
        client.generate_text("system", "user", thinking_type="disabled")
    message = str(exc.value).lower()
    assert "thinking=disabled" in message
    assert "provider" in message or "endpoint" in message or "模型" in message


def test_generate_json_prefers_provider_json_schema_when_template_is_available(monkeypatch):
    calls = []

    def fake_generate_text(self, system_prompt, user_prompt, **kwargs):
        calls.append(kwargs)
        return '{"scenes":[]}'

    monkeypatch.setattr(ArkClient, "generate_text", fake_generate_text)
    client = ArkClient(api_key="k", model="m")
    result = client.generate_json(
        "scene_plan",
        "Return JSON only.",
        {"output_template": {"scenes": [{"source_refs": ["SRC0001"], "continuous_with_previous": False}] }},
    )
    assert result == {"scenes": []}
    response_format = calls[0]["response_format"]
    assert response_format["type"] == "json_schema"
    schema = response_format["json_schema"]["schema"]
    assert schema["required"] == ["scenes"]


def test_generate_json_schema_capability_error_falls_back_and_is_remembered(monkeypatch):
    from app.ark import ArkPermanentError

    calls = []

    def fake_generate_text(self, system_prompt, user_prompt, **kwargs):
        calls.append(kwargs)
        if (kwargs.get("response_format") or {}).get("type") == "json_schema":
            raise ArkPermanentError(
                "response_format json_schema unsupported",
                kind="provider_http_permanent",
                status_code=400,
                provider_message="json_schema is not supported",
            )
        return '{"scenes":[]}'

    monkeypatch.setattr(ArkClient, "generate_text", fake_generate_text)
    client = ArkClient(api_key="k", model="m")
    payload = {"output_template": {"scenes": []}}
    assert client.generate_json("scene_plan", "Return JSON only.", payload) == {"scenes": []}
    assert calls[0]["response_format"]["type"] == "json_schema"
    assert calls[1]["response_format"] is None
    assert calls[1]["json_mode"] is True
    assert client._json_schema_supported is False

    calls.clear()
    assert client.generate_json("scene_plan", "Return JSON only.", payload) == {"scenes": []}
    assert len(calls) == 1
    assert calls[0]["response_format"] is None
    assert calls[0]["json_mode"] is True


def test_production_semantics_provider_schema_uses_raw_model_envelope():
    from runtime.stages.production_semantics import build_production_semantics_payload
    from runtime.model_schema import provider_json_schema

    payload = build_production_semantics_payload(
        {"shot": {}, "assets": {}, "program_owned": {}}, unit_id="production_semantics:SH001"
    )
    schema_format = provider_json_schema(
        "production_semantics_shot", payload["provider_output_template"]
    )
    schema = schema_format["json_schema"]["schema"]
    assert schema["required"] == ["production_semantics"]
    inner = schema["properties"]["production_semantics"]
    assert "dialogue" not in inner.get("properties", {})


def test_provider_output_template_is_transport_only_and_not_sent_in_user_prompt(monkeypatch):
    seen = {}

    def fake_generate_text(self, system_prompt, user_prompt, **kwargs):
        seen['user_prompt'] = user_prompt
        seen['response_format'] = kwargs.get('response_format')
        return '{"director":{}}'

    monkeypatch.setattr(ArkClient, 'generate_text', fake_generate_text)
    client = ArkClient(api_key='k', model='m')
    payload = {
        'output_template': {'director': {'continuity_scope': {'mode': 'inherit', 'inherit_paths': []}}},
        'provider_output_template': {'director': {'continuity_scope': {'mode': 'inherit', 'inherit_paths': ['characters.char_001.position']}}},
    }
    assert client.generate_json('director_shot', 'Return JSON only.', payload) == {'director': {}}
    assert 'provider_output_template' not in seen['user_prompt']
    assert seen['response_format']['json_schema']['schema']['required'] == ['director']

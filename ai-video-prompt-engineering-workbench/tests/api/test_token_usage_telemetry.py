from __future__ import annotations

import copy

from app.ark import ArkClient
from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from tests.api.fixtures.mock_story_run import MockModel


class _FakeStreamResponse:
    def __init__(self, lines):
        self._lines = lines

    def raise_for_status(self):
        return None

    def iter_lines(self):
        yield from self._lines


class _FakeStreamContext:
    def __init__(self, response):
        self.response = response

    def __enter__(self):
        return self.response

    def __exit__(self, exc_type, exc, tb):
        return False


class _UsageClient:
    calls = []

    def __init__(self, *, timeout):
        self.timeout = timeout

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def stream(self, method, url, *, headers, json):
        _UsageClient.calls.append(copy.deepcopy(json))
        return _FakeStreamContext(_FakeStreamResponse([
            'data: {"choices":[{"delta":{"content":"{\\"ok\\":true}"},"finish_reason":null}]}',
            'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}',
            'data: {"choices":[],"usage":{"prompt_tokens":123,"completion_tokens":17,"total_tokens":140}}',
            'data: [DONE]',
        ]))


def test_ark_stream_usage_chunk_is_preserved_and_json_payload_is_compact(monkeypatch):
    _UsageClient.calls = []
    monkeypatch.setattr("app.ark.httpx.Client", _UsageClient)
    client = ArkClient(api_key="k", model="m", min_request_interval_seconds=0)
    result = client.generate_json("story_bible", "system", {"a": {"b": [1, 2]}, "中文": "值"})
    assert result == {"ok": True}
    usage = client.consume_last_usage()
    assert usage["requests"] == 1
    assert usage["prompt_tokens"] == 123
    assert usage["completion_tokens"] == 17
    assert usage["total_tokens"] == 140
    call = _UsageClient.calls[0]
    assert call["stream_options"] == {"include_usage": True}
    user_prompt = call["messages"][1]["content"]
    assert user_prompt == '{"a":{"b":[1,2]},"中文":"值"}'
    assert "\n" not in user_prompt


class _MeteredMockModel(MockModel):
    def __init__(self):
        super().__init__()
        self._usage = {}

    def generate_json(self, stage, system_prompt, user_payload):
        result = super().generate_json(stage, system_prompt, user_payload)
        self._usage = {
            "requests": 1,
            "prompt_tokens": 100,
            "completion_tokens": 20,
            "total_tokens": 120,
            "input_chars": len(system_prompt) + len(str(user_payload)),
            "output_chars": len(str(result)),
        }
        return result

    def consume_last_usage(self):
        usage = self._usage
        self._usage = {}
        return usage


def test_runtime_aggregates_real_model_usage_by_stage_and_unit(tmp_path):
    store = RunStore(tmp_path / "runs")
    checkpoints = CheckpointStore(tmp_path / "checkpoints")
    runtime = RuntimeV20(model=_MeteredMockModel(), store=store, checkpoints=checkpoints)
    run = runtime.start("阿宁站在窗边，手里拿着信封。", "token-usage")
    assert run["status"] == "completed"
    ledger = run["token_usage"]
    assert ledger["requests"] > 0
    assert ledger["prompt_tokens"] == ledger["requests"] * 100
    assert ledger["completion_tokens"] == ledger["requests"] * 20
    assert ledger["total_tokens"] == ledger["requests"] * 120
    assert ledger["by_stage"]["director"]["requests"] >= 1
    assert run["units"]["story_bible"]["attempts"][0]["usage"]["total_tokens"] == 120


class _RepairMeterModel:
    def __init__(self):
        self.n = 0
        self._usage = {}

    def generate_json(self, stage, system_prompt, payload):
        self.n += 1
        self._usage = {
            "requests": 1, "prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12,
            "input_chars": len(system_prompt) + len(str(payload)), "output_chars": 20,
        }
        return {"scene": {"ok": self.n > 1}}

    def consume_last_usage(self):
        value = self._usage
        self._usage = {}
        return value


def test_runtime_counts_repair_usage_separately(tmp_path):
    model = _RepairMeterModel()
    runtime = RuntimeV20(
        model=model, store=RunStore(tmp_path / "runs"), checkpoints=CheckpointStore(tmp_path / "checkpoints")
    )
    run = runtime.create("测试文本", "repair-meter")
    result = runtime._execute_unit(
        run, unit_id="storyboard:SC001", stage="storyboard", model_stage="storyboard_scene",
        payload={"unit_id": "storyboard:SC001"}, prompt="test", extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "must_fix"}], 0),
        enforce_model_envelope=True,
    )
    assert result == {"ok": True}
    assert run["token_usage"]["requests"] == 2
    assert run["token_usage"]["repair_requests"] == 1
    assert run["token_usage"]["total_tokens"] == 24
    assert run["token_usage"]["by_stage"]["storyboard"]["repair_requests"] == 1

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from app.ark import ArkClient, ArkModelError


class _RetryHandler(BaseHTTPRequestHandler):
    calls = 0
    statuses = [429, 429, 200]

    def do_POST(self):
        type(self).calls += 1
        index = min(type(self).calls - 1, len(type(self).statuses) - 1)
        status = type(self).statuses[index]
        self.rfile.read(int(self.headers.get("content-length", "0")))
        self.send_response(status)
        if status == 429:
            self.send_header("Retry-After", "0")
            self.end_headers()
            self.wfile.write(b'rate limited')
            return
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()
        event = {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}
        self.wfile.write(("data: " + json.dumps(event) + "\n\n").encode())
        self.wfile.write(b"data: [DONE]\n\n")

    def log_message(self, format, *args):
        return


def _serve(handler):
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def test_ark_retries_429_inside_transport_layer_without_semantic_repair():
    _RetryHandler.calls = 0
    _RetryHandler.statuses = [429, 429, 200]
    server, thread = _serve(_RetryHandler)
    try:
        client = ArkClient(
            api_key="k", model="m", base_url=f"http://127.0.0.1:{server.server_port}",
            max_transport_retries=2, retry_base_seconds=0, retry_max_seconds=0,
        )
        assert client.generate_text("system", "user") == "ok"
        assert _RetryHandler.calls == 3
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_ark_does_not_retry_permanent_http_error():
    _RetryHandler.calls = 0
    _RetryHandler.statuses = [400]
    server, thread = _serve(_RetryHandler)
    try:
        client = ArkClient(
            api_key="k", model="m", base_url=f"http://127.0.0.1:{server.server_port}",
            max_transport_retries=3, retry_base_seconds=0, retry_max_seconds=0,
        )
        with pytest.raises(ArkModelError) as caught:
            client.generate_text("system", "user")
        assert caught.value.retryable is False
        assert caught.value.status_code == 400
        assert _RetryHandler.calls == 1
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_retry_after_is_provider_authority_not_truncated_by_local_backoff_cap():
    client = ArkClient(
        api_key="k", model="m", retry_base_seconds=1, retry_max_seconds=8,
        min_request_interval_seconds=0,
    )
    assert client._backoff_seconds(1, 60) == 60


def test_high_fanout_json_stages_use_bounded_completion_budgets():
    client = ArkClient(api_key="k", model="m", max_completion_tokens=32768)
    assert client._stage_completion_budget("pvb_character") == 6144
    assert client._stage_completion_budget("psb_scene") == 6144
    assert client._stage_completion_budget("style_guide") == 4096
    assert client._stage_completion_budget("production_semantics_shot") == 4096
    assert client._stage_completion_budget("director_shot") == 6144
    # Whole-project / low-fanout stages still use the configured global ceiling.
    assert client._stage_completion_budget("story_bible") == 32768


class _Typed429Handler(BaseHTTPRequestHandler):
    calls = 0
    code = "QuotaExceeded"
    message = "trial quota exhausted. Request ID: req-test-429"

    def do_POST(self):
        type(self).calls += 1
        self.rfile.read(int(self.headers.get("content-length", "0")))
        self.send_response(429)
        self.send_header("Content-Type", "application/json")
        self.send_header("Retry-After", "0")
        self.send_header("x-request-id", "req-header-429")
        self.end_headers()
        self.wfile.write(json.dumps({
            "error": {"code": type(self).code, "message": type(self).message, "type": "TooManyRequests"}
        }).encode())

    def log_message(self, format, *args):
        return


def test_ark_quota_429_is_non_retryable_and_preserves_provider_diagnostics():
    _Typed429Handler.calls = 0
    _Typed429Handler.code = "QuotaExceeded"
    _Typed429Handler.message = "trial quota exhausted"
    server, thread = _serve(_Typed429Handler)
    try:
        client = ArkClient(
            api_key="k", model="m", base_url=f"http://127.0.0.1:{server.server_port}",
            max_transport_retries=5, retry_base_seconds=0, retry_max_seconds=0,
        )
        with pytest.raises(ArkModelError) as caught:
            client.generate_text("system", "user")
        exc = caught.value
        assert exc.kind == "provider_quota_exhausted"
        assert exc.retryable is False
        assert exc.provider_code == "QuotaExceeded"
        assert exc.provider_message == "trial quota exhausted"
        assert exc.request_id == "req-header-429"
        assert exc.transport_attempts == 1
        assert _Typed429Handler.calls == 1
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_ark_tpm_429_uses_one_window_retry_then_surfaces_exact_reason():
    _Typed429Handler.calls = 0
    _Typed429Handler.code = "RateLimitExceeded.EndpointTPMExceeded"
    _Typed429Handler.message = "endpoint TPM exceeded"
    server, thread = _serve(_Typed429Handler)
    try:
        client = ArkClient(
            api_key="k", model="m", base_url=f"http://127.0.0.1:{server.server_port}",
            max_transport_retries=5, retry_base_seconds=0, retry_max_seconds=0,
        )
        with pytest.raises(ArkModelError) as caught:
            client.generate_text("system", "user")
        exc = caught.value
        assert exc.kind == "provider_tpm_rate_limited"
        assert exc.retryable is True
        assert exc.provider_code == "RateLimitExceeded.EndpointTPMExceeded"
        assert exc.transport_attempts == 2
        assert _Typed429Handler.calls == 2
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_ark_set_limit_exceeded_is_non_retryable_and_actionable():
    _Typed429Handler.calls = 0
    _Typed429Handler.code = "SetLimitExceeded"
    _Typed429Handler.message = (
        "Your account has reached the set inference limit for the model, "
        "and the model service has been paused. To continue using this model, "
        "please adjust or close the Safe Experience Mode."
    )
    server, thread = _serve(_Typed429Handler)
    try:
        client = ArkClient(
            api_key="k", model="m", base_url=f"http://127.0.0.1:{server.server_port}",
            max_transport_retries=5, retry_base_seconds=0, retry_max_seconds=0,
        )
        with pytest.raises(ArkModelError) as caught:
            client.generate_text("system", "user")
        exc = caught.value
        assert exc.kind == "provider_inference_limit_reached"
        assert exc.retryable is False
        assert exc.provider_code == "SetLimitExceeded"
        assert exc.transport_attempts == 1
        assert "Safe Experience Mode" in str(exc)
        assert _Typed429Handler.calls == 1
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_ark_set_limit_message_fallback_is_non_retryable_even_without_provider_code():
    _Typed429Handler.calls = 0
    _Typed429Handler.code = ""
    _Typed429Handler.message = "model service paused after reaching the set inference limit"
    server, thread = _serve(_Typed429Handler)
    try:
        client = ArkClient(
            api_key="k", model="m", base_url=f"http://127.0.0.1:{server.server_port}",
            max_transport_retries=5, retry_base_seconds=0, retry_max_seconds=0,
        )
        with pytest.raises(ArkModelError) as caught:
            client.generate_text("system", "user")
        assert caught.value.kind == "provider_inference_limit_reached"
        assert caught.value.retryable is False
        assert caught.value.transport_attempts == 1
        assert _Typed429Handler.calls == 1
    finally:
        server.shutdown()
        thread.join(timeout=2)

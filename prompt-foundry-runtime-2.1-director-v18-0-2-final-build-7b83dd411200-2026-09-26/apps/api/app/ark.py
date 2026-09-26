from __future__ import annotations

import json
import os
import re
import time
import threading
from dataclasses import dataclass, field
from email.utils import parsedate_to_datetime
from typing import Any, Iterable
from datetime import datetime, timezone

import httpx

from runtime.model_schema import provider_json_schema


STRUCTURED_NO_THINKING_STAGES = {
    "story_bible",
    "scene_plan",
    "script_scene",
    "storyboard_scene",
    "storyboard_redistribution_fragment",
    "pvb_character",
    "psb_scene",
    "style_guide",
    "production_semantics_shot",
    "director_scene_context",
    "director_shot",
}

# High-fanout Units must not reserve the same 32K completion budget as whole-project
# stages. The global config is still the hard ceiling; these are per-stage safety caps.
STAGE_COMPLETION_TOKEN_CAPS = {
    "pvb_character": 6144,
    "psb_scene": 6144,
    "style_guide": 4096,
    "production_semantics_shot": 4096,
    "director_scene_context": 4096,
    "director_shot": 6144,
    "storyboard_redistribution_fragment": 4096,
}

TRANSIENT_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504}


class ArkConfigurationError(RuntimeError):
    pass


class ArkModelError(RuntimeError):
    """Provider/model error with machine-readable failure classification.

    Runtime semantic Repair must never be used for provider transport/capacity failures.
    This metadata lets the orchestrator persist the correct failure layer.
    """

    def __init__(
        self,
        message: str,
        *,
        kind: str = "provider_model_error",
        retryable: bool = False,
        status_code: int | None = None,
        transport_attempts: int = 1,
        provider_code: str | None = None,
        provider_message: str | None = None,
        request_id: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(message)
        self.kind = kind
        self.retryable = retryable
        self.status_code = status_code
        self.transport_attempts = transport_attempts
        self.provider_code = provider_code
        self.provider_message = provider_message
        self.request_id = request_id
        self.retry_after_seconds = retry_after_seconds


class ArkTransientError(ArkModelError):
    def __init__(
        self,
        message: str,
        *,
        kind: str,
        status_code: int | None = None,
        transport_attempts: int = 1,
        provider_code: str | None = None,
        provider_message: str | None = None,
        request_id: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(
            message,
            kind=kind,
            retryable=True,
            status_code=status_code,
            transport_attempts=transport_attempts,
            provider_code=provider_code,
            provider_message=provider_message,
            request_id=request_id,
            retry_after_seconds=retry_after_seconds,
        )


class ArkPermanentError(ArkModelError):
    def __init__(
        self,
        message: str,
        *,
        kind: str,
        status_code: int | None = None,
        transport_attempts: int = 1,
        provider_code: str | None = None,
        provider_message: str | None = None,
        request_id: str | None = None,
        retry_after_seconds: float | None = None,
    ) -> None:
        super().__init__(
            message,
            kind=kind,
            retryable=False,
            status_code=status_code,
            transport_attempts=transport_attempts,
            provider_code=provider_code,
            provider_message=provider_message,
            request_id=request_id,
            retry_after_seconds=retry_after_seconds,
        )


class ArkNoFinalContentError(ArkModelError):
    def __init__(self, message: str, *, finish_reason: str | None, reasoning_chars: int) -> None:
        super().__init__(message, kind="provider_no_final_content", retryable=False)
        self.finish_reason = finish_reason
        self.reasoning_chars = reasoning_chars


@dataclass(slots=True)
class ArkStreamResult:
    content: str
    reasoning_chars: int
    finish_reason: str | None
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


def extract_json_object(text: str) -> dict[str, Any]:
    raw = (text or "").strip()
    fence = re.fullmatch(r"```(?:json)?\s*(.*?)\s*```", raw, flags=re.DOTALL | re.IGNORECASE)
    if fence:
        raw = fence.group(1).strip()
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        start = raw.find("{")
        end = raw.rfind("}")
        if start < 0 or end <= start:
            raise ArkPermanentError("model response did not contain a JSON object", kind="invalid_json")
        try:
            value = json.loads(raw[start : end + 1])
        except json.JSONDecodeError as exc:
            raise ArkPermanentError(f"model returned invalid JSON: {exc}", kind="invalid_json") from exc
    if not isinstance(value, dict):
        raise ArkPermanentError("model JSON root must be an object", kind="invalid_json_root")
    return value


def _collect_sse_result(lines: Iterable[str]) -> ArkStreamResult:
    chunks: list[str] = []
    reasoning_chars = 0
    finish_reason: str | None = None
    prompt_tokens = 0
    completion_tokens = 0
    total_tokens = 0

    for raw_line in lines:
        line = (raw_line or "").strip()
        if not line or line.startswith(":") or not line.startswith("data:"):
            continue
        data_text = line[5:].strip()
        if data_text == "[DONE]":
            break
        try:
            event = json.loads(data_text)
        except json.JSONDecodeError:
            continue
        usage = event.get("usage")
        if isinstance(usage, dict):
            try:
                prompt_tokens = max(prompt_tokens, int(usage.get("prompt_tokens") or 0))
                completion_tokens = max(completion_tokens, int(usage.get("completion_tokens") or 0))
                total_tokens = max(total_tokens, int(usage.get("total_tokens") or 0))
            except (TypeError, ValueError):
                pass
        choices = event.get("choices") or []
        if not choices:
            continue
        choice = choices[0] or {}
        if choice.get("finish_reason") is not None:
            finish_reason = str(choice.get("finish_reason"))
        delta = choice.get("delta") or {}
        reasoning = delta.get("reasoning_content")
        if isinstance(reasoning, str) and reasoning:
            reasoning_chars += len(reasoning)
        content = delta.get("content")
        if isinstance(content, str) and content:
            chunks.append(content)

    return ArkStreamResult(
        content="".join(chunks),
        reasoning_chars=reasoning_chars,
        finish_reason=finish_reason,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        total_tokens=total_tokens or (prompt_tokens + completion_tokens),
    )





def _compact_json(value: Any) -> str:
    """Provider payload JSON: preserve Unicode, remove formatting-only whitespace."""
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

def _provider_error_payload(response: httpx.Response | None) -> tuple[str, str | None, str | None, str | None]:
    if response is None:
        return "", None, None, None
    try:
        raw = response.read().decode("utf-8", errors="replace")
    except Exception:
        raw = ""
    body = raw[:2000]
    provider_code: str | None = None
    provider_message: str | None = None
    request_id = (
        response.headers.get("x-request-id")
        or response.headers.get("x-tt-logid")
        or response.headers.get("x-log-id")
    )
    if raw:
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            error = payload.get("error")
            if isinstance(error, dict):
                code = error.get("code")
                message = error.get("message")
                if code not in (None, ""):
                    provider_code = str(code)
                if message not in (None, ""):
                    provider_message = str(message)
                embedded_id = error.get("request_id") or error.get("requestId")
                if embedded_id not in (None, ""):
                    request_id = request_id or str(embedded_id)
    if request_id is None and provider_message:
        match = re.search(r"request[ _-]?id\s*[:=]\s*([A-Za-z0-9_-]+)", provider_message, flags=re.I)
        if match:
            request_id = match.group(1)
    return body, provider_code, provider_message, request_id


def _classify_429(
    provider_code: str | None,
    provider_message: str | None = None,
) -> tuple[str, bool, str]:
    code = (provider_code or "").strip()
    lowered = code.lower()
    message_lowered = (provider_message or "").lower()

    # Ark Safe Experience Mode / account-set inference ceiling. This is a
    # suspended-service condition, not a transient RPM/TPM rate limit. Retrying
    # cannot recover until the account/model activation setting is changed.
    if (
        code == "SetLimitExceeded"
        or "setlimitexceeded" in lowered
        or "set inference limit" in message_lowered
        or "safe experience mode" in message_lowered
    ):
        return (
            "provider_inference_limit_reached",
            False,
            "Ark 已达到该账户为当前模型设置的推理上限，模型服务已暂停；继续重试不会恢复。"
            "请到火山方舟模型激活/开通管理页面调整该模型的推理上限，或关闭“安心体验模式 / Safe Experience Mode”。"
            "关闭保护后可能进入按量计费，请先确认账户余额和费用设置。",
        )
    if code == "QuotaExceeded" or "quotaexceeded" in lowered:
        return (
            "provider_quota_exhausted",
            False,
            "Ark 配额已经耗尽；继续重试无法恢复。请检查模型是否已开通、试用/安心体验状态、账户计费状态和模型配额。",
        )
    if "tpm" in lowered:
        return (
            "provider_tpm_rate_limited",
            True,
            "Ark TPM（每分钟 Token）已超限。Story Bible 这类大输入在第一次请求就可能触发；需要等待 Token 窗口重置、降低单次 Token 需求，或提高模型/接入点 TPM 配额。",
        )
    if "rpm" in lowered:
        return (
            "provider_rpm_rate_limited",
            True,
            "Ark RPM（每分钟请求数）已超限。请等待请求窗口重置，或提高模型/接入点 RPM 配额。",
        )
    if code == "RequestBurstTooFast" or "burst" in lowered:
        return (
            "provider_request_burst",
            True,
            "Ark 触发了突发流量保护。请求需要更平缓地发送，不能在短时间内连续重试。",
        )
    if code == "ServerOverloaded" or "overloaded" in lowered:
        return (
            "provider_server_overloaded",
            True,
            "Ark 返回服务过载。这是 Provider 容量压力，不是 Prompt Foundry 阶段契约错误。",
        )
    if code == "ModelLoadingError" or "loading" in lowered:
        return (
            "provider_model_loading",
            True,
            "Ark 模型正在加载。等待 Provider 就绪后再重试。",
        )
    return (
        "provider_rate_limited",
        True,
        "Ark 返回 HTTP 429，但没有识别到更具体的错误码。应先查看 provider_code、provider_message 和 request_id，不要先改工作流 Prompt。",
    )


def _copy_provider_metadata(exc: ArkModelError) -> dict[str, Any]:
    return {
        "provider_code": getattr(exc, "provider_code", None),
        "provider_message": getattr(exc, "provider_message", None),
        "request_id": getattr(exc, "request_id", None),
        "retry_after_seconds": getattr(exc, "retry_after_seconds", None),
    }

def _retry_after_seconds(response: httpx.Response | None) -> float | None:
    if response is None:
        return None
    raw = str(response.headers.get("Retry-After") or "").strip()
    if not raw:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        try:
            when = parsedate_to_datetime(raw)
            if when.tzinfo is None:
                when = when.replace(tzinfo=timezone.utc)
            return max(0.0, (when - datetime.now(timezone.utc)).total_seconds())
        except Exception:
            return None


@dataclass(slots=True)
class ArkClient:
    api_key: str
    model: str
    base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    timeout_seconds: float = 300.0
    max_completion_tokens: int = 32768
    max_transport_retries: int = 5
    retry_base_seconds: float = 2.0
    retry_max_seconds: float = 30.0
    min_request_interval_seconds: float = 0.75
    _request_lock: threading.Lock = field(default_factory=threading.Lock, init=False, repr=False)
    _next_request_at: float = field(default=0.0, init=False, repr=False)
    _usage_local: threading.local = field(default_factory=threading.local, init=False, repr=False)
    _json_schema_supported: bool | None = field(default=None, init=False, repr=False)

    @classmethod
    def from_env(cls) -> "ArkClient":
        api_key = os.getenv("ARK_API_KEY", "").strip()
        model = os.getenv("ARK_MODEL", "").strip()
        if not api_key or not model:
            raise ArkConfigurationError("ARK_API_KEY and ARK_MODEL are required")
        base_url = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        try:
            timeout = float(os.getenv("ARK_TIMEOUT_SECONDS", "300"))
        except ValueError:
            timeout = 300.0
        try:
            max_completion_tokens = int(os.getenv("ARK_MAX_COMPLETION_TOKENS", "32768"))
        except ValueError:
            max_completion_tokens = 32768
        try:
            max_transport_retries = max(0, int(os.getenv("ARK_MAX_TRANSPORT_RETRIES", "5")))
        except ValueError:
            max_transport_retries = 5
        try:
            retry_base_seconds = max(0.0, float(os.getenv("ARK_RETRY_BASE_SECONDS", "2")))
        except ValueError:
            retry_base_seconds = 2.0
        try:
            retry_max_seconds = max(retry_base_seconds, float(os.getenv("ARK_RETRY_MAX_SECONDS", "30")))
        except ValueError:
            retry_max_seconds = max(30.0, retry_base_seconds)
        try:
            min_request_interval_seconds = max(0.0, float(os.getenv("ARK_MIN_REQUEST_INTERVAL_SECONDS", "0.75")))
        except ValueError:
            min_request_interval_seconds = 0.75
        return cls(
            api_key=api_key,
            model=model,
            base_url=base_url,
            timeout_seconds=timeout,
            max_completion_tokens=max_completion_tokens,
            max_transport_retries=max_transport_retries,
            retry_base_seconds=retry_base_seconds,
            retry_max_seconds=retry_max_seconds,
            min_request_interval_seconds=min_request_interval_seconds,
        )

    def _backoff_seconds(self, attempt: int, retry_after: float | None) -> float:
        # Retry-After is provider authority. It must not be truncated by the local
        # exponential-backoff ceiling; doing so causes a deterministic 429 loop.
        if retry_after is not None:
            return max(0.0, retry_after)
        return min(self.retry_max_seconds, self.retry_base_seconds * (2 ** max(0, attempt - 1)))

    def _wait_for_request_slot_locked(self) -> None:
        delay = max(0.0, self._next_request_at - time.monotonic())
        if delay > 0:
            time.sleep(delay)

    def _mark_request_finished_locked(self) -> None:
        self._next_request_at = time.monotonic() + max(0.0, self.min_request_interval_seconds)

    def _stage_completion_budget(self, stage: str) -> int:
        cap = STAGE_COMPLETION_TOKEN_CAPS.get(stage)
        return min(self.max_completion_tokens, cap) if cap is not None else self.max_completion_tokens

    def _reset_call_usage(self) -> None:
        self._usage_local.current = {
            "requests": 0, "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0,
            "input_chars": 0, "output_chars": 0,
        }

    def _record_stream_usage(self, result: ArkStreamResult, *, input_chars: int = 0) -> None:
        current = getattr(self._usage_local, "current", None)
        if not isinstance(current, dict):
            return
        current["requests"] += 1
        current["prompt_tokens"] += int(result.prompt_tokens or 0)
        current["completion_tokens"] += int(result.completion_tokens or 0)
        current["total_tokens"] += int(result.total_tokens or (result.prompt_tokens + result.completion_tokens) or 0)
        current["input_chars"] += max(0, int(input_chars or 0))
        current["output_chars"] += len(result.content or "")

    def consume_last_usage(self) -> dict[str, int]:
        current = getattr(self._usage_local, "current", None)
        self._usage_local.current = None
        if not isinstance(current, dict):
            return {}
        return {str(k): int(v or 0) for k, v in current.items()}

    def _stream_once(self, url: str, headers: dict[str, str], payload: dict[str, Any]) -> ArkStreamResult:
        timeout = httpx.Timeout(connect=30.0, read=self.timeout_seconds, write=60.0, pool=30.0)
        with httpx.Client(timeout=timeout) as client:
            with client.stream("POST", url, headers=headers, json=payload) as response:
                # Cache provider error bodies before the streaming context closes.
                # Otherwise HTTPStatusError escapes, the stream is closed, and the
                # outer retry layer loses Ark's structured error code/message.
                status_code = getattr(response, "status_code", None)
                if status_code is not None and int(status_code) >= 400:
                    response.read()
                    response.raise_for_status()
                else:
                    response.raise_for_status()
                return _collect_sse_result(response.iter_lines())

    def _request_stream(self, url: str, headers: dict[str, str], payload: dict[str, Any]) -> ArkStreamResult:
        # The local app can execute multiple runs in worker threads while all runs share
        # the same Ark quota. Serialize provider calls on this client and keep one small
        # inter-request gap. This is deliberately conservative: reliability beats burst
        # throughput for a local production pipeline with 100+ model Units per run.
        with self._request_lock:
            self._wait_for_request_slot_locked()
            max_attempts = self.max_transport_retries + 1
            last_error: ArkModelError | None = None
            try:
                for attempt in range(1, max_attempts + 1):
                    try:
                        result = self._stream_once(url, headers, payload)
                        return result
                    except httpx.HTTPStatusError as exc:
                        response = exc.response
                        status = response.status_code if response is not None else None
                        body, provider_code, provider_message, request_id = _provider_error_payload(response)
                        retry_after = _retry_after_seconds(response)
                        detail = f" HTTP {status if status is not None else 'unknown'}"
                        if provider_code:
                            detail += f" [{provider_code}]"
                        if provider_message:
                            detail += f": {provider_message}"
                        elif body:
                            detail += f": {body[:500]}"
                        if request_id:
                            detail += f" (request_id={request_id})"

                        if status == 429:
                            kind, retryable, guidance = _classify_429(provider_code, provider_message)
                            error_cls = ArkTransientError if retryable else ArkPermanentError
                            last_error = error_cls(
                                f"Ark request failed:{detail}. {guidance}",
                                kind=kind,
                                status_code=status,
                                transport_attempts=attempt,
                                provider_code=provider_code,
                                provider_message=provider_message,
                                request_id=request_id,
                                retry_after_seconds=retry_after,
                            )
                            if not retryable:
                                raise last_error from exc

                            # RPM/TPM are window limits, not millisecond burst errors. Repeated
                            # 2/4/8-second retries only waste requests and can prolong the limit.
                            # Without a provider Retry-After, wait one full minute and make only
                            # one recovery attempt, then surface the exact provider diagnosis.
                            bucket_limit = kind in {"provider_rpm_rate_limited", "provider_tpm_rate_limited"}
                            if bucket_limit and attempt >= 2:
                                raise last_error from exc
                            if attempt < max_attempts:
                                delay = retry_after if retry_after is not None else (60.0 if bucket_limit else self._backoff_seconds(attempt, None))
                                if delay > 0:
                                    time.sleep(delay)
                                continue
                            raise last_error from exc

                        if status in TRANSIENT_HTTP_STATUSES:
                            last_error = ArkTransientError(
                                f"Ark request failed:{detail}",
                                kind="provider_http_transient",
                                status_code=status,
                                transport_attempts=attempt,
                                provider_code=provider_code,
                                provider_message=provider_message,
                                request_id=request_id,
                                retry_after_seconds=retry_after,
                            )
                            if attempt < max_attempts:
                                delay = self._backoff_seconds(attempt, retry_after)
                                if delay > 0:
                                    time.sleep(delay)
                                continue
                            raise last_error from exc
                        raise ArkPermanentError(
                            f"Ark request failed:{detail}",
                            kind="provider_http_permanent",
                            status_code=status,
                            transport_attempts=attempt,
                            provider_code=provider_code,
                            provider_message=provider_message,
                            request_id=request_id,
                            retry_after_seconds=retry_after,
                        ) from exc
                    except httpx.ReadTimeout as exc:
                        last_error = ArkTransientError(
                            f"Ark read timed out after {self.timeout_seconds:g}s without receiving new stream data",
                            kind="provider_read_timeout",
                            transport_attempts=attempt,
                        )
                    except httpx.ConnectTimeout as exc:
                        last_error = ArkTransientError(
                            "Ark connection timed out after 30s",
                            kind="provider_connect_timeout",
                            transport_attempts=attempt,
                        )
                    except httpx.HTTPError as exc:
                        last_error = ArkTransientError(
                            f"Ark request failed: {exc}",
                            kind="provider_transport_error",
                            transport_attempts=attempt,
                        )
                    if last_error is not None:
                        if attempt < max_attempts:
                            delay = self._backoff_seconds(attempt, None)
                            if delay > 0:
                                time.sleep(delay)
                            continue
                        raise last_error
                raise last_error or ArkTransientError(
                    "Ark request failed", kind="provider_transport_error", transport_attempts=max_attempts
                )
            finally:
                self._mark_request_finished_locked()

    def generate_text(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        temperature: float = 0.2,
        json_mode: bool = False,
        response_format: dict[str, Any] | None = None,
        thinking_type: str | None = None,
        max_completion_tokens: int | None = None,
    ) -> str:
        url = f"{self.base_url.rstrip('/')}/chat/completions"
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": temperature,
            "stream": True,
            "stream_options": {"include_usage": True},
            "max_completion_tokens": int(max_completion_tokens or self.max_completion_tokens),
        }
        if thinking_type is not None:
            payload["thinking"] = {"type": thinking_type}
        if response_format is not None:
            payload["response_format"] = response_format
        elif json_mode:
            payload["response_format"] = {"type": "json_object"}

        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        result = self._request_stream(url, headers, payload)
        self._record_stream_usage(result, input_chars=len(system_prompt) + len(user_prompt))

        if result.finish_reason == "length":
            if result.reasoning_chars > 0 and thinking_type == "disabled":
                guidance = (
                    " Request used thinking=disabled, but the provider still returned reasoning_content; "
                    "verify that the current Ark endpoint/model supports and honors the thinking switch before increasing Max Completion Tokens."
                )
            elif result.reasoning_chars > 0:
                guidance = (
                    " Deep thinking consumed output budget; disable deep thinking for deterministic JSON stages before increasing Max Completion Tokens."
                )
            else:
                guidance = " Increase Max Completion Tokens only if the final JSON itself is genuinely too large."
            raise ArkPermanentError(
                "Ark generation exhausted the completion token budget "
                f"(finish_reason=length, max_completion_tokens={int(max_completion_tokens or self.max_completion_tokens)}, "
                f"reasoning_chars={result.reasoning_chars})." + guidance,
                kind="provider_completion_budget_exhausted",
            )
        if result.finish_reason == "content_filter":
            raise ArkPermanentError(
                "Ark generation stopped by content_filter before a usable final answer was produced",
                kind="provider_content_filter",
            )
        if result.content:
            return result.content
        if result.finish_reason == "stop" and result.reasoning_chars > 0:
            raise ArkNoFinalContentError(
                "Ark stream ended normally after reasoning but produced no final assistant content "
                f"(finish_reason=stop, reasoning_chars={result.reasoning_chars})",
                finish_reason=result.finish_reason,
                reasoning_chars=result.reasoning_chars,
            )
        raise ArkNoFinalContentError(
            "Ark streaming response contained no assistant content "
            f"(finish_reason={result.finish_reason or 'unknown'}, reasoning_chars={result.reasoning_chars})",
            finish_reason=result.finish_reason,
            reasoning_chars=result.reasoning_chars,
        )

    def _final_json_recovery(
        self,
        stage: str,
        system_prompt: str,
        user_payload: dict[str, Any],
        *,
        thinking_type: str | None = None,
        max_completion_tokens: int | None = None,
    ) -> str:
        recovery_system = (
            system_prompt
            + "\n\nFINAL JSON OUTPUT RECOVERY:\n"
            + "上一轮已经完成推理，但没有输出最终 assistant content。现在不要解释、不要复述推理、不要 markdown。"
            + "立即返回最终 JSON 对象。必须保留原任务要求的全部必填字段；空字段也必须按契约输出空字符串、空数组或空对象，禁止省略。"
        )
        recovery_payload = dict(user_payload)
        recovery_payload["recovery_instruction"] = (
            "Previous attempt ended after reasoning with no final content. Return FINAL JSON ONLY now."
        )
        return self.generate_text(
            recovery_system,
            _compact_json(recovery_payload),
            temperature=0.0,
            json_mode=True,
            thinking_type=thinking_type,
            max_completion_tokens=max_completion_tokens,
        )

    def generate_json(self, stage: str, system_prompt: str, user_payload: dict[str, Any]) -> dict[str, Any]:
        self._reset_call_usage()
        # provider_output_template is transport-only schema metadata. Do not expose it
        # to the model alongside output_template; duplicate templates can conflict and
        # anchor the model to provider-only placeholder values.
        prompt_payload = {
            key: value for key, value in user_payload.items()
            if key != "provider_output_template"
        }
        user_prompt = _compact_json(prompt_payload)
        # Repair is a routing/profile distinction, not a different provider task shape.
        # Reuse the base stage's deterministic JSON settings and token budget.
        base_stage = stage[:-7] if stage.endswith("_repair") else stage
        thinking_type = "disabled" if base_stage in STRUCTURED_NO_THINKING_STAGES else None
        temperature = 0.0 if base_stage in STRUCTURED_NO_THINKING_STAGES else 0.2
        completion_budget = self._stage_completion_budget(base_stage)
        schema_mode = os.getenv("ARK_STRUCTURED_OUTPUT_MODE", "auto").strip().lower()
        schema_format = provider_json_schema(base_stage, user_payload.get("provider_output_template", user_payload.get("output_template")))
        use_schema = bool(schema_format and schema_mode not in {"off", "false", "0", "json_object"} and self._json_schema_supported is not False)

        def _generate_primary(*, with_schema: bool) -> str:
            return self.generate_text(
                system_prompt,
                user_prompt,
                temperature=temperature,
                json_mode=not with_schema,
                response_format=schema_format if with_schema else None,
                thinking_type=thinking_type,
                max_completion_tokens=completion_budget,
            )

        try:
            try:
                first = _generate_primary(with_schema=use_schema)
                if use_schema:
                    self._json_schema_supported = True
            except ArkPermanentError as schema_exc:
                # Structured Outputs support is model/endpoint dependent. In auto mode,
                # a schema-capability 4xx falls back once to json_object and the client
                # remembers the capability result for subsequent Units. Business
                # validation still enforces the full Stage contract after parsing.
                schema_hint = " ".join(filter(None, [
                    str(schema_exc.provider_code or ""),
                    str(schema_exc.provider_message or ""),
                    str(schema_exc),
                ])).lower()
                schema_capability_error = (
                    use_schema
                    and schema_mode == "auto"
                    and schema_exc.status_code in {400, 404, 422}
                    and any(token in schema_hint for token in ("json_schema", "response_format", "schema", "unsupported", "not support"))
                )
                if not schema_capability_error:
                    raise
                self._json_schema_supported = False
                first = _generate_primary(with_schema=False)
        except ArkNoFinalContentError as exc:
            if exc.reasoning_chars > 0 and exc.finish_reason in (None, "stop"):
                try:
                    first = self._final_json_recovery(
                        stage, system_prompt, user_payload, thinking_type=thinking_type,
                        max_completion_tokens=completion_budget,
                    )
                except ArkModelError as recovery_exc:
                    raise ArkModelError(
                        f"Ark stage '{stage}' final-output recovery failed: {recovery_exc}",
                        kind=recovery_exc.kind,
                        retryable=recovery_exc.retryable,
                        status_code=recovery_exc.status_code,
                        transport_attempts=recovery_exc.transport_attempts,
                        **_copy_provider_metadata(recovery_exc),
                    ) from recovery_exc
            else:
                raise ArkModelError(
                    f"Ark stage '{stage}' failed: {exc}",
                    kind=exc.kind,
                    retryable=exc.retryable,
                    status_code=exc.status_code,
                    transport_attempts=exc.transport_attempts,
                    **_copy_provider_metadata(exc),
                ) from exc
        except ArkModelError as exc:
            raise ArkModelError(
                f"Ark stage '{stage}' failed: {exc}",
                kind=exc.kind,
                retryable=exc.retryable,
                status_code=exc.status_code,
                transport_attempts=exc.transport_attempts,
                **_copy_provider_metadata(exc),
            ) from exc

        try:
            return extract_json_object(first)
        except ArkModelError as first_error:
            repair_system = (
                "You repair JSON only. Return one valid JSON object with no markdown and no commentary. "
                f"The target stage is {stage}. Preserve the original semantics and only repair JSON syntax/shape. "
                "Every required field from the supplied output contract must be present."
            )
            repair_user = json.dumps(
                {
                    "invalid_output": first,
                    "error": str(first_error),
                    "output_contract": user_payload.get("output_contract", {}),
                },
                ensure_ascii=False, separators=(",", ":"),
            )
            try:
                second = self.generate_text(
                    repair_system, repair_user, temperature=0.0, json_mode=True, thinking_type="disabled",
                    max_completion_tokens=completion_budget,
                )
            except ArkModelError as exc:
                raise ArkModelError(
                    f"Ark stage '{stage}' JSON repair failed: {exc}",
                    kind=exc.kind,
                    retryable=exc.retryable,
                    status_code=exc.status_code,
                    transport_attempts=exc.transport_attempts,
                    **_copy_provider_metadata(exc),
                ) from exc
            return extract_json_object(second)

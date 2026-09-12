"""Tests for Message Draft safe send.

All send paths use fake sender / fake guard. No BOSS automation is triggered.
"""

from __future__ import annotations

from typing import Any

import lakejob.application.messaging.draft as message_draft


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Patch:
    def __init__(self, **values: Any):
        self.values = values
        self.originals: dict[str, Any] = {}

    def __enter__(self):
        for name, value in self.values.items():
            self.originals[name] = getattr(message_draft, name)
            setattr(message_draft, name, value)

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(message_draft, name, value)


def draft(**overrides: Any) -> dict[str, Any]:
    data = {
        "draft_id": "11111111-1111-1111-1111-111111111111",
        "draft_type": "jobseeker",
        "target_id": "22222222-2222-2222-2222-222222222222",
        "target_name": "AI视频设计师",
        "content": "您好，我对这个岗位比较感兴趣，想进一步了解岗位要求和团队情况。",
        "status": "draft",
    }
    data.update(overrides)
    return data


def run_with_patches(draft_data: dict[str, Any], **patches: Any) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    logs: list[dict[str, Any]] = []
    confirm_phrase = patches.pop("confirm_phrase", message_draft.SEND_DRAFT_CONFIRM_PHRASE)
    defaults = {
        "get_message_draft": lambda draft_id: draft_data,
        "get_latest_draft_status": lambda draft_id: draft_data.get("status", "draft"),
        "_load_send_target": lambda d: {"source_url": "https://www.zhipin.com/job_detail/test.html", "platform_id": None, "account_id": None},
        "guard_real_message": lambda **kwargs: {"allowed": True, "blocked": False, "reason": "allowed"},
        "consume_quota": lambda *args, **kwargs: {"allowed": True, "consumed": True, "reason": "test_quota"},
        "_send_via_boss": lambda d, target, content: True,
        "_log_send_result": lambda result: logs.append(result) or "log-1",
        "platform_target_from_record": lambda target: type(
            "ConfirmedTarget", (), {"require": lambda self, action: None}
        )(),
    }
    defaults.update(patches)
    with Patch(**defaults):
        result = message_draft.send_message_draft_once(
            draft_data["draft_id"],
            confirm_phrase=confirm_phrase,
            skip_delay=True,
        )
    return result, logs


def test_confirmation_required() -> None:
    result, logs = run_with_patches(draft(), confirm_phrase="WRONG")
    assert_true(result["success"] is False, "confirmation mismatch should fail")
    assert_true(result["sent"] is False, "confirmation mismatch must not send")
    assert_true("confirmation" in result["error"], "confirmation error missing")
    assert_true(logs and logs[-1]["message_draft_send"] is True, "send log missing")


def test_empty_content_rejected() -> None:
    result, _ = run_with_patches(draft(content=""))
    assert_true(result["success"] is False, "empty content should fail")
    assert_true(result["sent"] is False, "empty content must not send")
    assert_true("empty" in result["error"], "empty content error missing")


def test_long_content_rejected() -> None:
    result, _ = run_with_patches(draft(content="x" * 301))
    assert_true(result["success"] is False, "long content should fail")
    assert_true(result["sent"] is False, "long content must not send")
    assert_true("300" in result["error"], "long content error missing")


def test_safety_guard_blocked() -> None:
    called = {"sender": False}

    def fake_sender(d, target, content):
        called["sender"] = True
        return True

    result, logs = run_with_patches(
        draft(),
        guard_real_message=lambda **kwargs: {"allowed": False, "blocked": True, "reason": "daily_real_message_limit_reached"},
        _send_via_boss=fake_sender,
    )
    assert_true(result["blocked"] is True, "guard block not marked")
    assert_true(result["reason"] == "daily_real_message_limit_reached", "guard reason missing")
    assert_true(called["sender"] is False, "sender must not be called when guard blocks")
    assert_true(logs[-1]["blocked"] is True, "blocked log missing")


def test_missing_source_url_rejected() -> None:
    result, _ = run_with_patches(draft(), _load_send_target=lambda d: {"source_url": ""})
    assert_true(result["success"] is False, "missing source_url should fail")
    assert_true(result["sent"] is False, "missing source_url must not send")
    assert_true("source_url" in result["error"] or "目标页面链接" in result["error"], "source_url error missing")

    mock_result, _ = run_with_patches(draft(), _load_send_target=lambda d: {"source_url": "mock://job"})
    assert_true(mock_result["success"] is False, "mock source_url should fail")


def test_success_path_uses_fake_sender() -> None:
    calls: list[dict[str, Any]] = []

    def fake_sender(d, target, content):
        calls.append({"draft": d, "target": target, "content": content})
        return True

    result, logs = run_with_patches(draft(), _send_via_boss=fake_sender)
    assert_true(result["success"] is True, "success result missing")
    assert_true(result["sent"] is True, "sent result missing")
    assert_true(result["real_send"] is True, "real_send must be true only on success")
    assert_true(len(calls) == 1, "fake sender should be called exactly once")
    assert_true(logs[-1]["success"] is True, "success log missing")


def test_repeat_sent_rejected() -> None:
    result, _ = run_with_patches(draft(status="sent"))
    assert_true(result["blocked"] is True, "already sent should be blocked")
    assert_true(result["reason"] == "draft_already_sent", "already sent reason missing")


def test_status_mapping_from_payloads() -> None:
    assert_true(_status_from_result({"sent": True, "blocked": False}) == "sent", "sent status mapping failed")
    assert_true(_status_from_result({"sent": False, "blocked": True}) == "blocked", "blocked status mapping failed")
    assert_true(_status_from_result({"sent": False, "blocked": False}) == "failed", "failed status mapping failed")


def _status_from_result(payload: dict[str, Any]) -> str:
    if payload.get("sent") is True:
        return "sent"
    if payload.get("blocked") is True:
        return "blocked"
    return "failed"


def main() -> int:
    test_confirmation_required()
    test_empty_content_rejected()
    test_long_content_rejected()
    test_safety_guard_blocked()
    test_missing_source_url_rejected()
    test_success_path_uses_fake_sender()
    test_repeat_sent_rejected()
    test_status_mapping_from_payloads()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

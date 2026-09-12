"""Focused tests for the unified real-action gate and boss_app closure."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import lakejob.safety.action_orchestrator as action_orchestrator
import pytest


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class FakeAutomation:
    def __init__(self, *, page_safe: bool = True):
        self.page_safe = page_safe
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    def check_page_safety(self) -> bool:
        self.calls.append(("check_page_safety", ()))
        return self.page_safe

    def search(self, keyword: str, city_code: str):
        self.calls.append(("search", (keyword, city_code)))
        return [{"title": "one"}, {"title": "two"}]

    def apply_to_job(self, job_url: str, greeting: str):
        self.calls.append(("apply_to_job", (job_url, greeting)))
        return {"success": True, "application_id": "app-1"}

    def open_conversation_by_name(self, name: str):
        self.calls.append(("open_conversation", (name,)))
        return True

    def send_message(self, content: str, fast: bool):
        self.calls.append(("send_message", (content, fast)))
        return True


async def execute(fn, *args):
    return fn(*args)


class Patch:
    def __init__(self, obj, name: str, value: Any):
        self.obj, self.name, self.value = obj, name, value
        self.original = getattr(obj, name)

    def __enter__(self):
        setattr(self.obj, self.name, self.value)

    def __exit__(self, exc_type, exc, tb):
        setattr(self.obj, self.name, self.original)


def test_search_passes_all_gates() -> None:
    automation = FakeAutomation()
    events: list[str] = []
    with Patch(action_orchestrator.quota_policy, "check_and_consume", lambda *a, **k: {"allowed": True, "reason": "allowed"}), Patch(
        action_orchestrator.audit_log, "write_event", lambda action, **kwargs: events.append(action) or "audit-1"
    ):
        result = asyncio.run(
            action_orchestrator.ActionOrchestrator(automation, execute).real_search(
                keyword="Python", city_code="100010000", limit=1,
                human_confirm=action_orchestrator.CONFIRM_REAL_SEARCH,
            )
        )
    assert len(result) == 1
    assert [name for name, _ in automation.calls] == ["check_page_safety", "search"]
    assert events == ["real_search.attempted", "real_search.completed"]


def test_missing_confirmation_never_executes_action() -> None:
    automation = FakeAutomation()
    with Patch(action_orchestrator.audit_log, "write_event", lambda *a, **k: "audit-1"):
        try:
            asyncio.run(
                action_orchestrator.ActionOrchestrator(automation, execute).real_apply(
                    job_url="https://example.test/job", greeting="hello", human_confirm="",
                )
            )
        except action_orchestrator.ActionBlocked as exc:
            assert exc.reason == "human_confirm_required"
        else:
            raise AssertionError("missing confirmation was not blocked")
    assert not any(name == "apply_to_job" for name, _ in automation.calls)


def test_unsafe_page_never_consumes_or_executes() -> None:
    automation = FakeAutomation(page_safe=False)
    quota_calls: list[str] = []
    with Patch(action_orchestrator.quota_policy, "check_and_consume", lambda *a, **k: quota_calls.append("quota") or {"allowed": True}), Patch(
        action_orchestrator.audit_log, "write_event", lambda *a, **k: "audit-1"
    ):
        try:
            asyncio.run(
                action_orchestrator.ActionOrchestrator(automation, execute).real_send(
                    conversation_id="1", counterparty_name="HR", content="hello",
                    human_confirm=action_orchestrator.CONFIRM_REAL_SEND,
                )
            )
        except action_orchestrator.ActionBlocked as exc:
            assert exc.reason == "page_safety_check_failed"
        else:
            raise AssertionError("unsafe page was not blocked")
    assert quota_calls == []
    assert not any(name == "send_message" for name, _ in automation.calls)


def test_quota_block_never_executes() -> None:
    automation = FakeAutomation()
    with Patch(
        action_orchestrator.quota_policy,
        "check_and_consume",
        lambda *a, **k: {"allowed": False, "reason": "daily_real_apply_limit_reached"},
    ), Patch(action_orchestrator.audit_log, "write_event", lambda *a, **k: "audit-1"):
        try:
            asyncio.run(
                action_orchestrator.ActionOrchestrator(automation, execute).real_apply(
                    job_url="https://example.test/job", greeting="hello",
                    human_confirm=action_orchestrator.CONFIRM_REAL_APPLY,
                )
            )
        except action_orchestrator.ActionBlocked as exc:
            assert exc.reason == "daily_real_apply_limit_reached"
        else:
            raise AssertionError("quota block did not stop apply")
    assert not any(name == "apply_to_job" for name, _ in automation.calls)



def main() -> int:
    for test in (
        test_search_passes_all_gates,
        test_missing_confirmation_never_executes_action,
        test_unsafe_page_never_consumes_or_executes,
        test_quota_block_never_executes,
    ):
        test()
        print(f"PASSED {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

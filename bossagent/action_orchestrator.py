"""Single gated entry point for every real BOSS search, send, and apply action."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import audit_log
import quota_policy
import safety_guard


CONFIRM_REAL_SEARCH = "CONFIRM_REAL_SEARCH"
CONFIRM_REAL_APPLY = "CONFIRM_REAL_APPLY"
CONFIRM_REAL_SEND = "CONFIRM_REAL_SEND"
BATCH_DISABLED_MESSAGE = "真实批量投递已关闭，当前仅支持生成草稿并人工确认。"


class ActionBlocked(PermissionError):
    def __init__(self, reason: str, message: str | None = None):
        super().__init__(message or reason)
        self.reason = reason
        self.message = message or reason


Executor = Callable[..., Awaitable[Any]]


@dataclass
class ActionOrchestrator:
    automation: Any
    execute: Executor

    async def real_search(
        self,
        *,
        keyword: str,
        city_code: str,
        limit: int,
        human_confirm: str,
    ) -> list[dict[str, Any]]:
        await self._gate(
            action="search",
            audit_prefix="real_search",
            human_confirm=human_confirm,
            expected_confirm=CONFIRM_REAL_SEARCH,
            target_type="search",
            target_id=keyword,
            metadata={"keyword": keyword, "city_code": city_code, "limit": limit},
        )
        jobs = await self._execute_action(
            "real_search", "search", keyword,
            self.automation.search, keyword, city_code,
        )
        return list(jobs or [])[:limit]

    def filter_by_welfare(self, jobs: list[dict[str, Any]], welfare: list[str]) -> list[dict[str, Any]]:
        return list(self.automation._filter_by_welfare(jobs, welfare))

    async def scan_jobs(self, *, human_confirm: str) -> list[dict[str, Any]]:
        await self._gate(
            action="search",
            audit_prefix="real_search",
            human_confirm=human_confirm,
            expected_confirm=CONFIRM_REAL_SEARCH,
            target_type="search",
            target_id="current_page_scan",
            metadata={"mode": "current_page_scan"},
        )
        return await self._execute_action(
            "real_search", "search", "current_page_scan",
            self.automation.scan_current_page,
        )

    async def real_apply(
        self,
        *,
        job_url: str,
        greeting: str,
        human_confirm: str,
    ) -> dict[str, Any]:
        await self._gate(
            action="real_apply",
            audit_prefix="real_apply",
            human_confirm=human_confirm,
            expected_confirm=CONFIRM_REAL_APPLY,
            target_type="job",
            target_id=job_url,
            metadata={"job_url": job_url},
        )
        return await self._execute_action(
            "real_apply", "job", job_url,
            self.automation.apply_to_job, job_url, greeting,
        )

    async def real_send(
        self,
        *,
        conversation_id: str,
        counterparty_name: str,
        content: str,
        human_confirm: str,
    ) -> bool:
        await self._gate(
            action="real_message",
            audit_prefix="real_message",
            human_confirm=human_confirm,
            expected_confirm=CONFIRM_REAL_SEND,
            target_type="conversation",
            target_id=conversation_id,
            metadata={"counterparty_name": counterparty_name, "content_length": len(content)},
        )
        opened = await self.execute(self.automation.open_conversation_by_name, counterparty_name)
        if not opened:
            self._audit_result(
                "real_message", "conversation", conversation_id, False,
                {"reason": "conversation_open_failed"},
            )
            raise ActionBlocked("conversation_open_failed", "无法打开目标会话")
        return bool(
            await self._execute_action(
                "real_message", "conversation", conversation_id,
                self.automation.send_message, content, False,
            )
        )

    async def _gate(
        self,
        *,
        action: str,
        audit_prefix: str,
        human_confirm: str,
        expected_confirm: str,
        target_type: str,
        target_id: str,
        metadata: dict[str, Any],
    ) -> None:
        if human_confirm != expected_confirm:
            self._best_effort_block_audit(audit_prefix, target_type, target_id, "human_confirm_required", metadata)
            raise ActionBlocked("human_confirm_required", f"人工确认失败，需要 {expected_confirm}")

        page_safe = await self.execute(self.automation.check_page_safety)
        safety = safety_guard.check_page_safety(bool(page_safe))
        if not safety.get("allowed"):
            self._best_effort_block_audit(audit_prefix, target_type, target_id, safety["reason"], metadata)
            raise ActionBlocked(str(safety["reason"]), "页面安全检查未通过，真实动作已暂停")

        quota = quota_policy.check_and_consume(
            action,
            metadata={**metadata, "source": "boss_app_action_orchestrator"},
        )
        if not quota.get("allowed"):
            self._best_effort_block_audit(audit_prefix, target_type, target_id, str(quota.get("reason")), metadata)
            raise ActionBlocked(
                str(quota.get("reason") or "quota_blocked"),
                str(quota.get("error") or "额度检查未通过"),
            )

        audit_log.write_event(
            f"{audit_prefix}.attempted",
            target_type=target_type,
            target_id=target_id,
            metadata={**metadata, "quota": quota, "human_confirmed": True, "page_safe": True},
        )

    async def _execute_action(
        self,
        audit_prefix: str,
        target_type: str,
        target_id: str,
        fn: Callable[..., Any],
        *args: Any,
    ) -> Any:
        try:
            result = await self.execute(fn, *args)
            success = bool(result.get("success")) if isinstance(result, dict) and "success" in result else bool(result)
            if isinstance(result, list):
                success = True
            self._audit_result(audit_prefix, target_type, target_id, success, {"result": _safe_result(result)})
            return result
        except Exception as exc:
            self._audit_result(audit_prefix, target_type, target_id, False, {"error": str(exc)[:500]})
            raise

    @staticmethod
    def _audit_result(
        audit_prefix: str,
        target_type: str,
        target_id: str,
        success: bool,
        metadata: dict[str, Any],
    ) -> None:
        audit_log.write_event(
            f"{audit_prefix}.completed",
            target_type=target_type,
            target_id=target_id,
            outcome="success" if success else "failure",
            metadata=metadata,
        )

    @staticmethod
    def _best_effort_block_audit(
        audit_prefix: str,
        target_type: str,
        target_id: str,
        reason: str,
        metadata: dict[str, Any],
    ) -> None:
        try:
            audit_log.write_event(
                "real_action.blocked",
                target_type=target_type,
                target_id=target_id,
                outcome="blocked",
                metadata={**metadata, "action": audit_prefix, "reason": reason},
            )
        except Exception:
            pass


def _safe_result(result: Any) -> Any:
    if isinstance(result, list):
        return {"count": len(result)}
    if isinstance(result, dict):
        return {
            key: value for key, value in result.items()
            if key not in {"message", "content", "greeting"}
        }
    if inspect.isawaitable(result):
        return "awaitable"
    return bool(result)

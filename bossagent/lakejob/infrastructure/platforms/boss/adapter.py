"""BOSS adapter with vision-first, fail-closed search."""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from lakejob.infrastructure.platforms.base import PlatformAdapter
from lakejob.infrastructure.platforms.boss.mapper import (
    boss_candidate_to_core,
    boss_conversation_to_core,
    boss_job_to_core,
    boss_message_to_core,
)
from lakejob.infrastructure.platforms.boss.auth import NOT_READY_MESSAGE, record_error
from lakejob.infrastructure.vision.browser_container import VisionBrowserContainer
from lakejob.domain.platform_targets import platform_target_from_record


from lakejob.infrastructure.platforms.boss.cities import CITIES


class BossAdapter(PlatformAdapter):
    """BOSS integration. Search is vision-first; legacy automation is explicit."""

    platform_code = "boss"
    platform_name = "BOSS Direct Hire"

    def __init__(
        self,
        *,
        headless: bool = False,
        allow_mock: bool = True,
        vision_provider: Any | None = None,
        vision_browser_factory: Callable[[], Any] | None = None,
        legacy_automation_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._allow_mock = allow_mock
        self._vision_provider = vision_provider
        self._vision_browser_factory = vision_browser_factory or (lambda: VisionBrowserContainer(headless=headless))
        def default_legacy_factory():
            from lakejob.infrastructure.platforms.boss.compat.automation import BossAutomation
            return BossAutomation(headless=headless)

        self._legacy_automation_factory = legacy_automation_factory or default_legacy_factory
        self._vision_browser: Any | None = None
        self._automation: Any | None = None
        self._legacy_started = False
        self._started = False
        self._start_error: str | None = None
        self.last_search_result: dict[str, Any] | None = None
        self._safety_account_id: str | None = None
        self._safety_source = "boss_adapter"
        self.use_vision_search = _env_bool("USE_VISION_SEARCH", True)
        self.allow_legacy_dom_search = _env_bool("ALLOW_LEGACY_DOM_SEARCH", False)

    def start(self) -> None:
        if self._started:
            return
        try:
            if self.use_vision_search:
                self._vision_browser = self._vision_browser_factory()
                self._vision_browser.start()
            elif self.allow_legacy_dom_search:
                self._ensure_legacy_started()
            else:
                raise RuntimeError(
                    "BOSS search disabled: USE_VISION_SEARCH=false and ALLOW_LEGACY_DOM_SEARCH=false"
                )
            self._started = True
            self._start_error = None
        except Exception as exc:
            self._start_error = str(exc)
            record_error("auth", self._start_error, reason="browser_start")
            self._audit(
                "vision_browser_start_failed_closed",
                {"error": self._start_error, "legacy_fallback": False, "mock_fallback": False},
            )

    def close(self) -> None:
        try:
            if self._vision_browser is not None:
                self._vision_browser.close()
            if self._automation is not None and self._legacy_started:
                self._automation.close()
        finally:
            self._vision_browser = None
            self._automation = None
            self._legacy_started = False
            self._started = False

    def set_safety_context(self, *, account_id: str | None, source: str) -> None:
        self._safety_account_id = str(account_id or "") or None
        self._safety_source = str(source or "boss_adapter")
        if self._automation is not None:
            self._automation._safety_account_id = self._safety_account_id
            self._automation._safety_source = self._safety_source

    def search_jobs(
        self,
        keyword: str,
        *,
        city: str | None = None,
        limit: int = 10,
        allow_mock: bool = False,
        daily_limit: int | None = None,
        per_run_limit: int | None = None,
        dry_run: bool = False,
    ) -> list[dict[str, Any]]:
        self._require_started("job")
        city_name = city or "全国"
        if self.use_vision_search:
            return self._vision_search(
                keyword,
                city=city_name,
                limit=limit,
                daily_limit=daily_limit,
                per_run_limit=per_run_limit,
                dry_run=dry_run,
                mode="jobs",
            )
        if not self.allow_legacy_dom_search:
            return self._fail_closed("job_search", RuntimeError("Legacy DOM search is disabled"))
        try:
            automation = self._ensure_legacy_started()
            city_code = CITIES.get(city_name, CITIES.get("全国", "100010000"))
            jobs = automation.search_jobs_real(keyword, city_code=city_code, limit=limit)
            return [boss_job_to_core(job) for job in jobs]
        except Exception as exc:
            return self._fail_closed("legacy_job_search", exc)

    def search_candidates(
        self,
        keyword: str,
        *,
        city: str = "",
        limit: int = 20,
        daily_limit: int | None = None,
        per_run_limit: int | None = None,
        dry_run: bool = False,
    ) -> list[dict[str, Any]]:
        self._require_started("candidate")
        if self.use_vision_search:
            return self._vision_search(
                keyword,
                city=city,
                limit=limit,
                daily_limit=daily_limit,
                per_run_limit=per_run_limit,
                dry_run=dry_run,
                mode="candidates",
            )
        if not self.allow_legacy_dom_search:
            return self._fail_closed("candidate_search", RuntimeError("Legacy DOM search is disabled"))
        try:
            candidates = self._ensure_legacy_started().search_candidates(keyword, limit=limit)
            return [boss_candidate_to_core(item) for item in candidates]
        except Exception as exc:
            return self._fail_closed("legacy_candidate_search", exc)

    def _vision_search(
        self,
        keyword: str,
        *,
        city: str,
        limit: int,
        daily_limit: int | None,
        per_run_limit: int | None,
        dry_run: bool,
        mode: str,
    ) -> list[dict[str, Any]]:
        try:
            from lakejob.infrastructure.platforms.boss.search.vision_search_skill import SearchConfig, VisionSearchSkill
            from lakejob.infrastructure.vision.vision_provider import ScreenshotVisionProvider

            if self._vision_browser is None or self._vision_browser.page is None:
                raise RuntimeError("Vision browser is not started")
            provider = self._vision_provider or ScreenshotVisionProvider.from_env()
            result = VisionSearchSkill(
                self._vision_browser.page,
                provider,
                account_id=self._safety_account_id,
                safety_source=self._safety_source,
            ).run(
                SearchConfig(
                    keyword=keyword,
                    city=city,
                    limit=limit,
                    daily_limit=daily_limit or _env_int("VISION_DAILY_LIMIT", max(limit, 20)),
                    per_run_limit=per_run_limit or _env_int("VISION_PER_RUN_LIMIT", limit),
                    dry_run=dry_run,
                    mode=mode,
                )
            )
            self.last_search_result = result
            self._audit(
                "vision_search_completed",
                {
                    "mode": mode,
                    "keyword": keyword,
                    "city": city,
                    "count": len(result.get("items") or []),
                    "screenshot_path": (result.get("page_state") or {}).get("screenshot_path"),
                    "bboxes": _result_bboxes(result),
                },
            )
            return list(result.get("items") or [])
        except Exception as exc:
            return self._fail_closed(f"vision_{mode}_search", exc)

    def _require_started(self, mode: str) -> None:
        if self._start_error or not self._started:
            raise RuntimeError(f"BOSS {mode} search unavailable: {self._start_error or 'adapter not started'}")

    def _ensure_legacy_started(self) -> Any:
        if self._automation is None:
            self._automation = self._legacy_automation_factory()
            self._automation._safety_account_id = self._safety_account_id
            self._automation._safety_source = self._safety_source
        if not self._legacy_started:
            self._automation.start()
            self._legacy_started = True
        return self._automation

    def _fail_closed(self, action: str, exc: Exception) -> list[dict[str, Any]]:
        message = str(exc)
        record_error("search", message, reason=action)
        self._audit(
            "vision_search_failed_closed",
            {"action": action, "error": message, "legacy_fallback": False, "mock_fallback": False},
        )
        raise RuntimeError(f"BOSS {action} failed closed: {message}") from exc

    @staticmethod
    def _audit(event: str, payload: dict[str, Any]) -> None:
        path = Path("logs") / "boss_adapter_audit.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        row = {"at": datetime.now().astimezone().isoformat(timespec="seconds"), "event": event, **payload}
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")

    def get_job_detail(self, platform_job_id: str | None = None, source_url: str | None = None) -> dict[str, Any]:
        job_url = source_url or platform_job_id or ""
        if not job_url:
            raise ValueError("platform_job_id or source_url is required")
        if job_url.startswith("vision://"):
            raise RuntimeError("Vision records do not use legacy DOM detail extraction")
        try:
            automation = self._ensure_legacy_started()
            detail = (
                automation.fetch_job_detail(job_url)
                if hasattr(automation, "fetch_job_detail")
                else automation.fetch_detail(job_url)
            )
        except Exception as exc:
            raise RuntimeError(f"BOSS job detail fetch failed: {exc}") from exc
        detail["url"] = job_url
        detail["source_url"] = job_url
        return boss_job_to_core(detail)

    def get_candidate_detail(self, candidate: dict[str, Any]) -> dict[str, Any]:
        source_url = candidate.get("source_url") or candidate.get("url")
        if source_url and str(source_url).startswith("vision://"):
            return boss_candidate_to_core(candidate)
        if source_url:
            automation = self._ensure_legacy_started()
            if hasattr(automation, "fetch_candidate_detail"):
                detail = automation.fetch_candidate_detail(source_url)
                detail["url"] = source_url
                return boss_candidate_to_core({**candidate, **detail})
        detail = dict(candidate)
        for field in (
            "headline",
            "current_company",
            "current_title",
            "city",
            "location",
            "experience_text",
            "education_text",
            "resume_text",
            "skills",
        ):
            if detail.get(field) in (None, "", [], {}):
                detail[field] = None
        return boss_candidate_to_core(detail)

    def apply_to_job(self, job: dict[str, Any], message: str, dry_run: bool = False) -> dict[str, Any]:
        source_url = job.get("source_url") or job.get("url")
        if not source_url:
            raise ValueError("job source_url is required")
        if dry_run:
            return {
                "success": True,
                "dry_run": True,
                "message": "dry_run: application message was not sent to BOSS",
                "source_url": source_url,
            }
        platform_target_from_record(job).require("apply")
        try:
            automation = self._ensure_legacy_started()
            if hasattr(automation, "send_job_apply_message"):
                return automation.send_job_apply_message({**job, "source_url": source_url}, message)
            return automation.apply_to_job(source_url, message)
        except Exception as exc:
            raise RuntimeError(f"BOSS real job apply failed: {exc}") from exc

    def fetch_conversations(self) -> list[dict[str, Any]]:
        conversations = self._ensure_legacy_started().poll_conversation_list()
        return [boss_conversation_to_core(item) for item in conversations]

    def send_message(self, conversation: dict[str, Any], message: str) -> bool:
        platform_target_from_record(conversation).require("message")
        automation = self._ensure_legacy_started()
        if hasattr(automation, "open_candidate_conversation") and (
            conversation.get("source_url") or conversation.get("candidate_id")
        ):
            if not automation.open_candidate_conversation(conversation):
                return False
            return automation.send_message(message)
        name = conversation.get("counterparty_name") or conversation.get("hr_name") or ""
        if name and not automation.open_conversation_by_name(name):
            return False
        return automation.send_message(message)

    def reset_auth_state(self) -> None:
        automation = self._ensure_legacy_started()
        if hasattr(automation, "reset_auth_state"):
            automation.reset_auth_state()

    def auth_only(self, mode: str = "jobradar") -> bool:
        if self._start_error:
            record_error("auth", NOT_READY_MESSAGE, reason="browser_start")
            raise RuntimeError(f"BOSS browser unavailable: {self._start_error}")
        automation = self._ensure_legacy_started()
        if mode == "recruitradar":
            return bool(automation.ensure_recruiter_logged_in())
        return bool(automation.ensure_jobseeker_logged_in())

    def get_account_status(self) -> dict[str, Any]:
        running = bool(self._vision_browser and self._vision_browser.page is not None) or bool(
            self._automation and self._automation.page is not None
        )
        logged_in = self._automation.check_logged_in() if self._legacy_started else None
        return {"platform": self.platform_code, "running": running, "logged_in": logged_in}

    @staticmethod
    def map_message(message: dict[str, Any]) -> dict[str, Any]:
        return boss_message_to_core(message)


def _env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


def _result_bboxes(result: dict[str, Any]) -> list[list[float]]:
    bboxes = []
    for item in result.get("items") or []:
        raw = item.get("raw_data") or item.get("raw_payload") or {}
        metadata = raw.get("vision_metadata") if isinstance(raw, dict) else None
        bbox = metadata.get("bbox") if isinstance(metadata, dict) else raw.get("bbox") if isinstance(raw, dict) else None
        if isinstance(bbox, list) and len(bbox) == 4:
            bboxes.append(bbox)
    return bboxes

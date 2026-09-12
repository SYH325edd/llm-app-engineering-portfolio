"""Vision-first BOSS search using Playwright only for visible browser actions."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Protocol

from lakejob.infrastructure.platforms.boss.auth import record_error
from lakejob.safety.guard import check_page_safety
from lakejob.infrastructure.platforms.boss.search.boss_page_parser import BossPageParser
from lakejob.infrastructure.vision.screen_observer import PageState, ScreenObserver
from lakejob.infrastructure.vision.ui_grounder import GroundedElement, UIGrounder


JOB_SEARCH_URL = "https://www.zhipin.com/web/geek/job"
CANDIDATE_SEARCH_URL = "https://www.zhipin.com/web/boss/recommend"


class BrowserPage(Protocol):
    url: str
    mouse: Any
    keyboard: Any

    def goto(self, url: str, **kwargs: Any) -> Any: ...

    def wait_for_timeout(self, timeout: float) -> Any: ...


class VisionResultProvider(Protocol):
    def analyze(self, state: PageState) -> dict[str, Any]: ...


@dataclass(frozen=True)
class SearchConfig:
    keyword: str
    city: str
    limit: int
    daily_limit: int
    per_run_limit: int
    dry_run: bool
    mode: str = "jobs"
    recommended_keywords: tuple[str, ...] = ()
    confirmed_keywords: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.keyword.strip():
            raise ValueError("keyword must be supplied by the console")
        if self.mode not in {"jobs", "candidates"}:
            raise ValueError("mode must be jobs or candidates")
        if min(self.limit, self.daily_limit, self.per_run_limit) < 1:
            raise ValueError("limit, daily_limit and per_run_limit must be positive")
        unknown = set(self.confirmed_keywords) - set(self.recommended_keywords)
        if unknown:
            raise ValueError(f"confirmed keywords were not recommended: {sorted(unknown)}")

    @property
    def effective_keyword(self) -> str:
        additions = [item.strip() for item in self.confirmed_keywords if item.strip()]
        return " ".join([self.keyword.strip(), *additions]).strip()


class JsonDirectoryVisionProvider:
    """Read phase-named OCR/VLM JSON supplied through a console path."""

    def __init__(self, directory: str | Path):
        self.directory = Path(directory)

    def analyze(self, state: PageState) -> dict[str, Any]:
        path = self.directory / f"{state.phase}.json"
        if not path.exists():
            raise FileNotFoundError(f"Missing visual result for phase '{state.phase}': {path}")
        data = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise ValueError(f"Visual result must be a JSON object: {path}")
        return data


class VisionSearchPaused(RuntimeError):
    pass


class DailyQuota:
    def __init__(self, path: str | Path = "runtime/vision_search_daily.json"):
        self.path = Path(path)

    def used(self) -> int:
        data = self._read()
        return int(data.get(date.today().isoformat(), 0))

    def add(self, count: int) -> None:
        data = self._read()
        key = date.today().isoformat()
        data[key] = int(data.get(key, 0)) + max(0, count)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    def _read(self) -> dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}


class VisionSearchSkill:
    def __init__(
        self,
        page: BrowserPage,
        provider: VisionResultProvider,
        *,
        observer: ScreenObserver | None = None,
        grounder: UIGrounder | None = None,
        parser: BossPageParser | None = None,
        quota: DailyQuota | None = None,
        log_path: str | Path = "logs/vision_search.jsonl",
        account_id: str | None = None,
        safety_source: str = "vision_search",
    ):
        self.page = page
        self.provider = provider
        self.observer = observer or ScreenObserver(page)
        self.grounder = grounder or UIGrounder()
        self.parser = parser or BossPageParser(self.grounder)
        self.quota = quota or DailyQuota()
        self.log_path = Path(log_path)
        self.account_id = account_id
        self.safety_source = safety_source

    def run(self, config: SearchConfig) -> dict[str, Any]:
        remaining = config.daily_limit - self.quota.used()
        run_limit = min(config.limit, config.per_run_limit, max(0, remaining))
        if run_limit < 1:
            return self._pause("daily_limit_reached", None, config)

        self.page.goto(CANDIDATE_SEARCH_URL if config.mode == "candidates" else JOB_SEARCH_URL, wait_until="load")
        initial_state, initial_result = self._observe("initial", config)
        if config.dry_run:
            result = {
                "ok": True,
                "dry_run": True,
                "items": [],
                "page_state": initial_state.to_dict(),
                "keyword": config.keyword,
                "effective_keyword": config.effective_keyword,
                "recommended_keywords": list(config.recommended_keywords),
                "confirmed_keywords": list(config.confirmed_keywords),
                "run_limit": run_limit,
            }
            self._log("dry_run", result)
            return result

        search_box = self._required(initial_result, "search_box", initial_state, config)
        self._replace_text(search_box, config.effective_keyword)

        if config.city.strip():
            city_box = self._required(initial_result, "city_box", initial_state, config)
            self._replace_text(city_box, config.city.strip())
            _, city_result = self._observe("city_options", config)
            city_option = self.grounder.first(city_result, "city_option")
            if city_option:
                self._click(city_option, initial_state)

        before_state, before_result = self._observe("before_search", config)
        search_button = self.grounder.first(before_result, "search_button") or self._required(
            initial_result, "search_button", before_state, config
        )
        before_url = str(getattr(self.page, "url", ""))
        self._click(search_button, before_state)
        self._wait_for_page_change(before_url)

        results_state, visual_result = self._observe("results", config)
        items = (
            self.parser.parse_candidates(visual_result, keyword=config.effective_keyword, city=config.city)
            if config.mode == "candidates"
            else self.parser.parse_jobs(visual_result, keyword=config.effective_keyword, city=config.city)
        )[:run_limit]
        for item in items:
            raw_data = item.get("raw_data")
            if isinstance(raw_data, dict):
                metadata = raw_data.setdefault("vision_metadata", {})
                if isinstance(metadata, dict):
                    metadata["screenshot_path"] = results_state.screenshot_path
            item["vision_locator"] = {"bbox": item.get("bbox"), "screenshot_path": results_state.screenshot_path}
            item["details_confirmed_at"] = None
            item["confirmation_evidence"] = {}
            item["can_real_apply"] = False
            item["can_real_message"] = False
            item["reason_if_not_actionable"] = "vision_result_requires_detail_confirmation"
            raw_payload = item.get("raw_payload")
            if isinstance(raw_payload, dict):
                raw_payload["screenshot_path"] = results_state.screenshot_path
        self.quota.add(len(items))
        result = {
            "ok": True,
            "dry_run": False,
            "items": items,
            "page_state": results_state.to_dict(),
            "keyword": config.keyword,
            "effective_keyword": config.effective_keyword,
            "recommended_keywords": list(config.recommended_keywords),
            "confirmed_keywords": list(config.confirmed_keywords),
            "run_limit": run_limit,
        }
        self._log("completed", {**result, "items": len(items)})
        return result

    def _observe(self, phase: str, config: SearchConfig) -> tuple[PageState, dict[str, Any]]:
        state = self.observer.capture(phase)
        visual_result = self.provider.analyze(state)
        ocr_text = str(visual_result.get("ocr_text") or visual_result.get("text") or "").strip()
        if not ocr_text and visual_result.get("elements"):
            ocr_text = json.dumps(visual_result.get("elements"), ensure_ascii=False, default=str)
        safety = check_page_safety(
            account_id=self.account_id,
            source=self.safety_source,
            page_title=state.title,
            url=state.url,
            screenshot_path=state.screenshot_path,
            ocr_text=ocr_text,
            vision_page_state=visual_result,
        )
        if safety.get("blocked"):
            self._pause(str(safety.get("reason") or "page_safety_blocked"), state, config)
        state = self.observer.apply_visual_result(state, visual_result)
        if state.status == "paused":
            self._pause(state.pause_reason or "restricted", state, config)
        return state, visual_result

    def _required(
        self, visual_result: dict[str, Any], kind: str, state: PageState, config: SearchConfig
    ) -> GroundedElement:
        element = self.grounder.first(visual_result, kind)
        if element is None:
            self._pause(f"{kind}_not_grounded", state, config)
        return element  # type: ignore[return-value]

    def _replace_text(self, element: GroundedElement, value: str) -> None:
        viewport = getattr(self.page, "viewport_size", None) or {"width": 1920, "height": 1080}
        self.grounder.validate_click(
            element, viewport_width=float(viewport.get("width", 1920)),
            viewport_height=float(viewport.get("height", 1080)),
        )
        self.page.mouse.click(element.center_x, element.center_y)
        self.page.keyboard.press("Control+A")
        self.page.keyboard.type(value)

    def _click(self, element: GroundedElement, state: PageState) -> None:
        viewport = getattr(self.page, "viewport_size", None) or {"width": 1920, "height": 1080}
        self.grounder.validate_click(
            element, viewport_width=float(viewport.get("width", 1920)),
            viewport_height=float(viewport.get("height", 1080)),
        )
        self.page.mouse.click(element.center_x, element.center_y)

    def _wait_for_page_change(self, before_url: str) -> None:
        if not hasattr(self.page, "wait_for_function"):
            return
        try:
            self.page.wait_for_function(
                "before => location.href !== before || document.readyState === 'complete'",
                before_url,
                timeout=5000,
            )
        except Exception as exc:
            raise VisionSearchPaused(f"page_state_did_not_change_after_click: {exc}") from exc

    def _pause(self, reason: str, state: PageState | None, config: SearchConfig) -> dict[str, Any]:
        payload = {
            "ok": False,
            "paused": True,
            "reason": reason,
            "keyword": config.keyword,
            "city": config.city,
            "page_state": state.to_dict() if state else None,
        }
        self._log("paused", payload)
        record_error("search", f"Vision search paused: {reason}", reason=reason)
        raise VisionSearchPaused(json.dumps(payload, ensure_ascii=False))

    def _log(self, event: str, payload: dict[str, Any]) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        row = {"at": datetime.now().astimezone().isoformat(timespec="seconds"), "event": event, **payload}
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Vision-first BOSS search")
    parser.add_argument("--keyword", required=True, help="Exact user-supplied search keyword")
    parser.add_argument("--city", required=True)
    parser.add_argument("--limit", required=True, type=int)
    parser.add_argument("--daily-limit", required=True, type=int)
    parser.add_argument("--per-run-limit", required=True, type=int)
    parser.add_argument("--dry-run", required=True, choices=("true", "false"))
    parser.add_argument("--mode", choices=("jobs", "candidates"), default="jobs")
    parser.add_argument("--vision-result-dir", required=True)
    parser.add_argument("--recommended-keyword", action="append", default=[])
    parser.add_argument("--confirmed-keyword", action="append", default=[])
    return parser


def config_from_args(args: argparse.Namespace) -> SearchConfig:
    return SearchConfig(
        keyword=args.keyword,
        city=args.city,
        limit=args.limit,
        daily_limit=args.daily_limit,
        per_run_limit=args.per_run_limit,
        dry_run=args.dry_run == "true",
        mode=args.mode,
        recommended_keywords=tuple(args.recommended_keyword),
        confirmed_keywords=tuple(args.confirmed_keyword),
    )


def main() -> int:
    args = build_parser().parse_args()
    config = config_from_args(args)
    from lakejob.infrastructure.vision.browser_container import VisionBrowserContainer

    browser = VisionBrowserContainer(headless=False)
    try:
        browser.start()
        skill = VisionSearchSkill(browser.page, JsonDirectoryVisionProvider(args.vision_result_dir))
        print(json.dumps(skill.run(config), ensure_ascii=False, default=str, indent=2))
        return 0
    except VisionSearchPaused as exc:
        print(str(exc), file=sys.stderr)
        return 2
    finally:
        browser.close()


if __name__ == "__main__":
    raise SystemExit(main())

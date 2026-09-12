"""Capture browser screenshots without inspecting page DOM or network data."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol


RISK_TERMS = {
    "captcha": ("验证码", "滑块", "拼图", "captcha", "security check", "安全验证"),
    "account_abnormal": ("账号异常", "账户异常", "账号被冻结", "限制使用"),
    "access_restricted": ("访问受限", "拒绝访问", "access denied", "restricted"),
    "too_frequent": ("操作频繁", "请求频繁", "访问频繁", "请稍后再试", "too many requests"),
}


class ScreenshotPage(Protocol):
    url: str

    def screenshot(self, *, path: str, full_page: bool = False) -> Any: ...


@dataclass(frozen=True)
class PageState:
    phase: str
    url: str
    title: str
    screenshot_path: str
    captured_at: str
    status: str = "ready"
    pause_reason: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class ScreenObserver:
    """Own screenshot persistence and basic, vision-derived page state."""

    def __init__(self, page: ScreenshotPage, screenshot_dir: str | Path = "runtime/vision/screenshots"):
        self.page = page
        self.screenshot_dir = Path(screenshot_dir)

    def capture(self, phase: str, *, full_page: bool = False) -> PageState:
        self.screenshot_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().astimezone().strftime("%Y%m%dT%H%M%S%f")
        path = (self.screenshot_dir / f"{stamp}_{_safe_name(phase)}.png").resolve()
        self.page.screenshot(path=str(path), full_page=full_page)
        return PageState(
            phase=phase,
            url=str(getattr(self.page, "url", "") or ""),
            title="",
            screenshot_path=str(path),
            captured_at=datetime.now().astimezone().isoformat(timespec="seconds"),
        )

    def apply_visual_result(self, state: PageState, visual_result: dict[str, Any] | None) -> PageState:
        reason = detect_pause_reason(visual_result)
        if not reason:
            return state
        return replace(state, status="paused", pause_reason=reason)


def detect_pause_reason(visual_result: dict[str, Any] | None) -> str | None:
    if not visual_result:
        return None
    explicit = str(visual_result.get("page_status") or visual_result.get("status") or "").lower()
    if explicit in RISK_TERMS:
        return explicit
    text = json.dumps(visual_result, ensure_ascii=False).lower()
    for reason, terms in RISK_TERMS.items():
        if any(term.lower() in text for term in terms):
            return reason
    return None


def _safe_name(value: str) -> str:
    cleaned = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in value.strip())
    return cleaned or "screen"

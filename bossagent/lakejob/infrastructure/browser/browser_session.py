from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone


@dataclass(frozen=True)
class BrowserSessionStatus:
    phase: str
    mode: str
    launcher_available: bool
    login_detection: str
    auto_search: str
    auto_apply: str
    auto_greeting: str
    message: str
    updated_at: str

    def to_dict(self) -> dict[str, str | bool]:
        return asdict(self)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_browser_session_status() -> BrowserSessionStatus:
    """Return the current Browser Agent capability status.

    Phase 22A is intentionally a status stub. It does not inspect cookies,
    does not read third-party credentials, does not detect login state, and
    does not control the browser. It only makes the current launcher-only
    capability explicit in the Web Console so later phases have a stable
    contract to extend.
    """

    return BrowserSessionStatus(
        phase="Phase 22A",
        mode="launcher_only",
        launcher_available=True,
        login_detection="not_integrated",
        auto_search="not_integrated",
        auto_apply="not_integrated",
        auto_greeting="not_integrated",
        message="当前仅支持从 Web Console 请求打开本地浏览器；登录检测、自动搜索、投递和打招呼尚未接入。",
        updated_at=_now_iso(),
    )

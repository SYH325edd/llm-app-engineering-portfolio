from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from urllib.parse import urlparse
import webbrowser


BOSS_HOME_URL = "https://www.zhipin.com/"


@dataclass(frozen=True)
class BrowserLaunchResult:
    ok: bool
    url: str
    message: str
    launched_at: str

    def to_dict(self) -> dict[str, str | bool]:
        return asdict(self)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_url(url: str | None) -> str:
    candidate = (url or BOSS_HOME_URL).strip()
    parsed = urlparse(candidate)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return BOSS_HOME_URL
    return candidate


def launch_boss_browser(url: str | None = None) -> BrowserLaunchResult:
    """Open BOSS in the user's local default browser.

    This launcher does not save third-party account credentials, does not read
    cookies, and does not attempt login, captcha, search, apply, or messaging.
    """

    target_url = _safe_url(url)
    launched_at = _now_iso()
    try:
        opened = webbrowser.open(target_url, new=1, autoraise=True)
        if opened:
            return BrowserLaunchResult(
                ok=True,
                url=target_url,
                message="已请求本地浏览器打开 BOSS 页面，请在浏览器中手动登录。",
                launched_at=launched_at,
            )
        return BrowserLaunchResult(
            ok=False,
            url=target_url,
            message="浏览器启动请求未成功，请检查系统默认浏览器设置后重试。",
            launched_at=launched_at,
        )
    except Exception as exc:  # pragma: no cover - defensive OS integration guard
        return BrowserLaunchResult(
            ok=False,
            url=target_url,
            message=f"启动浏览器失败：{exc}",
            launched_at=launched_at,
        )

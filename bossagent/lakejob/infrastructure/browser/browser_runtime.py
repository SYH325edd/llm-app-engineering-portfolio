from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse


BOSS_HOME_URL = "https://www.zhipin.com/"
RUNTIME_PROFILE_DIR = Path("runtime") / "browser_profiles" / "boss_playwright"


@dataclass(frozen=True)
class BrowserRuntimeStatus:
    phase: str
    mode: str
    runtime_available: bool
    is_running: bool
    url: str
    title: str
    message: str
    updated_at: str

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


class BrowserRuntimeController:
    """Own a local Playwright browser session for Browser Agent.

    Phase 23A only starts, inspects, and stops a controllable browser. It does
    not auto-login, does not bypass captcha, does not search jobs, does not
    apply, and does not send greetings. A persistent user data directory is used
    so the user can manually log in during local development, but this module
    never reads cookie values or third-party credentials.
    """

    def __init__(self) -> None:
        self._playwright = None
        self._context = None
        self._page = None

    def start(self, url: str | None = None) -> BrowserRuntimeStatus:
        target_url = _safe_url(url)
        if self._context is None:
            try:
                from playwright.sync_api import sync_playwright
            except Exception as exc:
                return self._status(
                    runtime_available=False,
                    is_running=False,
                    url=target_url,
                    title="",
                    message=f"Playwright 不可用：{exc}",
                )

            try:
                RUNTIME_PROFILE_DIR.mkdir(parents=True, exist_ok=True)
                self._playwright = sync_playwright().start()
                self._context = self._playwright.chromium.launch_persistent_context(
                    user_data_dir=str(RUNTIME_PROFILE_DIR),
                    headless=False,
                    viewport={"width": 1280, "height": 900},
                )
                if self._context.pages:
                    self._page = self._context.pages[0]
                else:
                    self._page = self._context.new_page()
            except Exception as exc:
                self._safe_cleanup()
                return self._status(
                    runtime_available=False,
                    is_running=False,
                    url=target_url,
                    title="",
                    message=f"启动可控浏览器失败：{exc}",
                )

        try:
            self._page.goto(target_url, wait_until="domcontentloaded", timeout=30000)
        except Exception as exc:
            return self.current_status(message=f"浏览器已启动，但打开页面失败：{exc}")

        return self.current_status(message="可控浏览器已启动，请在弹出的浏览器中手动登录 BOSS。")

    def current_status(self, message: str = "") -> BrowserRuntimeStatus:
        if self._context is None or self._page is None:
            return self._status(
                runtime_available=True,
                is_running=False,
                url="",
                title="",
                message=message or "可控浏览器未启动。",
            )

        url = ""
        title = ""
        try:
            url = self._page.url or ""
        except Exception:
            url = ""
        try:
            title = self._page.title() or ""
        except Exception:
            title = ""

        return self._status(
            runtime_available=True,
            is_running=True,
            url=url,
            title=title,
            message=message or "可控浏览器正在运行。",
        )

    def stop(self) -> BrowserRuntimeStatus:
        self._safe_cleanup()
        return self._status(
            runtime_available=True,
            is_running=False,
            url="",
            title="",
            message="可控浏览器已关闭。",
        )

    def _safe_cleanup(self) -> None:
        try:
            if self._context is not None:
                self._context.close()
        except Exception:
            pass
        try:
            if self._playwright is not None:
                self._playwright.stop()
        except Exception:
            pass
        self._context = None
        self._page = None
        self._playwright = None

    def _status(
        self,
        *,
        runtime_available: bool,
        is_running: bool,
        url: str,
        title: str,
        message: str,
    ) -> BrowserRuntimeStatus:
        return BrowserRuntimeStatus(
            phase="Phase 23A",
            mode="playwright_runtime",
            runtime_available=runtime_available,
            is_running=is_running,
            url=url,
            title=title,
            message=message,
            updated_at=_now_iso(),
        )


_RUNTIME = BrowserRuntimeController()


def start_boss_runtime_browser(url: str | None = None) -> BrowserRuntimeStatus:
    return _RUNTIME.start(url)


def get_boss_runtime_status() -> BrowserRuntimeStatus:
    return _RUNTIME.current_status()


def stop_boss_runtime_browser() -> BrowserRuntimeStatus:
    return _RUNTIME.stop()

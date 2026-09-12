"""Playwright container limited to visible browser actions for vision search."""

from __future__ import annotations

from pathlib import Path
from typing import Any


class VisionBrowserContainer:
    """Own a Chromium page without DOM extraction or anti-detection scripts."""

    def __init__(
        self,
        *,
        headless: bool = False,
        profile_path: str | Path = "runtime/boss_chromium_profile",
    ) -> None:
        self.headless = headless
        self.profile_path = Path(profile_path)
        self._playwright: Any = None
        self._context: Any = None
        self.page: Any = None

    def start(self) -> None:
        if self.page is not None:
            return
        from playwright.sync_api import sync_playwright

        self.profile_path.mkdir(parents=True, exist_ok=True)
        self._playwright = sync_playwright().start()
        self._context = self._playwright.chromium.launch_persistent_context(
            user_data_dir=str(self.profile_path),
            headless=self.headless,
            viewport={"width": 1440, "height": 1000},
            locale="zh-CN",
        )
        self.page = self._context.pages[0] if self._context.pages else self._context.new_page()
        self.page.set_default_timeout(30000)

    def close(self) -> None:
        try:
            if self._context is not None:
                self._context.close()
        finally:
            if self._playwright is not None:
                self._playwright.stop()
            self._playwright = None
            self._context = None
            self.page = None

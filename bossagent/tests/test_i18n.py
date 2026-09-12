"""Offline tests for Web Console i18n helpers."""

from __future__ import annotations

from types import SimpleNamespace

from lakejob.shared.i18n import get_locale, t


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def make_request(query: dict | None = None, cookies: dict | None = None):
    return SimpleNamespace(query_params=query or {}, cookies=cookies or {})


def main() -> int:
    assert_true(get_locale(make_request()) == "zh", "default locale must be zh")
    assert_true(get_locale(make_request({"lang": "en"})) == "en", "?lang=en should switch locale")
    assert_true(get_locale(make_request(cookies={"lakejob_lang": "en"})) == "en", "cookie locale should be read")
    assert_true(t("nav.dashboard", "zh") == "首页", "zh menu translation failed")
    assert_true(t("nav.dashboard", "en") == "Dashboard", "en menu translation failed")
    assert_true(t("recruit.title", "zh") == "招聘助手", "recruit title zh failed")
    assert_true(t("fallback.zh_only", "en") == "仅中文", "missing en key should fallback to zh")
    assert_true(t("missing.key", "en") == "missing.key", "missing key should fallback to key")
    assert_true(t("control.title", "en") == "Control Center", "control title en failed")
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

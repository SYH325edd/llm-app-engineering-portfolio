"""Offline tests for BOSS Auth Center. No browser or BOSS action is started."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

import auth_center
import boss_auth_login


def assert_true(value: bool, message: str) -> None:
    if not value:
        raise AssertionError(message)


def test_not_ready_detection() -> None:
    cases = [
        ("about:blank", "", "about:blank"),
        ("https://www.zhipin.com/security_check", "", "security_check"),
        ("https://www.zhipin.com/", "正在加载中", "loading"),
        ("https://www.zhipin.com/", "请登录 BOSS直聘", "login"),
        ("https://www.zhipin.com/", "请完成验证码", "verification"),
    ]
    for url, body, expected in cases:
        assert_true(auth_center.detect_not_ready_reason(url, body) == expected, f"failed: {expected}")


def test_statuses() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        original = (
            auth_center.RUNTIME_DIR,
            auth_center.AUTH_STATE_PATH,
            auth_center.BROWSER_PROFILE_PATH,
            auth_center.STATUS_PATH,
        )
        auth_center.RUNTIME_DIR = root
        auth_center.AUTH_STATE_PATH = root / "boss_auth_state.json"
        auth_center.BROWSER_PROFILE_PATH = root / "boss_chromium_profile"
        auth_center.STATUS_PATH = root / "boss_auth_center_status.json"
        try:
            assert_true(auth_center.get_auth_center_status()["state"] == auth_center.AUTH_MISSING, "missing state")
            auth_center.BROWSER_PROFILE_PATH.mkdir()
            auth_center.AUTH_STATE_PATH.write_text(
                json.dumps({"cookies": [], "origins": [], "_lakejob": {"browser_type": "chromium"}}),
                encoding="utf-8",
            )
            status = auth_center.get_auth_center_status()
            assert_true(status["state"] == auth_center.AUTH_OK, "valid state")
            assert_true(status["browser_type"] == "chromium", "browser type")
            auth_center.record_error("auth", auth_center.NOT_READY_MESSAGE, reason="login")
            assert_true(auth_center.get_auth_center_status()["state"] == auth_center.AUTH_EXPIRED, "expired state")
            auth_center.record_error("auth", auth_center.NOT_READY_MESSAGE, reason="security_check")
            assert_true(auth_center.get_auth_center_status()["state"] == auth_center.AUTH_BLOCKED, "blocked state")
            auth_center.record_error("auth", auth_center.NOT_READY_MESSAGE, reason="about:blank")
            assert_true(auth_center.get_auth_center_status()["state"] == auth_center.AUTH_UNKNOWN, "unknown state")
        finally:
            (
                auth_center.RUNTIME_DIR,
                auth_center.AUTH_STATE_PATH,
                auth_center.BROWSER_PROFILE_PATH,
                auth_center.STATUS_PATH,
            ) = original


def test_reset_paths() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        auth_path = root / "boss_auth_state.json"
        profile_path = root / "boss_chromium_profile"
        original = boss_auth_login.AUTH_STATE_PATH, boss_auth_login.BROWSER_PROFILE_PATH
        boss_auth_login.AUTH_STATE_PATH = auth_path
        boss_auth_login.BROWSER_PROFILE_PATH = profile_path
        try:
            auth_path.write_text("{}", encoding="utf-8")
            profile_path.mkdir()
            (profile_path / "marker").write_text("profile", encoding="utf-8")
            boss_auth_login.reset_paths(reset_auth=True, reset_browser_profile=False)
            assert_true(not auth_path.exists(), "--reset-auth must delete only auth state")
            assert_true(profile_path.exists(), "--reset-auth must preserve browser profile")

            auth_path.write_text("{}", encoding="utf-8")
            boss_auth_login.reset_paths(reset_auth=False, reset_browser_profile=True)
            assert_true(auth_path.exists(), "--reset-browser-profile must preserve auth state")
            assert_true(not profile_path.exists(), "--reset-browser-profile must delete profile")
        finally:
            boss_auth_login.AUTH_STATE_PATH, boss_auth_login.BROWSER_PROFILE_PATH = original


def test_auth_center_resets() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        original = auth_center.AUTH_STATE_PATH, auth_center.BROWSER_PROFILE_PATH
        auth_center.AUTH_STATE_PATH = root / "boss_auth_state.json"
        auth_center.BROWSER_PROFILE_PATH = root / "boss_chromium_profile"
        try:
            auth_center.AUTH_STATE_PATH.write_text("{}", encoding="utf-8")
            auth_center.BROWSER_PROFILE_PATH.mkdir()
            assert_true(auth_center.reset_auth_state(), "auth reset should remove existing state")
            assert_true(not auth_center.AUTH_STATE_PATH.exists(), "auth state was not removed")
            assert_true(auth_center.reset_browser_profile(), "profile reset should remove existing profile")
            assert_true(not auth_center.BROWSER_PROFILE_PATH.exists(), "browser profile was not removed")
        finally:
            auth_center.AUTH_STATE_PATH, auth_center.BROWSER_PROFILE_PATH = original


def main() -> int:
    test_not_ready_detection()
    test_statuses()
    test_reset_paths()
    test_auth_center_resets()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

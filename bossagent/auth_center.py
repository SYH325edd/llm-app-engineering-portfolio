"""Read-only BOSS authentication status and lightweight error tracking."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
RUNTIME_DIR = ROOT / "runtime"
AUTH_STATE_PATH = RUNTIME_DIR / "boss_auth_state.json"
BROWSER_PROFILE_PATH = RUNTIME_DIR / "boss_chromium_profile"
STATUS_PATH = RUNTIME_DIR / "boss_auth_center_status.json"

AUTH_OK = "AUTH_OK"
AUTH_MISSING = "AUTH_MISSING"
AUTH_EXPIRED = "AUTH_EXPIRED"
AUTH_BLOCKED = "AUTH_BLOCKED"
AUTH_UNKNOWN = "AUTH_UNKNOWN"

NOT_READY_MESSAGE = "BOSS_NOT_READY: please open /auth-center and re-login."


def _iso_mtime(path: Path) -> str | None:
    if not path.exists():
        return None
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).astimezone().isoformat(timespec="seconds")


def _read_json(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return default


def _write_status(data: dict[str, Any]) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def record_error(kind: str, message: str, *, reason: str = "") -> None:
    """Persist the latest auth or search error without requiring a database."""
    if kind not in {"auth", "search"}:
        raise ValueError("kind must be 'auth' or 'search'")
    data = _read_json(STATUS_PATH, {})
    if not isinstance(data, dict):
        data = {}
    data[f"last_{kind}_error"] = {
        "message": str(message),
        "reason": str(reason),
        "at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    _write_status(data)


def clear_auth_error() -> None:
    data = _read_json(STATUS_PATH, {})
    if isinstance(data, dict) and data.pop("last_auth_error", None) is not None:
        _write_status(data)


def reset_auth_state() -> bool:
    """Remove only the saved auth state. This never starts a browser."""
    if not AUTH_STATE_PATH.exists():
        return False
    AUTH_STATE_PATH.unlink()
    clear_auth_error()
    return True


def reset_browser_profile() -> bool:
    """Remove only the local Chromium profile. This never starts a browser."""
    if not BROWSER_PROFILE_PATH.exists():
        return False
    shutil.rmtree(BROWSER_PROFILE_PATH)
    return True


def detect_not_ready_reason(url: str, body: str) -> str | None:
    """Return a stable reason when a BOSS page cannot be used safely."""
    url_lower = (url or "").strip().lower()
    body_lower = (body or "").strip().lower()
    sample = body_lower[:5000]
    if not url_lower or url_lower == "about:blank":
        return "about:blank"
    if "security_check" in url_lower or "security-check" in url_lower:
        return "security_check"
    if any(term in sample for term in ("安全验证", "验证码", "滑块", "拼图", "captcha", "verify")):
        return "verification"
    if any(term in sample for term in ("账号异常", "限制使用", "冻结", "访问受限")):
        return "blocked"
    if any(term in sample for term in ("加载中", "正在加载", "loading...")):
        return "loading"
    login_url_terms = ("/web/user/", "/login/", "login?redirect=", "ka=header-login")
    if any(term in url_lower for term in login_url_terms):
        return "login"
    if any(term in sample for term in ("请登录", "扫码登录", "密码登录", "登录boss直聘")):
        return "login"
    return None


def _state_from_error(error: dict[str, Any] | None) -> str | None:
    if not error:
        return None
    reason = str(error.get("reason", "")).lower()
    if reason in {"security_check", "verification", "blocked"}:
        return AUTH_BLOCKED
    if reason in {"login", "expired"}:
        return AUTH_EXPIRED
    if reason in {"loading", "about:blank", "unknown"}:
        return AUTH_UNKNOWN
    text = str(error.get("message", "")).lower()
    if any(term in text for term in ("security_check", "verification", "captcha", "blocked", "限制", "冻结")):
        return AUTH_BLOCKED
    if any(term in text for term in ("login", "expired", "登录", "过期")):
        return AUTH_EXPIRED
    if any(term in text for term in ("loading", "about:blank", "unknown")):
        return AUTH_UNKNOWN
    return None


def get_auth_center_status() -> dict[str, Any]:
    status_data = _read_json(STATUS_PATH, {})
    if not isinstance(status_data, dict):
        status_data = {}
    auth_state = _read_json(AUTH_STATE_PATH, None)
    auth_exists = AUTH_STATE_PATH.is_file()
    profile_exists = BROWSER_PROFILE_PATH.is_dir()
    metadata = auth_state.get("_lakejob", {}) if isinstance(auth_state, dict) else {}
    browser_type = metadata.get("browser_type") or ("chromium" if profile_exists else "unknown")
    auth_error = status_data.get("last_auth_error") if isinstance(status_data.get("last_auth_error"), dict) else None
    search_error = status_data.get("last_search_error") if isinstance(status_data.get("last_search_error"), dict) else None

    if not auth_exists:
        state = AUTH_MISSING
    elif not isinstance(auth_state, dict) or not isinstance(auth_state.get("cookies"), list):
        state = AUTH_UNKNOWN
    else:
        state = _state_from_error(auth_error) or AUTH_OK

    suggestions = {
        AUTH_OK: "Authentication files are ready. Re-login only if BOSS reports a verification or login page.",
        AUTH_MISSING: "Run: python boss_auth_login.py --browser-type chromium",
        AUTH_EXPIRED: "Open /auth-center, then run the login script again. Use --reset-auth if needed.",
        AUTH_BLOCKED: "Complete the BOSS security check manually, then re-run the login script.",
        AUTH_UNKNOWN: "Inspect the latest debug files, then reset auth/profile and login again if necessary.",
    }
    return {
        "state": state,
        "auth_state_exists": auth_exists,
        "auth_state_updated_at": _iso_mtime(AUTH_STATE_PATH),
        "chromium_profile_exists": profile_exists,
        "browser_type": browser_type,
        "last_auth_error": auth_error,
        "last_search_error": search_error,
        "suggested_action": suggestions[state],
        "auth_state_path": str(AUTH_STATE_PATH),
        "browser_profile_path": str(BROWSER_PROFILE_PATH),
    }

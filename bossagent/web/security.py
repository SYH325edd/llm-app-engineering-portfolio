from dataclasses import dataclass
from typing import Optional


LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}


@dataclass
class WebGuardResult:
    allowed: bool
    reason: str = ""
    action: str = ""


DANGEROUS_ACTIONS = {
    "apply",
    "real_message",
    "scheduler_start",
    "local_control_real_action",
    "auth_path_reset",
    "admin_mutation",
}


def normalize_host(host: Optional[str]) -> str:
    if not host:
        return ""

    value = str(host).strip().lower()

    # IPv6 localhost without port.
    if value == "::1":
        return "::1"

    # IPv6 bracket form, for example: [::1]:8000.
    if value.startswith("[") and "]" in value:
        return value[1:value.index("]")]

    # IPv4 / hostname with port, for example: 127.0.0.1:8000.
    if ":" in value and value.count(":") == 1:
        return value.split(":", 1)[0]

    return value


def is_local_request(host: Optional[str]) -> bool:
    return normalize_host(host) in LOCAL_HOSTS


def require_local_request(host: Optional[str]) -> WebGuardResult:
    if is_local_request(host):
        return WebGuardResult(True)
    return WebGuardResult(False, "blocked_non_local_request")


def require_confirmation(action: str, confirm_text: Optional[str]) -> WebGuardResult:
    expected = f"CONFIRM_{action.upper()}"
    if confirm_text == expected:
        return WebGuardResult(True, action=action)
    return WebGuardResult(False, f"missing_or_invalid_confirmation_for_{action}", action=action)


def is_dangerous_action(action: str) -> bool:
    return action in DANGEROUS_ACTIONS


def redact_sensitive(text: Optional[str]) -> Optional[str]:
    if not text:
        return text

    redacted = str(text)
    for key in ["token", "cookie", "session", "authorization", "password"]:
        redacted = redacted.replace(key, "[REDACTED_KEY]")
        redacted = redacted.replace(key.upper(), "[REDACTED_KEY]")
        redacted = redacted.replace(key.capitalize(), "[REDACTED_KEY]")
    return redacted

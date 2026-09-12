from lakejob.app.security import (
    DANGEROUS_ACTIONS,
    is_dangerous_action,
    is_local_request,
    redact_sensitive,
    require_confirmation,
    require_local_request,
)


def test_local_request_allowed():
    assert is_local_request("127.0.0.1") is True
    assert is_local_request("127.0.0.1:8000") is True
    assert is_local_request("localhost") is True
    assert is_local_request("localhost:8000") is True
    assert is_local_request("::1") is True


def test_non_local_request_blocked():
    assert is_local_request("192.168.1.10") is False
    assert is_local_request("8.8.8.8") is False
    assert is_local_request("") is False
    assert is_local_request(None) is False

    result = require_local_request("192.168.1.10")
    assert result.allowed is False
    assert result.reason == "blocked_non_local_request"


def test_require_local_request_allows_localhost():
    result = require_local_request("127.0.0.1")
    assert result.allowed is True
    assert result.reason == ""


def test_dangerous_actions_are_registered():
    expected = {
        "apply",
        "real_message",
        "scheduler_start",
        "local_control_real_action",
        "auth_path_reset",
        "admin_mutation",
    }

    assert expected.issubset(DANGEROUS_ACTIONS)

    for action in expected:
        assert is_dangerous_action(action) is True


def test_unknown_action_is_not_dangerous():
    assert is_dangerous_action("draft_only") is False
    assert is_dangerous_action("read_only_page") is False
    assert is_dangerous_action("health_check") is False


def test_confirmation_allows_correct_phrase():
    result = require_confirmation("real_message", "CONFIRM_REAL_MESSAGE")

    assert result.allowed is True
    assert result.action == "real_message"
    assert result.reason == ""


def test_confirmation_blocks_missing_phrase():
    result = require_confirmation("apply", None)

    assert result.allowed is False
    assert result.action == "apply"
    assert result.reason == "missing_or_invalid_confirmation_for_apply"


def test_confirmation_blocks_wrong_phrase():
    result = require_confirmation("scheduler_start", "CONFIRM_SEND_MESSAGE")

    assert result.allowed is False
    assert result.action == "scheduler_start"
    assert result.reason == "missing_or_invalid_confirmation_for_scheduler_start"


def test_redact_sensitive_replaces_sensitive_keys():
    raw = "token=abc cookie=def session=ghi authorization=bearer password=123"
    redacted = redact_sensitive(raw)

    assert "token" not in redacted
    assert "cookie" not in redacted
    assert "session" not in redacted
    assert "authorization" not in redacted
    assert "password" not in redacted
    assert "[REDACTED_KEY]" in redacted


def test_redact_sensitive_handles_empty_text():
    assert redact_sensitive("") == ""
    assert redact_sensitive(None) is None

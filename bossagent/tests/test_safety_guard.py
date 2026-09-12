from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import safety_guard
from run_real_mode_smoke_test import _build_parser, _validate_args


TEST_JOB = {
    "id": "job-core-1",
    "company_name": "SafetyGuard Test Company",
    "external_job_id": "platform-job-1",
    "platform_job_id": "platform-job-1",
}


class Patch:
    def __init__(self, **values: Any):
        self.values = values
        self.originals: dict[str, Any] = {}

    def __enter__(self):
        for name, value in self.values.items():
            self.originals[name] = getattr(safety_guard, name)
            setattr(safety_guard, name, value)

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(safety_guard, name, value)


def assert_blocked(result: dict[str, Any], reason: str, logs: list[dict[str, Any]]) -> None:
    assert result["blocked"] is True, result
    assert result["allowed"] is False, result
    assert result["reason"] == reason, result
    assert logs, "Safety Guard did not write an intercept log"
    payload = logs[-1]["payload"]
    assert payload["safety_guard"] is True, payload
    assert payload["blocked"] is True, payload
    assert payload["reason"] == reason, payload


def fake_logger(logs: list[dict[str, Any]]):
    def _log_decision(**kwargs):
        job = kwargs.get("job") or {}
        candidate = kwargs.get("candidate") or {}
        payload = {
            "safety_guard": True,
            "blocked": kwargs["blocked"],
            "reason": kwargs["reason"],
            "action": kwargs["action"],
            "job_id": str(job.get("id") or ""),
            "candidate_id": str(candidate.get("id") or candidate.get("candidate_id") or ""),
            "company": job.get("company_name") or job.get("company") or "",
            "platform_job_id": job.get("external_job_id") or job.get("platform_job_id") or "",
            **(kwargs.get("extra") or {}),
        }
        logs.append({"payload": payload})

    return _log_decision


def test_daily_apply_limit() -> None:
    logs: list[dict[str, Any]] = []
    with Patch(
        _log_decision=fake_logger(logs),
        _daily_apply_count=lambda platform_id, account_id: 5,
        _daily_message_count=lambda platform_id, account_id: 0,
        _job_apply_seen=lambda platform_id, platform_job_id: False,
        _company_apply_seen_today=lambda platform_id, company: False,
        _blacklist=lambda *args: set(),
    ):
        result = safety_guard.guard_real_apply(platform_id="p", account_id="a", job=TEST_JOB, skip_delay=True)
    assert_blocked(result, "daily_real_apply_limit_reached", logs)


def test_daily_message_limit() -> None:
    logs: list[dict[str, Any]] = []
    with Patch(
        _log_decision=fake_logger(logs),
        _daily_apply_count=lambda platform_id, account_id: 0,
        _daily_message_count=lambda platform_id, account_id: 5,
        _blacklist=lambda *args: set(),
    ):
        result = safety_guard.guard_real_message(platform_id="p", account_id="a", job=TEST_JOB, skip_delay=True)
    assert_blocked(result, "daily_real_message_limit_reached", logs)


def test_duplicate_platform_job() -> None:
    logs: list[dict[str, Any]] = []
    with Patch(
        _log_decision=fake_logger(logs),
        _daily_apply_count=lambda platform_id, account_id: 0,
        _job_apply_seen=lambda platform_id, platform_job_id: True,
        _company_apply_seen_today=lambda platform_id, company: False,
        _blacklist=lambda *args: set(),
    ):
        result = safety_guard.guard_real_apply(platform_id="p", account_id="a", job=TEST_JOB, skip_delay=True)
    assert_blocked(result, "duplicate_platform_job", logs)


def test_duplicate_company_today() -> None:
    logs: list[dict[str, Any]] = []
    with Patch(
        _log_decision=fake_logger(logs),
        _daily_apply_count=lambda platform_id, account_id: 0,
        _job_apply_seen=lambda platform_id, platform_job_id: False,
        _company_apply_seen_today=lambda platform_id, company: True,
        _blacklist=lambda *args: set(),
    ):
        result = safety_guard.guard_real_apply(platform_id="p", account_id="a", job=TEST_JOB, skip_delay=True)
    assert_blocked(result, "duplicate_company_today", logs)


def test_blacklisted_company() -> None:
    logs: list[dict[str, Any]] = []
    runtime = Path("runtime")
    runtime.mkdir(exist_ok=True)
    blacklist = runtime / "blacklist_companies.txt"
    original = blacklist.read_text(encoding="utf-8") if blacklist.exists() else None
    try:
        blacklist.write_text("SafetyGuard Test Company\n", encoding="utf-8")
        with Patch(
            _log_decision=fake_logger(logs),
            _daily_apply_count=lambda platform_id, account_id: 0,
            _job_apply_seen=lambda platform_id, platform_job_id: False,
            _company_apply_seen_today=lambda platform_id, company: False,
        ):
            result = safety_guard.guard_real_apply(platform_id="p", account_id="a", job=TEST_JOB, skip_delay=True)
        assert_blocked(result, "blacklisted_company", logs)
    finally:
        if original is None:
            blacklist.unlink(missing_ok=True)
        else:
            blacklist.write_text(original, encoding="utf-8")


def test_risk_keywords() -> None:
    for keyword in ("验证码", "访问受限", "频繁", "风险", "请稍后"):
        logs: list[dict[str, Any]] = []
        with Patch(
            _log_decision=fake_logger(logs),
            _daily_apply_count=lambda platform_id, account_id: 0,
            _job_apply_seen=lambda platform_id, platform_job_id: False,
            _company_apply_seen_today=lambda platform_id, company: False,
            _blacklist=lambda *args: set(),
        ):
            result = safety_guard.guard_real_apply(
                platform_id="p",
                account_id="a",
                job=TEST_JOB,
                page_text=f"页面提示：{keyword}",
                skip_delay=True,
            )
        assert_blocked(result, "risk_keyword_detected", logs)


def test_smoke_limits() -> None:
    old = os.environ.get("LAKEJOB_MAX_ITEMS_PER_RUN")
    os.environ["LAKEJOB_MAX_ITEMS_PER_RUN"] = "20"
    try:
        assert safety_guard.clamp_run_limit(20, smoke=True) == 1
        parser = _build_parser()
        args = parser.parse_args(
            [
                "--mode",
                "jobradar",
                "--keyword",
                "Python",
                "--real",
                "--message-smoke",
                "--send-real",
                "--confirm-send",
                "SEND_ONE_REAL_MESSAGE",
            ]
        )
        _validate_args(args)
        assert args.limit == 1
        assert args.message_limit == 1
        assert args.apply_limit == 0

        args = parser.parse_args(
            [
                "--mode",
                "jobradar",
                "--keyword",
                "Python",
                "--real",
                "--apply-smoke",
                "--send-real",
                "--confirm-apply",
                "APPLY_ONE_REAL_JOB",
            ]
        )
        _validate_args(args)
        assert args.limit == 1
        assert args.apply_limit == 1
        assert args.message_limit == 0
    finally:
        if old is None:
            os.environ.pop("LAKEJOB_MAX_ITEMS_PER_RUN", None)
        else:
            os.environ["LAKEJOB_MAX_ITEMS_PER_RUN"] = old


def test_safety_check_exception_blocks() -> None:
    with Patch(_pause_reason=lambda text, state: (_ for _ in ()).throw(RuntimeError("vision failed"))):
        result = safety_guard.check_page_safety(
            account_id="a",
            source="test",
            page_title="BOSS",
            url="https://www.zhipin.com/",
            screenshot_path="runtime/test.png",
            ocr_text="normal page",
            vision_page_state={"page_status": "ready"},
        )
    assert result["blocked"] is True
    assert result["reason"] == "safety_check_error"


def test_empty_page_text_blocks() -> None:
    result = safety_guard.check_page_safety(
        account_id="a",
        source="test",
        page_title="BOSS",
        url="https://www.zhipin.com/",
        screenshot_path="runtime/test.png",
        ocr_text="",
        vision_page_state={"page_status": "unknown"},
    )
    assert result["blocked"] is True
    assert result["reason"] == "empty_page_evidence"


def test_captcha_text_pauses_account() -> None:
    pauses: list[dict[str, Any]] = []
    with Patch(_persist_account_pause=lambda **kwargs: pauses.append(kwargs)):
        result = safety_guard.check_page_safety(
            account_id="account-1",
            source="real_search",
            page_title="安全验证",
            url="https://www.zhipin.com/security-check",
            screenshot_path="runtime/captcha.png",
            ocr_text="请完成验证码后继续",
            vision_page_state={"page_status": "captcha"},
        )
    assert result["blocked"] is True
    assert result["paused"] is True
    assert result["reason"] == "captcha"
    assert pauses == [{
        "account_id": "account-1",
        "reason": "captcha",
        "source": "real_search",
        "screenshot_path": "runtime/captcha.png",
    }]


def main() -> int:
    tests = [
        test_daily_apply_limit,
        test_daily_message_limit,
        test_duplicate_platform_job,
        test_duplicate_company_today,
        test_blacklisted_company,
        test_risk_keywords,
        test_smoke_limits,
        test_safety_check_exception_blocks,
        test_empty_page_text_blocks,
        test_captcha_text_pauses_account,
    ]
    failures = []
    for test in tests:
        try:
            test()
            print(f"PASSED {test.__name__}")
        except Exception as exc:
            failures.append((test.__name__, str(exc)))
            print(f"FAILED {test.__name__}: {exc}")
    if failures:
        print("Safety Guard validation FAILED")
        return 1
    print("Safety Guard validation PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import lakejob.safety.guard as safety_guard


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


def fake_logger(logs: list[dict[str, Any]]):
    def _log_decision(**kwargs):
        job = kwargs.get("job") or {}
        payload = {
            "safety_guard": True,
            "blocked": kwargs["blocked"],
            "reason": kwargs["reason"],
            "action": kwargs["action"],
            "job_id": str(job.get("id") or ""),
            "company": job.get("company_name") or job.get("company") or "",
            "platform_job_id": job.get("external_job_id") or job.get("platform_job_id") or "",
            **(kwargs.get("extra") or {}),
        }
        logs.append({"payload": payload})

    return _log_decision


def write_test_config(config_path: Path, blacklist_path: Path) -> None:
    config_path.parent.mkdir(exist_ok=True)
    config_path.write_text(
        "\n".join(
            [
                "daily_real_apply_limit: 2",
                "daily_real_message_limit: 3",
                "min_interval_seconds: 7",
                "random_delay_range_seconds: [11, 13]",
                "max_items_per_run: 4",
                f"blacklist_companies_file: {blacklist_path.as_posix()}",
                "risk_keywords:",
                "  - 测试风控",
                "  - TEST_BLOCK",
            ]
        ),
        encoding="utf-8",
    )


def test_config_loads_values(tmp_dir: Path) -> None:
    config_path = tmp_dir / "real_run_config.yaml"
    blacklist_path = tmp_dir / "blacklist.txt"
    write_test_config(config_path, blacklist_path)
    os.environ["LAKEJOB_REAL_RUN_CONFIG"] = str(config_path)
    cfg = safety_guard.load_config()
    assert cfg.max_real_applies_per_day == 2
    assert cfg.max_real_messages_per_day == 3
    assert cfg.min_action_interval_seconds == 7
    assert cfg.random_delay_min_seconds == 11
    assert cfg.random_delay_max_seconds == 13
    assert cfg.max_items_per_run == 4
    assert cfg.blacklist_companies_file == blacklist_path.as_posix()
    assert cfg.risk_keywords == ("测试风控", "TEST_BLOCK")


def test_config_drives_limits_and_blocks(tmp_dir: Path) -> None:
    config_path = tmp_dir / "real_run_config.yaml"
    blacklist_path = tmp_dir / "blacklist.txt"
    write_test_config(config_path, blacklist_path)
    blacklist_path.write_text("Config Blocked Company\n", encoding="utf-8")
    os.environ["LAKEJOB_REAL_RUN_CONFIG"] = str(config_path)

    logs: list[dict[str, Any]] = []
    with Patch(
        _log_decision=fake_logger(logs),
        _daily_apply_count=lambda platform_id, account_id: 0,
        _daily_message_count=lambda platform_id, account_id: 0,
        _job_apply_seen=lambda platform_id, platform_job_id: False,
        _company_apply_seen_today=lambda platform_id, company: False,
        _recent_action_seconds=lambda platform_id, account_id: None,
    ):
        assert safety_guard.clamp_run_limit(20) == 4
        assert safety_guard.clamp_run_limit(20, smoke=True) == 1
        risk = safety_guard.guard_real_message(
            platform_id="p",
            account_id="a",
            job={"id": "j1", "company_name": "Allowed", "external_job_id": "p1"},
            page_text="页面出现 TEST_BLOCK",
            skip_delay=True,
        )
        assert risk["blocked"] is True
        assert risk["reason"] == "risk_keyword_detected"
        blocked = safety_guard.guard_real_apply(
            platform_id="p",
            account_id="a",
            job={"id": "j2", "company_name": "Config Blocked Company", "external_job_id": "p2"},
            skip_delay=True,
        )
        assert blocked["blocked"] is True
        assert blocked["reason"] == "blacklisted_company"
    assert len(logs) == 2
    assert all(item["payload"]["safety_guard"] for item in logs)


def test_env_overrides_config(tmp_dir: Path) -> None:
    config_path = tmp_dir / "real_run_config.yaml"
    blacklist_path = tmp_dir / "blacklist.txt"
    write_test_config(config_path, blacklist_path)
    os.environ["LAKEJOB_REAL_RUN_CONFIG"] = str(config_path)
    os.environ["LAKEJOB_MAX_ITEMS_PER_RUN"] = "9"
    try:
        assert safety_guard.load_config().max_items_per_run == 9
    finally:
        os.environ.pop("LAKEJOB_MAX_ITEMS_PER_RUN", None)


def main() -> int:
    tmp_dir = Path("runtime") / "safety_guard_config_test"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    old_config = os.environ.get("LAKEJOB_REAL_RUN_CONFIG")
    tests = [test_config_loads_values, test_config_drives_limits_and_blocks, test_env_overrides_config]
    failures = []
    try:
        for test in tests:
            try:
                test(tmp_dir)
                print(f"PASSED {test.__name__}")
            except Exception as exc:
                failures.append((test.__name__, str(exc)))
                print(f"FAILED {test.__name__}: {exc}")
    finally:
        if old_config is None:
            os.environ.pop("LAKEJOB_REAL_RUN_CONFIG", None)
        else:
            os.environ["LAKEJOB_REAL_RUN_CONFIG"] = old_config
    if failures:
        print("Safety Guard config validation FAILED")
        return 1
    print("Safety Guard config validation PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

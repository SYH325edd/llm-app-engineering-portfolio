"""Offline validation for Local Control Center.

This test does not open BOSS, send messages, or apply to jobs.
"""

from __future__ import annotations

import sys
from copy import deepcopy
from pathlib import Path

import local_control


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _test_config() -> dict:
    return {
        "jobradar": {
            "enabled": True,
            "mode": "mock",
            "dry_run": True,
            "allow_real_apply": False,
            "keyword": "Python",
            "city": "杭州",
            "skills": "Python,FastAPI",
            "limit": 7,
        },
        "recruitradar": {
            "enabled": True,
            "mode": "mock",
            "dry_run": True,
            "allow_real_message": False,
            "keyword": "Python",
            "city": "杭州",
            "skills": "Python,FastAPI",
            "limit": 9,
        },
        "resume_center": {"enabled": True},
        "system": {"safety_guard_enabled": True, "scheduler_enabled": False},
    }


def test_save_config() -> None:
    saved = local_control.save_config(_test_config())
    assert_true(saved["jobradar"]["keyword"] == "Python", "jobradar keyword not saved")
    assert_true(saved["jobradar"]["city"] == "杭州", "jobradar city not saved")
    assert_true(saved["jobradar"]["skills"] == "Python,FastAPI", "jobradar skills not saved")
    assert_true(saved["jobradar"]["mode"] == "mock", "jobradar mode not saved")
    assert_true(saved["jobradar"]["dry_run"] is True, "jobradar dry_run not saved")
    assert_true(saved["jobradar"]["limit"] == 1, "jobradar limit must be forced to 1")
    assert_true(saved["recruitradar"]["limit"] == 1, "recruitradar limit must be forced to 1")
    loaded = local_control.load_config()
    assert_true(loaded["jobradar"]["city"] == "杭州", "config/local_control.yaml did not reload saved city")


def test_mock_jobradar_command_generation(config: dict) -> None:
    command = local_control.build_jobradar_command("search", config)
    assert_true(command[0] == sys.executable and command[1] == "-c", "mock jobradar search must be offline")
    assert_true("run_real_mode_smoke_test.py" not in command, "mock jobradar search must not use real smoke script")
    assert_true("--real" not in command, "mock jobradar search must not include --real")


def test_dry_apply_command_generation(config: dict) -> None:
    command = local_control.build_jobradar_command("dry_apply", config)
    assert_true(command[0] == sys.executable and command[1] == "-c", "mock dry apply must be offline")
    assert_true("dry_apply" in command[2], "dry apply command should identify dry_apply action")


def test_recruitradar_mock_search_generation(config: dict) -> None:
    command = local_control.build_recruitradar_command("search", config)
    assert_true(command[0] == sys.executable and command[1] == "-c", "mock recruitradar search must be offline")
    assert_true("recruitradar_search.py" not in command, "mock recruitradar search must not call real search script")


def test_dangerous_actions_rejected(config: dict) -> None:
    config = deepcopy(config)
    config["jobradar"]["limit"] = 99
    config["jobradar"]["mode"] = "real"
    config["jobradar"]["allow_real_apply"] = True
    try:
        local_control.build_jobradar_command("apply_smoke", config, "")
        raise AssertionError("apply smoke without confirmation should fail")
    except PermissionError:
        pass
    apply_cmd = local_control.build_jobradar_command("apply_smoke", config, local_control.APPLY_CONFIRM)
    assert_true(apply_cmd[apply_cmd.index("--limit") + 1] == "1", "real apply smoke limit must be forced to 1")
    assert_true("--apply-smoke" in apply_cmd and "--confirm-apply" in apply_cmd, "apply smoke command missing safety flags")

    config["recruitradar"]["limit"] = 99
    config["recruitradar"]["mode"] = "real"
    config["recruitradar"]["allow_real_message"] = True
    try:
        local_control.build_recruitradar_command("message_smoke", config, "")
        raise AssertionError("message smoke without confirmation should fail")
    except PermissionError:
        pass
    message_cmd = local_control.build_recruitradar_command("message_smoke", config, local_control.MESSAGE_CONFIRM)
    assert_true(message_cmd[message_cmd.index("--limit") + 1] == "1", "real message smoke limit must be forced to 1")
    assert_true("--message-smoke" in message_cmd and "--confirm-send" in message_cmd, "message smoke command missing safety flags")


def _run_and_assert_last_run(run_type: str, command: list[str], expected_text: str) -> None:
    result = local_control.run_command(run_type, command, timeout_seconds=30)
    assert_true(result["success"] is True, f"{run_type} should succeed")
    assert_true(expected_text in result["stdout"], f"{run_type} stdout summary missing {expected_text}")
    assert_true(Path(local_control.LAST_RUN_PATH).exists(), "runtime/local_control_last_run.json was not written")
    last_run = local_control.load_last_run()
    assert_true(last_run is not None, "last_run could not be loaded")
    assert_true(last_run["run_type"] == run_type, f"{run_type} run_type not saved")
    assert_true(last_run["success"] is True, f"{run_type} success not saved")


def test_last_run_json_write(config: dict) -> None:
    config = deepcopy(config)
    config["jobradar"]["mode"] = "mock"
    config["recruitradar"]["mode"] = "mock"
    _run_and_assert_last_run(
        "test:jobradar:search",
        local_control.build_jobradar_command("search", config),
        '"action": "search"',
    )
    _run_and_assert_last_run(
        "test:jobradar:dry_apply",
        local_control.build_jobradar_command("dry_apply", config),
        '"action": "dry_apply"',
    )
    _run_and_assert_last_run(
        "test:recruitradar:search",
        local_control.build_recruitradar_command("search", config),
        '"target": "recruitradar"',
    )


def test_system_status() -> None:
    status = local_control.system_status()
    for key in ("db_ok", "ai_ok", "boss_auth_state_exists", "safety_guard_enabled", "scheduler_enabled"):
        assert_true(key in status, f"system status missing {key}")


def main() -> int:
    original_config = local_control.load_config()
    try:
        test_save_config()
        config = local_control.load_config()
        test_mock_jobradar_command_generation(config)
        test_dry_apply_command_generation(config)
        test_recruitradar_mock_search_generation(config)
        test_dangerous_actions_rejected(config)
        test_last_run_json_write(config)
        test_system_status()
    finally:
        local_control.save_config(original_config)
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

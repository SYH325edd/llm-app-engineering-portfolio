from __future__ import annotations

from datetime import datetime
from pathlib import Path

import scheduler


def write_config(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "jobradar_search:",
                "  enabled: true",
                "  cron: \"09:00\"",
                "  dry_run: true",
                "  keyword: \"Python\"",
                "  limit: 5",
                "",
                "jobradar_apply:",
                "  enabled: false",
                "  cron: \"09:00\"",
                "  dry_run: true",
                "  job_ids: []",
                "",
                "recruitradar_search:",
                "  enabled: true",
                "  cron: \"09:01\"",
                "  dry_run: true",
                "  keyword: \"AI\"",
                "",
                "recruitradar_message:",
                "  enabled: true",
                "  cron: \"09:00\"",
                "  dry_run: true",
                "  candidate_ids: [c1, c2]",
            ]
        ),
        encoding="utf-8",
    )


def test_config_parse(tmp_dir: Path) -> None:
    config_path = tmp_dir / "scheduler.yaml"
    write_config(config_path)
    config = scheduler.load_scheduler_config(config_path)
    assert config["jobradar_search"]["enabled"] is True
    assert config["jobradar_search"]["cron"] == "09:00"
    assert config["jobradar_search"]["limit"] == 5
    assert config["recruitradar_message"]["candidate_ids"] == ["c1", "c2"]


def test_tick_runs_due_tasks_once(tmp_dir: Path) -> None:
    config_path = tmp_dir / "scheduler.yaml"
    state_path = tmp_dir / "scheduler_state.json"
    write_config(config_path)
    state_path.unlink(missing_ok=True)
    calls: list[str] = []
    logs: list[dict] = []
    original_runners = scheduler.TASK_RUNNERS
    original_log = scheduler.log_event
    original_start = scheduler.persist_task_start
    original_finish = scheduler.persist_task_finish
    try:
        scheduler.TASK_RUNNERS = {
            "jobradar_search": lambda task: calls.append("jobradar_search"),
            "jobradar_apply": lambda task: calls.append("jobradar_apply"),
            "recruitradar_search": lambda task: calls.append("recruitradar_search"),
            "recruitradar_message": lambda task: calls.append("recruitradar_message"),
        }

        def fake_log_event(message, **kwargs):
            logs.append({"message": message, "payload": kwargs.get("payload")})
            return "log-id"

        scheduler.log_event = fake_log_event
        finishes: list[dict] = []
        scheduler.persist_task_start = lambda name, task: (f"task-{name}", f"run-{name}")
        scheduler.persist_task_finish = lambda task_id, run_id, **values: finishes.append(
            {"task_id": task_id, "run_id": run_id, **values}
        )
        now = datetime(2026, 6, 4, 9, 0)
        executed = scheduler.tick(now=now, config_path=config_path, state_path=state_path)
        assert executed == ["jobradar_search", "recruitradar_message"]
        assert calls == ["jobradar_search", "recruitradar_message"]
        assert all(item["payload"]["scheduler"] is True for item in logs)
        assert {item["payload"]["task_name"] for item in logs} == {"jobradar_search", "recruitradar_message"}
        assert [item["status"] for item in finishes] == ["completed", "completed"]

        executed = scheduler.tick(now=now, config_path=config_path, state_path=state_path)
        assert executed == []
        assert calls == ["jobradar_search", "recruitradar_message"]
    finally:
        scheduler.TASK_RUNNERS = original_runners
        scheduler.log_event = original_log
        scheduler.persist_task_start = original_start
        scheduler.persist_task_finish = original_finish


def test_disabled_and_time_skip(tmp_dir: Path) -> None:
    config_path = tmp_dir / "scheduler.yaml"
    state_path = tmp_dir / "scheduler_state.json"
    write_config(config_path)
    state_path.unlink(missing_ok=True)
    calls: list[str] = []
    original_runners = scheduler.TASK_RUNNERS
    original_log = scheduler.log_event
    original_start = scheduler.persist_task_start
    original_finish = scheduler.persist_task_finish
    try:
        scheduler.TASK_RUNNERS = {name: (lambda task, n=name: calls.append(n)) for name in scheduler.TASK_RUNNERS}
        scheduler.log_event = lambda *args, **kwargs: "log-id"
        scheduler.persist_task_start = lambda name, task: (f"task-{name}", f"run-{name}")
        scheduler.persist_task_finish = lambda *args, **kwargs: None
        executed = scheduler.tick(now=datetime(2026, 6, 4, 9, 2), config_path=config_path, state_path=state_path)
        assert executed == []
        assert calls == []
    finally:
        scheduler.TASK_RUNNERS = original_runners
        scheduler.log_event = original_log
        scheduler.persist_task_start = original_start
        scheduler.persist_task_finish = original_finish


def test_task_run_terminal_statuses(tmp_dir: Path) -> None:
    del tmp_dir
    original_runners = scheduler.TASK_RUNNERS
    original_log = scheduler.log_event
    original_start = scheduler.persist_task_start
    original_finish = scheduler.persist_task_finish
    finishes: list[dict] = []
    try:
        scheduler.log_event = lambda *args, **kwargs: "log-id"
        scheduler.persist_task_start = lambda name, task: (f"task-{name}", f"run-{name}")
        scheduler.persist_task_finish = lambda task_id, run_id, **values: finishes.append(values)

        scheduler.TASK_RUNNERS = {"ok": lambda task: [{"id": 1}, {"id": 2}]}
        assert scheduler.run_task("ok", {"enabled": True, "dry_run": True}) is True
        assert finishes[-1]["status"] == "completed"
        assert finishes[-1]["result_count"] == 2

        scheduler.TASK_RUNNERS = {"quota": lambda task: (_ for _ in ()).throw(PermissionError("Quota blocked real search: limit"))}
        assert scheduler.run_task("quota", {"enabled": True}) is False
        assert finishes[-1]["status"] == "quota_blocked"

        scheduler.TASK_RUNNERS = {"safety": lambda task: (_ for _ in ()).throw(PermissionError("Safety Guard blocked real search: risk"))}
        assert scheduler.run_task("safety", {"enabled": True}) is False
        assert finishes[-1]["status"] == "safety_blocked"

        scheduler.TASK_RUNNERS = {"quota_result": lambda task: {"success": False, "blocked": True, "message": "Quota blocked real apply: daily limit"}}
        assert scheduler.run_task("quota_result", {"enabled": True}) is False
        assert finishes[-1]["status"] == "quota_blocked"

        scheduler.TASK_RUNNERS = {"safety_result": lambda task: [{"success": False, "blocked": True, "message": "Safety Guard blocked real apply: risk"}]}
        assert scheduler.run_task("safety_result", {"enabled": True}) is False
        assert finishes[-1]["status"] == "safety_blocked"

        scheduler.TASK_RUNNERS = {"failed_result": lambda task: {"success": False, "error": "adapter failed"}}
        assert scheduler.run_task("failed_result", {"enabled": True}) is False
        assert finishes[-1]["status"] == "failed"

        assert scheduler.run_task("paused", {"enabled": False}) is False
        assert finishes[-1]["status"] == "paused"
    finally:
        scheduler.TASK_RUNNERS = original_runners
        scheduler.log_event = original_log
        scheduler.persist_task_start = original_start
        scheduler.persist_task_finish = original_finish


def main() -> int:
    tmp_dir = Path("runtime") / "scheduler_test"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    tests = [test_config_parse, test_tick_runs_due_tasks_once, test_disabled_and_time_skip, test_task_run_terminal_statuses]
    failures = []
    for test in tests:
        try:
            test(tmp_dir)
            print(f"PASSED {test.__name__}")
        except Exception as exc:
            failures.append((test.__name__, str(exc)))
            print(f"FAILED {test.__name__}: {exc}")
    if failures:
        print("Scheduler validation FAILED")
        return 1
    print("Scheduler validation PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from lakejob.infrastructure.database.jobs import log_event
from lakejob.infrastructure.database.jobs import db_conn
from lakejob.safety.guard import clamp_run_limit


CONFIG_PATH = Path("config") / "scheduler.yaml"
STATE_PATH = Path("runtime") / "scheduler_state.json"
LOG_PATH = Path("runtime") / "scheduler.log"
LOCK_PATH = Path("runtime") / "scheduler.lock"


def _coerce(value: str) -> Any:
    value = value.strip()
    if not value:
        return ""
    if value[0] in ("'", '"') and value[-1:] == value[0]:
        value = value[1:-1]
    if "\\u" in value:
        try:
            return value.encode("ascii").decode("unicode_escape")
        except UnicodeError:
            pass
    if value.lower() in ("true", "false"):
        return value.lower() == "true"
    if value.startswith("[") and value.endswith("]"):
        return [_coerce(item) for item in value[1:-1].split(",") if item.strip()]
    try:
        return int(value)
    except ValueError:
        return value


def load_scheduler_config(path: Path = CONFIG_PATH) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    tasks: dict[str, dict[str, Any]] = {}
    current: str | None = None
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        if not line.startswith((" ", "\t")) and line.endswith(":"):
            current = line[:-1].strip()
            tasks[current] = {}
            continue
        if current and ":" in line:
            key, value = line.strip().split(":", 1)
            tasks[current][key.strip()] = _coerce(value.strip())
    return tasks


def append_scheduler_log(message: str) -> None:
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().isoformat(timespec="seconds")
    with LOG_PATH.open("a", encoding="utf-8") as fh:
        fh.write(f"{timestamp} {message}\n")


def load_state(path: Path = STATE_PATH) -> dict[str, Any]:
    if not path.exists():
        return {"executed": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"executed": {}}


def save_state(state: dict[str, Any], path: Path = STATE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _minute_key(now: datetime) -> str:
    return now.strftime("%Y-%m-%d %H:%M")


def should_run(task_name: str, task: dict[str, Any], now: datetime, state: dict[str, Any]) -> bool:
    if not task.get("enabled", False):
        return False
    if str(task.get("cron") or "") != now.strftime("%H:%M"):
        return False
    executed = state.setdefault("executed", {})
    return executed.get(task_name) != _minute_key(now)


def mark_run(task_name: str, now: datetime, state: dict[str, Any]) -> None:
    state.setdefault("executed", {})[task_name] = _minute_key(now)


def _core_log(task_name: str, start_time: str, end_time: str, success: bool, error: str) -> None:
    try:
        log_event(
            "Scheduler task completed",
            level="info" if success else "error",
            log_type="task",
            entity_type="scheduler",
            payload={
                "scheduler": True,
                "task_name": task_name,
                "start_time": start_time,
                "end_time": end_time,
                "success": success,
                "error": error,
            },
        )
    except Exception as exc:
        append_scheduler_log(f"core log failed task={task_name} error={exc}")


def run_jobradar_search(task: dict[str, Any]) -> Any:
    import lakejob.application.jobs.search as jobradar_search

    limit = clamp_run_limit(int(task.get("limit", 1) or 1))
    return jobradar_search.search_jobs(
        str(task.get("keyword") or "Python"),
        city=str(task.get("city") or "全国"),
        skills=str(task.get("skills") or ""),
        limit=limit,
        allow_mock=bool(task.get("allow_mock", False)),
        auto_apply=False if task.get("dry_run", True) else bool(task.get("auto_apply", False)),
        apply_limit=clamp_run_limit(int(task.get("apply_limit", 1) or 1)),
        dry_run=bool(task.get("dry_run", True)),
    )


def run_jobradar_apply(task: dict[str, Any]) -> Any:
    import lakejob.application.jobs.apply as jobradar_apply

    dry_run = bool(task.get("dry_run", True))
    apply_limit = clamp_run_limit(int(task.get("apply_limit", 1) or 1))
    return jobradar_apply.apply_jobs(
        job_ids=[str(item) for item in task.get("job_ids", [])],
        job_urls=[str(item) for item in task.get("job_urls", [])],
        dry_run=dry_run,
        apply_limit=apply_limit,
    )


def run_recruitradar_search(task: dict[str, Any]) -> Any:
    import lakejob.application.recruiting.search as recruitradar_search

    dry_run = bool(task.get("dry_run", True))
    return recruitradar_search.search_candidates(
        str(task.get("keyword") or "Python"),
        job_title=str(task.get("job_title") or ""),
        skills=str(task.get("skills") or ""),
        regions=str(task.get("regions") or ""),
        limit=clamp_run_limit(int(task.get("limit", 1) or 1)),
        auto_message=False if dry_run else bool(task.get("auto_message", False)),
        message_limit=clamp_run_limit(int(task.get("message_limit", 1) or 1)),
    )


def run_message_draft(task: dict[str, Any]) -> Any:
    import lakejob.application.recruiting.message as recruitradar_msg

    candidate_ids = [str(item) for item in task.get("candidate_ids", [])]
    limit = clamp_run_limit(int(task.get("message_limit", 1) or 1))
    return [
        recruitradar_msg.send_candidate_message(
            candidate_id,
            message_type=str(task.get("message_type") or "invite"),
            requirements={
                "job_title": task.get("job_title") or "",
                "skills": task.get("skills") or "",
                "regions": task.get("regions") or "",
            },
            job_id=task.get("job_id") or None,
        )
        for candidate_id in candidate_ids[:limit]
    ]


TASK_RUNNERS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "jobradar_search": run_jobradar_search,
    "jobradar_apply": run_jobradar_apply,
    "recruitradar_search": run_recruitradar_search,
    "message_draft": run_message_draft,
    "recruitradar_message": run_message_draft,
}

TASK_TYPES = {
    "jobradar_search": "search_jobs",
    "jobradar_apply": "custom",
    "recruitradar_search": "search_candidates",
    "message_draft": "message_draft",
    "recruitradar_message": "message_draft",
}


@contextmanager
def scheduler_lock(path: Path = LOCK_PATH):
    path.parent.mkdir(parents=True, exist_ok=True)
    handle = path.open("a+")
    locked = False
    try:
        handle.seek(0)
        if os.name == "nt":
            import msvcrt

            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise RuntimeError("scheduler lock is already held") from exc
        else:
            import fcntl

            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise RuntimeError("scheduler lock is already held") from exc
        locked = True
        yield
    finally:
        if locked:
            try:
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            except OSError:
                pass
        handle.close()


def _json(value: Any) -> str:
    return json.dumps(value or {}, ensure_ascii=False, default=str)


def _one_id(cur) -> str:
    row = cur.fetchone()
    if not row:
        raise RuntimeError("scheduler persistence did not return an id")
    return str(row[0])


def persist_task_start(task_name: str, task: dict[str, Any]) -> tuple[str, str]:
    """Persist the task definition and a running attempt before execution."""
    task_type = TASK_TYPES.get(task_name, "custom")
    user_id = os.getenv("LAKEJOB_USER_ID") or None
    organization_id = os.getenv("LAKEJOB_ORGANIZATION_ID") or None
    payload = {**task, "scheduler_task_name": task_name}
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id FROM tasks
            WHERE name = %s AND schedule_type = 'cron'
              AND payload->>'scheduler_task_name' = %s
            ORDER BY created_at DESC LIMIT 1
            FOR UPDATE
            """,
            (task_name, task_name),
        )
        row = cur.fetchone()
        if row:
            task_id = str(row[0])
            cur.execute(
                """
                UPDATE tasks
                SET task_type=%s, schedule_expr=%s, payload=%s::jsonb,
                    status='running', last_run_at=now(), updated_at=now()
                WHERE id=%s
                """,
                (task_type, str(task.get("cron") or ""), _json(payload), task_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO tasks (
                    task_type, name, schedule_type, schedule_expr, payload,
                    status, last_run_at
                ) VALUES (%s,%s,'cron',%s,%s::jsonb,'running',now())
                RETURNING id
                """,
                (task_type, task_name, str(task.get("cron") or ""), _json(payload)),
            )
            task_id = _one_id(cur)
        cur.execute(
            """
            INSERT INTO task_runs (
                task_id, user_id, organization_id, task_type, status, started_at,
                result_count, quota_consumed, result
            ) VALUES (%s,%s,%s,%s,'running',now(),0,0,'{}'::jsonb)
            RETURNING id
            """,
            (task_id, user_id, organization_id, task_type),
        )
        return task_id, _one_id(cur)


def persist_task_finish(
    task_id: str,
    run_id: str,
    *,
    status: str,
    result: Any = None,
    result_count: int = 0,
    quota_consumed: int = 0,
    error_code: str = "",
    error_message: str = "",
) -> None:
    task_status = "completed" if status == "completed" else "paused" if status == "paused" else "failed"
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE task_runs
            SET status=%s, finished_at=now(), result=%s::jsonb,
                result_count=%s, quota_consumed=%s, error_code=%s,
                error_message=%s, last_error=%s,
                next_retry_at=CASE WHEN %s = 'failed' THEN now() + interval '5 minutes' ELSE NULL END,
                updated_at=now()
            WHERE id=%s
            """,
            (
                status, _json(result), max(0, result_count), max(0, quota_consumed),
                error_code or None, error_message or None, error_message or None, status, run_id,
            ),
        )
        cur.execute(
            "UPDATE tasks SET status=%s, updated_at=now() WHERE id=%s",
            (task_status, task_id),
        )


def _result_count(result: Any) -> int:
    if isinstance(result, list):
        return len(result)
    if isinstance(result, dict):
        for key in ("result_count", "count", "saved", "found"):
            if isinstance(result.get(key), int):
                return max(0, int(result[key]))
        for key in ("results", "jobs", "candidates", "items"):
            if isinstance(result.get(key), list):
                return len(result[key])
    return 0


def _quota_consumed(task_name: str, task: dict[str, Any], result: Any) -> int:
    if isinstance(result, dict) and isinstance(result.get("quota_consumed"), int):
        return max(0, int(result["quota_consumed"]))
    if task_name in {"jobradar_search", "recruitradar_search"}:
        return 1
    if bool(task.get("dry_run", True)):
        return 0
    if isinstance(result, list):
        return sum(1 for item in result if not isinstance(item, dict) or item.get("success", True))
    return 0


def _error_status(exc: Exception) -> tuple[str, str]:
    text = str(exc)
    lowered = text.lower()
    if "quota blocked" in lowered or "quota_" in lowered:
        return "quota_blocked", "quota_blocked"
    if "safety guard blocked" in lowered or "safety_blocked" in lowered:
        return "safety_blocked", "safety_blocked"
    return "failed", type(exc).__name__.lower()


def _result_status(result: Any) -> tuple[str, str, str]:
    items = result if isinstance(result, list) else [result]
    dictionaries = [item for item in items if isinstance(item, dict)]
    for item in dictionaries:
        message = str(item.get("error") or item.get("message") or item.get("reason") or "")
        lowered = message.lower()
        if item.get("blocked") and ("quota" in lowered or item.get("quota_policy")):
            return "quota_blocked", "quota_blocked", message
        if item.get("blocked") and ("safety" in lowered or item.get("safety_guard")):
            return "safety_blocked", "safety_blocked", message
    failures = [item for item in dictionaries if item.get("success") is False]
    if failures and len(failures) == len(items):
        message = str(failures[0].get("error") or failures[0].get("message") or "task returned failure")
        return "failed", "runner_failed", message
    return "completed", "", ""


def run_task(task_name: str, task: dict[str, Any], now: datetime | None = None) -> bool:
    start = datetime.now()
    start_text = start.isoformat(timespec="seconds")
    success = False
    error = ""
    task_id = ""
    run_id = ""
    result: Any = None
    try:
        append_scheduler_log(f"execute task={task_name}")
        task_id, run_id = persist_task_start(task_name, task)
        if not task.get("enabled", True) or str(task.get("status") or "").lower() == "paused":
            persist_task_finish(task_id, run_id, status="paused", result={"reason": "task_paused"})
            return False
        runner = TASK_RUNNERS.get(task_name)
        if runner is None:
            raise RuntimeError(f"Unknown scheduler task: {task_name}")
        result = runner(task)
        status, error_code, error_message = _result_status(result)
        persist_task_finish(
            task_id,
            run_id,
            status=status,
            result=result,
            result_count=_result_count(result),
            quota_consumed=_quota_consumed(task_name, task, result) if status == "completed" else 0,
            error_code=error_code,
            error_message=error_message,
        )
        success = status == "completed"
        error = error_message
        return success
    except Exception as exc:
        error = str(exc)
        append_scheduler_log(f"exception task={task_name} error={error}")
        if task_id and run_id:
            status, error_code = _error_status(exc)
            try:
                persist_task_finish(
                    task_id, run_id, status=status, result=result,
                    error_code=error_code, error_message=error,
                )
            except Exception as persist_exc:
                append_scheduler_log(f"task run finalization failed task={task_name} error={persist_exc}")
        try:
            from lakejob.safety.audit import record_audit

            record_audit(
                "task.failed", target_type="scheduler_task", target_id=task_name,
                outcome="failure", metadata={"error": error[:500]},
            )
        except Exception as audit_exc:
            append_scheduler_log(f"audit log failed task={task_name} error={audit_exc}")
        return False
    finally:
        end_text = datetime.now().isoformat(timespec="seconds")
        _core_log(task_name, start_text, end_text, success, error)


def tick(
    *,
    now: datetime | None = None,
    config_path: Path = CONFIG_PATH,
    state_path: Path = STATE_PATH,
) -> list[str]:
    lock_path = state_path.with_suffix(".lock")
    with scheduler_lock(lock_path):
        current = now or datetime.now()
        config = load_scheduler_config(config_path)
        state = load_state(state_path)
        executed: list[str] = []
        for task_name, task in config.items():
            task.setdefault("dry_run", True)
            if not should_run(task_name, task, current, state):
                continue
            mark_run(task_name, current, state)
            save_state(state, state_path)
            run_task(task_name, task, current)
            executed.append(task_name)
        save_state(state, state_path)
        return executed


def main() -> int:
    append_scheduler_log("scheduler started")
    print("LakeJob scheduler started. Press Ctrl+C to stop.")
    try:
        while True:
            tick()
            time.sleep(60)
    except KeyboardInterrupt:
        append_scheduler_log("scheduler stopped")
        print("LakeJob scheduler stopped.")
        return 0
    except Exception as exc:
        append_scheduler_log(f"scheduler exception error={exc}")
        raise


if __name__ == "__main__":
    raise SystemExit(main())

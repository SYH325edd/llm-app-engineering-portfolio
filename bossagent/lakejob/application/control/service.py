"""Local Control Center service for LakeJob Web Console."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from lakejob.paths import PROJECT_ROOT
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover
    yaml = None


ROOT = PROJECT_ROOT
CONFIG_PATH = PROJECT_ROOT / "config" / "local_control.yaml"
LAST_RUN_PATH = PROJECT_ROOT / "runtime" / "local_control_last_run.json"
BOSS_AUTH_STATE = PROJECT_ROOT / "runtime" / "boss_auth_state.json"

APPLY_CONFIRM = "APPLY_ONE_REAL_JOB"
MESSAGE_CONFIRM = "SEND_ONE_REAL_MESSAGE"

DEFAULT_CONFIG = {
    "jobradar": {
        "enabled": True,
        "mode": "mock",
        "dry_run": True,
        "allow_real_apply": False,
        "keyword": "Python",
        "city": "杭州",
        "skills": "Python,FastAPI",
        "limit": 1,
    },
    "recruitradar": {
        "enabled": True,
        "mode": "mock",
        "dry_run": True,
        "allow_real_message": False,
        "keyword": "Python",
        "city": "杭州",
        "skills": "Python,FastAPI",
        "limit": 1,
    },
    "resume_center": {"enabled": True},
    "system": {"safety_guard_enabled": True, "scheduler_enabled": False},
}


def _deepcopy(data: Any) -> Any:
    return json.loads(json.dumps(data, ensure_ascii=False))


def _load_simple_yaml(text: str) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current: str | None = None
    for line in text.splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if not line.startswith(" "):
            key, _, value = line.partition(":")
            key = key.strip()
            if value.strip():
                data[key] = _parse_scalar(value)
                current = None
            else:
                data[key] = {}
                current = key
            continue
        if current and isinstance(data.get(current), dict):
            key, _, value = line.strip().partition(":")
            data[current][key.strip()] = _parse_scalar(value)
    return data


def _parse_scalar(value: str) -> Any:
    value = value.strip().strip("'\"")
    if value.lower() == "true":
        return True
    if value.lower() == "false":
        return False
    try:
        return int(value)
    except ValueError:
        return value


def _dump_simple_yaml(data: dict[str, Any]) -> str:
    lines: list[str] = []
    for key, value in data.items():
        lines.append(f"{key}:")
        for subkey, subvalue in (value or {}).items():
            lines.append(f"  {subkey}: {_format_scalar(subvalue)}")
    return "\n".join(lines) + "\n"


def _format_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    text = str(value or "")
    if text == "" or ":" in text or any(char.isspace() for char in text):
        return json.dumps(text, ensure_ascii=False)
    return text


def _merge_defaults(config: dict[str, Any]) -> dict[str, Any]:
    merged = _deepcopy(DEFAULT_CONFIG)
    for section, values in (config or {}).items():
        if section in merged and isinstance(values, dict):
            merged[section].update(values)
    merged["jobradar"]["limit"] = min(1, int(merged["jobradar"].get("limit") or 1))
    merged["recruitradar"]["limit"] = min(1, int(merged["recruitradar"].get("limit") or 1))
    for section in ("jobradar", "recruitradar"):
        merged[section]["city"] = _decode_unicode_escape(str(merged[section].get("city") or ""))
    return merged


def _decode_unicode_escape(value: str) -> str:
    if "\\u" not in value:
        return value
    try:
        return value.encode("ascii").decode("unicode_escape")
    except UnicodeError:
        return value


def load_config() -> dict[str, Any]:
    if not CONFIG_PATH.exists():
        save_config(DEFAULT_CONFIG)
        return _deepcopy(DEFAULT_CONFIG)
    text = CONFIG_PATH.read_text(encoding="utf-8")
    if yaml is not None:
        config = yaml.safe_load(text) or {}
    else:
        config = _load_simple_yaml(text)
    return _merge_defaults(config)


def save_config(config: dict[str, Any]) -> dict[str, Any]:
    normalized = _merge_defaults(config)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    if yaml is not None:
        CONFIG_PATH.write_text(yaml.safe_dump(normalized, sort_keys=False, allow_unicode=True), encoding="utf-8")
    else:
        CONFIG_PATH.write_text(_dump_simple_yaml(normalized), encoding="utf-8")
    return normalized


def _bool_form(value: Any) -> bool:
    return str(value).lower() in {"1", "true", "yes", "on"}


def config_from_form(form: dict[str, Any], current: dict[str, Any] | None = None) -> dict[str, Any]:
    config = _merge_defaults(current or {})
    if "control_settings_form" in form:
        config["jobradar"]["enabled"] = _bool_form(form.get("jobradar_enabled"))
        config["recruitradar"]["enabled"] = _bool_form(form.get("recruitradar_enabled"))
        config["system"] = {
            "safety_guard_enabled": True,
            "scheduler_enabled": _bool_form(form.get("scheduler_enabled")),
        }
        return config
    config["jobradar"] = {
        "enabled": _bool_form(form.get("jobradar_enabled")),
        "mode": "real" if form.get("jobradar_mode") == "real" else "mock",
        "dry_run": _bool_form(form.get("jobradar_dry_run", "true")),
        "allow_real_apply": _bool_form(form.get("jobradar_allow_real_apply")),
        "keyword": str(form.get("jobradar_keyword") or "Python"),
        "city": str(form.get("jobradar_city") or ""),
        "skills": str(form.get("jobradar_skills") or ""),
        "limit": min(1, int(form.get("jobradar_limit") or 1)),
    }
    config["recruitradar"] = {
        "enabled": _bool_form(form.get("recruitradar_enabled")),
        "mode": "real" if form.get("recruitradar_mode") == "real" else "mock",
        "dry_run": _bool_form(form.get("recruitradar_dry_run", "true")),
        "allow_real_message": _bool_form(form.get("recruitradar_allow_real_message")),
        "keyword": str(form.get("recruitradar_keyword") or "Python"),
        "city": str(form.get("recruitradar_city") or ""),
        "skills": str(form.get("recruitradar_skills") or ""),
        "limit": min(1, int(form.get("recruitradar_limit") or 1)),
    }
    config["resume_center"] = {"enabled": _bool_form(form.get("resume_center_enabled"))}
    config["system"] = {
        "safety_guard_enabled": True,
        "scheduler_enabled": _bool_form(form.get("scheduler_enabled")),
    }
    return config


def command_to_string(command: list[str]) -> str:
    return " ".join(f'"{item}"' if " " in item else item for item in command)


def _mock_control_command(payload: dict[str, Any]) -> list[str]:
    script = "import json; print(json.dumps(%r, ensure_ascii=False, indent=2))" % payload
    return [sys.executable, "-c", script]


def build_jobradar_command(action: str, config: dict[str, Any], confirm_phrase: str = "") -> list[str]:
    cfg = _merge_defaults(config)["jobradar"]
    limit = min(1, int(cfg.get("limit") or 1))
    keyword = str(cfg.get("keyword") or "Python")
    if cfg.get("mode") != "real":
        if action == "search":
            return _mock_control_command(
                {
                    "ok": True,
                    "target": "jobradar",
                    "action": "search",
                    "mode": "mock",
                    "dry_run": True,
                    "keyword": keyword,
                    "city": str(cfg.get("city") or ""),
                    "skills": str(cfg.get("skills") or ""),
                    "limit": limit,
                    "boss_opened": False,
                    "messages_sent": 0,
                    "applications_sent": 0,
                }
            )
        if action == "apply_smoke":
            raise PermissionError("real apply smoke requires real mode")
        if action == "dry_apply":
            return _mock_control_command(
                {
                    "ok": True,
                    "target": "jobradar",
                    "action": "dry_apply",
                    "mode": "mock",
                    "dry_run": True,
                    "keyword": keyword,
                    "city": str(cfg.get("city") or ""),
                    "skills": str(cfg.get("skills") or ""),
                    "limit": limit,
                    "boss_opened": False,
                    "messages_sent": 0,
                    "applications_sent": 0,
                }
            )
    command = [sys.executable, "-m", "scripts.run_real_mode_smoke_test", "--mode", "jobradar", "--keyword", keyword, "--limit", str(limit)]
    if cfg.get("city"):
        command.extend(["--city", str(cfg["city"])])
    if cfg.get("skills"):
        command.extend(["--skills", str(cfg["skills"])])
    if cfg.get("mode") == "real":
        command.append("--real")
    else:
        command.append("--allow-mock")

    if action == "search":
        command.append("--dry-run")
        return command
    if action == "dry_apply":
        command.append("--dry-apply")
        return command
    if action == "apply_smoke":
        if not cfg.get("allow_real_apply"):
            raise PermissionError("real apply is disabled in Control Center config")
        if confirm_phrase != APPLY_CONFIRM:
            raise PermissionError("真实投递必须输入确认短语 APPLY_ONE_REAL_JOB")
        command.extend(["--apply-smoke", "--send-real", "--confirm-apply", APPLY_CONFIRM])
        return command
    raise ValueError(f"unsupported JobRadar action: {action}")


def build_recruitradar_command(action: str, config: dict[str, Any], confirm_phrase: str = "") -> list[str]:
    cfg = _merge_defaults(config)["recruitradar"]
    limit = min(1, int(cfg.get("limit") or 1))
    keyword = str(cfg.get("keyword") or "Python")
    if cfg.get("mode") != "real":
        if action in {"search", "score"}:
            return _mock_control_command(
                {
                    "ok": True,
                    "target": "recruitradar",
                    "action": action,
                    "mode": "mock",
                    "dry_run": True,
                    "keyword": keyword,
                    "city": str(cfg.get("city") or ""),
                    "skills": str(cfg.get("skills") or ""),
                    "limit": limit,
                    "boss_opened": False,
                    "messages_sent": 0,
                    "applications_sent": 0,
                }
            )
        if action == "message_smoke":
            raise PermissionError("real message smoke requires real mode")
    if action == "search":
        command = [sys.executable, "-m", "lakejob.application.recruiting.search", keyword, "--limit", str(limit)]
        if cfg.get("city"):
            command.extend(["--regions", str(cfg["city"])])
        if cfg.get("skills"):
            command.extend(["--skills", str(cfg["skills"])])
        if cfg.get("mode") == "real":
            command.append("--real")
        if cfg.get("dry_run", True):
            command.append("--dry-run")
        return command
    if action == "score":
        command = [sys.executable, "-m", "lakejob.application.recruiting.score", "--candidates-json", "[]", "--skills", str(cfg.get("skills") or "")]
        return command
    if action == "message_smoke":
        if not cfg.get("allow_real_message"):
            raise PermissionError("real message is disabled in Control Center config")
        if confirm_phrase != MESSAGE_CONFIRM:
            raise PermissionError("真实消息必须输入确认短语 SEND_ONE_REAL_MESSAGE")
        disabled_script = "raise SystemExit('RecruitRadar real message smoke is disabled')"
        return [
            sys.executable,
            "-c",
            disabled_script,
            "--message-smoke",
            "--confirm-send",
            MESSAGE_CONFIRM,
            "--limit",
            "1",
        ]
    raise ValueError(f"unsupported RecruitRadar action: {action}")


def run_command(run_type: str, command: list[str], timeout_seconds: int = 120) -> dict[str, Any]:
    started_at = datetime.now().isoformat(timespec="seconds")
    try:
        proc = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, timeout=timeout_seconds)
        success = proc.returncode == 0
        result = {
            "run_at": started_at,
            "run_type": run_type,
            "command": command_to_string(command),
            "success": success,
            "returncode": proc.returncode,
            "stdout": (proc.stdout or "")[-4000:],
            "stderr": (proc.stderr or "")[-4000:],
        }
    except subprocess.TimeoutExpired as exc:
        result = {
            "run_at": started_at,
            "run_type": run_type,
            "command": command_to_string(command),
            "success": False,
            "returncode": "timeout",
            "stdout": (exc.stdout or "")[-4000:] if isinstance(exc.stdout, str) else "",
            "stderr": "Command timed out after 120 seconds",
        }
    save_last_run(result)
    log_control_run(result)
    return result


def save_last_run(result: dict[str, Any]) -> None:
    LAST_RUN_PATH.parent.mkdir(parents=True, exist_ok=True)
    LAST_RUN_PATH.write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")


def load_last_run() -> dict[str, Any] | None:
    if not LAST_RUN_PATH.exists():
        return None
    return json.loads(LAST_RUN_PATH.read_text(encoding="utf-8"))


def log_control_run(result: dict[str, Any]) -> None:
    try:
        from lakejob.infrastructure.database.jobs import log_event

        log_event(
            "local control run",
            log_type="task",
            level="info" if result.get("success") else "warning",
            payload={"local_control": True, **result},
        )
    except Exception as exc:
        print(f"WARN: failed to write local control log: {exc}")


def _count_today_log(flag: str) -> int:
    try:
        from lakejob.application.recruiting.talent_pool import db_conn

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT COUNT(*)
                FROM logs
                WHERE created_at::date = CURRENT_DATE
                  AND COALESCE((payload->>%s)::boolean, false) = true
                """,
                (flag,),
            )
            return int(cur.fetchone()[0])
    except Exception:
        return 0


def system_status() -> dict[str, Any]:
    from lakejob.infrastructure.ai.provider import get_ai_provider
    from lakejob.application.control.actions import load_real_run_config, load_scheduler_config

    real_cfg = load_real_run_config()
    scheduler_cfg = load_scheduler_config()
    ai_ok = False
    ai_error = ""
    try:
        ai_health = get_ai_provider().health_check()
        ai_ok = bool(ai_health.get("ok"))
        ai_error = str(ai_health.get("error") or "")
    except Exception as exc:
        ai_error = str(exc)

    db_ok = True
    db_error = ""
    try:
        from lakejob.application.recruiting.talent_pool import db_conn

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
    except Exception as exc:
        db_ok = False
        db_error = str(exc)

    auth_exists = BOSS_AUTH_STATE.exists()
    auth_updated_at = ""
    if auth_exists:
        auth_updated_at = datetime.fromtimestamp(BOSS_AUTH_STATE.stat().st_mtime).isoformat(timespec="seconds")

    return {
        "safety_guard_enabled": True,
        "scheduler_enabled": any(bool((task or {}).get("enabled")) for task in scheduler_cfg.values() if isinstance(task, dict)),
        "today_real_applies": _count_today_log("real_apply"),
        "daily_real_apply_limit": real_cfg.get("daily_real_apply_limit", 5),
        "today_real_messages": _count_today_log("real_send"),
        "daily_real_message_limit": real_cfg.get("daily_real_message_limit", 5),
        "min_interval": real_cfg.get("min_action_interval_seconds") or real_cfg.get("min_interval_seconds"),
        "random_delay": real_cfg.get("random_delay_seconds") or real_cfg.get("random_delay_range_seconds"),
        "boss_auth_state_exists": auth_exists,
        "boss_auth_state_updated_at": auth_updated_at,
        "db_ok": db_ok,
        "db_error": db_error,
        "ai_ok": ai_ok,
        "ai_error": ai_error,
    }


def resume_center_status() -> dict[str, Any]:
    from lakejob.application.resumes.center import get_resume_ai_status

    status = get_resume_ai_status()
    try:
        from lakejob.application.recruiting.talent_pool import db_conn

        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM candidates WHERE raw_data->>'source' = 'resume'")
            status["resume_count"] = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM candidates WHERE raw_data->'resume_center'->>'ai_parse_status' = 'success'")
            status["success_count"] = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM candidates WHERE raw_data->'resume_center'->>'fallback_used' = 'true'")
            status["fallback_count"] = int(cur.fetchone()[0])
    except Exception:
        status["resume_count"] = 0
        status["success_count"] = 0
        status["fallback_count"] = 0
    return status

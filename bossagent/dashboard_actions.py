"""Configuration actions for the local LakeJob dashboard."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

try:
    import yaml  # type: ignore
except ImportError:  # pragma: no cover - exercised only when PyYAML is absent.
    yaml = None


ROOT = Path(__file__).resolve().parent
REAL_RUN_CONFIG = ROOT / "config" / "real_run_config.yaml"
SCHEDULER_CONFIG = ROOT / "config" / "scheduler.yaml"

CONFIG_LIMITS = {
    "daily_real_apply_limit": {"type": int, "min": 0, "max": 20},
    "daily_real_message_limit": {"type": int, "min": 0, "max": 20},
    "max_items_per_run": {"type": int, "min": 1, "max": 10},
    "min_action_interval_seconds": {"type": int, "min": 30, "max": None},
    "min_interval_seconds": {"type": int, "min": 30, "max": None},
}

SCHEDULER_TASKS = {
    "jobradar_search",
    "jobradar_apply",
    "recruitradar_search",
    "recruitradar_message",
}

AI_PROVIDERS = {"mock", "deepseek"}


@dataclass
class ActionResult:
    success: bool
    message: str


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        text = handle.read()
    if yaml is not None:
        return yaml.safe_load(text) or {}
    return _load_simple_yaml(text)


def save_yaml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        if yaml is not None:
            yaml.safe_dump(data, handle, sort_keys=False, allow_unicode=True)
        else:
            handle.write(_dump_simple_yaml(data))


def _parse_scalar(raw: str) -> Any:
    value = raw.strip()
    if value == "":
        return ""
    if value == "[]":
        return []
    if value.startswith("[") and value.endswith("]"):
        items = [item.strip() for item in value[1:-1].split(",") if item.strip()]
        return [_parse_scalar(item) for item in items]
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        value = value[1:-1]
    if "\\u" in value:
        try:
            value = value.encode("utf-8").decode("unicode_escape")
        except UnicodeDecodeError:
            pass
    lowered = value.lower()
    if lowered == "true":
        return True
    if lowered == "false":
        return False
    try:
        return int(value)
    except ValueError:
        return value


def _load_simple_yaml(text: str) -> dict[str, Any]:
    data: dict[str, Any] = {}
    current_key: str | None = None
    for raw_line in text.splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#"):
            continue
        if not raw_line.startswith(" "):
            key, _, value = raw_line.partition(":")
            key = key.strip()
            value = value.strip()
            if value:
                data[key] = _parse_scalar(value)
                current_key = None
            else:
                data[key] = {}
                current_key = key
            continue
        if current_key is None:
            continue
        stripped = raw_line.strip()
        if stripped.startswith("- "):
            if not isinstance(data.get(current_key), list):
                data[current_key] = []
            data[current_key].append(_parse_scalar(stripped[2:]))
            continue
        subkey, _, value = stripped.partition(":")
        if not isinstance(data.get(current_key), dict):
            data[current_key] = {}
        data[current_key][subkey.strip()] = _parse_scalar(value)
    return data


def _format_scalar(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_format_scalar(item) for item in value) + "]"
    text = str(value)
    if text == "" or any(char.isspace() for char in text) or ":" in text:
        return '"' + text.replace('"', '\\"') + '"'
    return text


def _dump_simple_yaml(data: dict[str, Any]) -> str:
    lines: list[str] = []
    for key, value in data.items():
        if isinstance(value, dict):
            lines.append(f"{key}:")
            for subkey, subvalue in value.items():
                lines.append(f"  {subkey}: {_format_scalar(subvalue)}")
        elif isinstance(value, list) and key == "risk_keywords":
            lines.append(f"{key}:")
            for item in value:
                lines.append(f"  - {_format_scalar(item)}")
        else:
            lines.append(f"{key}: {_format_scalar(value)}")
    return "\n".join(lines) + "\n"


def load_real_run_config() -> dict[str, Any]:
    return load_yaml(REAL_RUN_CONFIG)


def load_scheduler_config() -> dict[str, Any]:
    return load_yaml(SCHEDULER_CONFIG)


def _parse_config_value(key: str, raw_value: str) -> Any:
    rule = CONFIG_LIMITS.get(key)
    if not rule:
        raise ValueError(f"unsupported config key: {key}")
    try:
        value = rule["type"](raw_value)
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer") from exc
    min_value = rule.get("min")
    max_value = rule.get("max")
    if min_value is not None and value < min_value:
        raise ValueError(f"{key} must be >= {min_value}")
    if max_value is not None and value > max_value:
        raise ValueError(f"{key} must be <= {max_value}")
    return value


def log_dashboard_action(
    *,
    command: str,
    before: Any,
    after: Any,
    success: bool,
    error: str = "",
) -> None:
    try:
        from jobradar_log import log_event

        log_event(
            "dashboard action",
            log_type="audit",
            level="info" if success else "warning",
            payload={
                "dashboard_action": True,
                "command": command,
                "before": before,
                "after": after,
                "success": success,
                "error": error,
            },
        )
    except Exception as exc:
        print(f"WARN: failed to write dashboard action log: {exc}")


def log_web_ai_action(
    *,
    action: str,
    provider: str,
    success: bool,
    error: str = "",
    before: Any = None,
    after: Any = None,
) -> None:
    try:
        from jobradar_log import log_event

        log_event(
            "web console ai settings",
            log_type="audit",
            level="info" if success else "warning",
            payload={
                "web_console": True,
                "ai_settings": True,
                "action": action,
                "provider": provider,
                "before": before,
                "after": after,
                "success": success,
                "error": error,
            },
        )
    except Exception as exc:
        print(f"WARN: failed to write AI settings log: {exc}")


def apply_config_set(key: str, raw_value: str, *, command: str) -> ActionResult:
    config = load_real_run_config()
    before = config.get(key)
    try:
        value = _parse_config_value(key, raw_value)
        config[key] = value
        if key == "min_action_interval_seconds":
            config["min_interval_seconds"] = value
        if key == "min_interval_seconds":
            config["min_action_interval_seconds"] = value
        save_yaml(REAL_RUN_CONFIG, config)
        log_dashboard_action(command=command, before={key: before}, after={key: value}, success=True)
        return ActionResult(True, f"Updated {key}: {before} -> {value}")
    except Exception as exc:
        log_dashboard_action(command=command, before={key: before}, after={key: raw_value}, success=False, error=str(exc))
        return ActionResult(False, f"[red]Config update failed: {exc}[/red]")


def apply_scheduler_command(action: str, task_name: str, *, command: str) -> ActionResult:
    scheduler = load_scheduler_config()
    if task_name not in SCHEDULER_TASKS:
        message = f"unsupported scheduler task: {task_name}"
        log_dashboard_action(command=command, before=None, after=None, success=False, error=message)
        return ActionResult(False, f"[red]{message}[/red]")
    if action not in {"enable", "disable"}:
        message = f"unsupported scheduler action: {action}"
        log_dashboard_action(command=command, before=None, after=None, success=False, error=message)
        return ActionResult(False, f"[red]{message}[/red]")

    task = scheduler.setdefault(task_name, {})
    before = dict(task)
    task["enabled"] = action == "enable"

    if task_name in {"jobradar_apply", "recruitradar_message"}:
        task.setdefault("dry_run", True)
        if task.get("dry_run") is not True:
            task["dry_run"] = True

    save_yaml(SCHEDULER_CONFIG, scheduler)
    after = dict(task)
    log_dashboard_action(command=command, before=before, after=after, success=True)
    return ActionResult(True, f"Scheduler {task_name} {action}d")


def get_ai_settings_view() -> dict[str, Any]:
    import os

    config = load_real_run_config()
    ai_config = dict(config.get("ai") or {})
    return {
        "provider": str(ai_config.get("provider") or "mock"),
        "model": str(ai_config.get("model") or os.getenv("DEEPSEEK_MODEL") or "deepseek-chat"),
        "base_url": str(ai_config.get("base_url") or os.getenv("DEEPSEEK_BASE_URL") or "https://api.deepseek.com"),
        "has_deepseek_key": bool(os.getenv("DEEPSEEK_API_KEY")),
    }


def save_ai_settings(provider: str, model: str, base_url: str) -> ActionResult:
    provider = provider.strip().lower()
    model = model.strip()
    base_url = base_url.strip().rstrip("/")
    config = load_real_run_config()
    before = dict(config.get("ai") or {})
    try:
        if provider not in AI_PROVIDERS:
            raise ValueError("provider must be mock or deepseek")
        if not model:
            raise ValueError("model is required")
        if not base_url.startswith("https://"):
            raise ValueError("base_url must start with https://")
        after = {"provider": provider, "model": model, "base_url": base_url}
        config["ai"] = after
        save_yaml(REAL_RUN_CONFIG, config)
        log_web_ai_action(action="save_ai_settings", provider=provider, before=before, after=after, success=True)
        return ActionResult(True, "AI settings saved")
    except Exception as exc:
        log_web_ai_action(
            action="save_ai_settings",
            provider=provider or str(before.get("provider") or "unknown"),
            before=before,
            after={"provider": provider, "model": model, "base_url": base_url},
            success=False,
            error=str(exc),
        )
        return ActionResult(False, str(exc))


def test_ai_settings_connection() -> dict[str, Any]:
    from ai.provider import get_ai_provider, load_ai_config

    cfg = load_ai_config()
    provider_name = str(cfg.get("provider") or "mock")
    try:
        provider = get_ai_provider(cfg)
        health = provider.health_check()
        success = bool(health.get("ok"))
        error = "" if success else str(health.get("error") or "health_check failed")
        log_web_ai_action(action="test_ai_settings", provider=provider_name, success=success, error=error, after=health)
        return {"success": success, "provider": provider_name, "health": health, "error": error}
    except Exception as exc:
        error = str(exc)
        log_web_ai_action(action="test_ai_settings", provider=provider_name, success=False, error=error)
        return {"success": False, "provider": provider_name, "health": {}, "error": error}

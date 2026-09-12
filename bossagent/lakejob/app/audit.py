from __future__ import annotations

from typing import Any


def log_web_action(action: str, before: Any, after: Any, success: bool, error: str = "") -> None:
    try:
        from lakejob.infrastructure.database.jobs import log_event

        log_event(
            "web console action",
            log_type="audit",
            level="info" if success else "warning",
            payload={
                "web_console": True,
                "action": action,
                "before": before,
                "after": after,
                "success": success,
                "error": error,
            },
        )
    except Exception as exc:
        print(f"WARN: failed to write web console log: {exc}")

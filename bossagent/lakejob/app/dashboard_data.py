from __future__ import annotations

from typing import Any

from lakejob.application.control.actions import load_real_run_config
from lakejob.app.db import db_safe, fetch_dicts, fetch_scalar
from lakejob.app.payload import payload_obj


def dashboard_stats() -> dict[str, Any]:
    cfg = load_real_run_config()
    apply_limit = int(cfg.get("daily_real_apply_limit", 5))
    message_limit = int(cfg.get("daily_real_message_limit", 5))
    return {
        "today_searches": db_safe(
            0,
            fetch_scalar,
            """
            SELECT COUNT(*)
            FROM logs
            WHERE created_at::date = CURRENT_DATE
              AND (
                message ILIKE %s
                OR payload->>'task_name' IN ('jobradar_search', 'recruitradar_search')
                OR payload->>'action' ILIKE %s
              )
            """,
            ("%search%", "%search%"),
        ),
        "today_applications": db_safe(0, fetch_scalar, "SELECT COUNT(*) FROM applications WHERE created_at::date = CURRENT_DATE;"),
        "today_messages": db_safe(0, fetch_scalar, "SELECT COUNT(*) FROM messages WHERE created_at::date = CURRENT_DATE;"),
        "today_new_candidates": db_safe(0, fetch_scalar, "SELECT COUNT(*) FROM candidates WHERE created_at::date = CURRENT_DATE;"),
        "today_safety_blocks": db_safe(
            0,
            fetch_scalar,
            """
            SELECT COUNT(*)
            FROM logs
            WHERE created_at::date = CURRENT_DATE
              AND COALESCE((payload->>'safety_guard')::boolean, false) = true
              AND COALESCE((payload->>'blocked')::boolean, false) = true
            """,
        ),
        "today_real_applies": db_safe(
            0,
            fetch_scalar,
            """
            SELECT COUNT(*)
            FROM logs
            WHERE created_at::date = CURRENT_DATE
              AND COALESCE((payload->>'real_apply')::boolean, false) = true
            """,
        ),
        "today_real_messages": db_safe(
            0,
            fetch_scalar,
            """
            SELECT COUNT(*)
            FROM logs
            WHERE created_at::date = CURRENT_DATE
              AND COALESCE((payload->>'real_send')::boolean, false) = true
            """,
        ),
        "daily_real_apply_limit": apply_limit,
        "daily_real_message_limit": message_limit,
    }


def recent_task_flow(limit: int = 10) -> list[dict[str, Any]]:
    rows = db_safe(
        [],
        fetch_dicts,
        """
        SELECT created_at, level, message, payload
        FROM logs
        WHERE COALESCE((payload->>'scheduler')::boolean, false) = true
           OR COALESCE((payload->>'safety_guard')::boolean, false) = true
           OR COALESCE((payload->>'web_console')::boolean, false) = true
           OR COALESCE((payload->>'dashboard_action')::boolean, false) = true
        ORDER BY created_at DESC
        LIMIT %s
        """,
        (limit,),
    )
    for row in rows:
        payload = payload_obj(row.get("payload"))
        row["task_name"] = payload.get("task_name", "")
        row["reason"] = payload.get("reason", "")
        row["blocked"] = payload.get("blocked", "")
    return rows

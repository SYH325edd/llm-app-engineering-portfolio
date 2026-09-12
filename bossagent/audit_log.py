"""Structured enterprise audit logging for SaaS and automation actions."""

from __future__ import annotations

import json
import os
from typing import Any

from jobradar_log import db_conn


AUDIT_ACTIONS = {
    "task.created",
    "task.keywords_changed",
    "search.run",
    "message.draft_generated",
    "message.draft_sent",
    "task.failed",
    "safety.blocked",
    "admin.plan_changed",
    "admin.quota_changed",
    "real_search.attempted",
    "real_search.completed",
    "real_apply.attempted",
    "real_apply.completed",
    "real_message.attempted",
    "real_message.completed",
    "real_action.blocked",
}


def record_audit(
    action: str,
    *,
    target_type: str | None = None,
    target_id: str | None = None,
    outcome: str = "success",
    reason: str | None = None,
    actor_user_id: str | None = None,
    actor_role: str | None = None,
    organization_id: str | None = None,
    before: Any = None,
    after: Any = None,
    metadata: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    request_id: str | None = None,
    strict: bool = False,
) -> str | None:
    """Write an immutable audit event. Legacy deployments degrade gracefully."""
    if outcome not in {"success", "failure", "blocked"}:
        raise ValueError("invalid audit outcome")
    actor_user_id = actor_user_id or os.getenv("LAKEJOB_USER_ID") or None
    actor_role = actor_role or os.getenv("LAKEJOB_USER_ROLE", "jobseeker")
    organization_id = organization_id or os.getenv("LAKEJOB_ORGANIZATION_ID") or None
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO audit_logs (
                    organization_id, actor_user_id, actor_role, action, target_type,
                    target_id, status, reason, outcome, ip_address, user_agent, request_id,
                    before_data, after_data, metadata
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s::jsonb)
                RETURNING id
                """,
                (
                    organization_id, actor_user_id, actor_role, action, target_type,
                    target_id, outcome, reason, outcome, ip_address or None, user_agent, request_id,
                    json.dumps(before or {}, ensure_ascii=False, default=str),
                    json.dumps(after or {}, ensure_ascii=False, default=str),
                    json.dumps(metadata or {}, ensure_ascii=False, default=str),
                ),
            )
            row = cur.fetchone()
            return str(row[0]) if row else None
    except Exception as exc:
        if strict:
            raise
        print(f"WARN: failed to write audit log: {exc}")
        return None


def write_event(action: str, **kwargs: Any) -> str:
    """Strict audit entry point for real actions."""
    kwargs["strict"] = True
    event_id = record_audit(action, **kwargs)
    if not event_id:
        raise RuntimeError("audit event was not persisted")
    return event_id

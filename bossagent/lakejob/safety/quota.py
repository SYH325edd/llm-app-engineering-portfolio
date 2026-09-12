"""Central fail-closed quota policy for searches, drafts, and real actions."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from lakejob.infrastructure.database.jobs import db_conn


ACTION_LIMIT_FIELDS = {
    "search": "daily_search_limit",
    "message_draft": "daily_message_draft_limit",
    "real_apply": "daily_real_apply_limit",
    "real_message": "daily_real_message_limit",
}
DEFAULT_LIMITS = {
    "daily_search_limit": 20,
    "daily_message_draft_limit": 20,
    "daily_real_apply_limit": 0,
    "daily_real_message_limit": 0,
    "per_run_limit": 1,
    "monthly_credit_limit": 100,
}
QUOTA_UNAVAILABLE_ERROR = "Quota system unavailable, action blocked."
QUOTA_IDENTITY_ERROR = "Quota identity required, action blocked."


@dataclass(frozen=True)
class QuotaContext:
    user_id: str | None = None
    organization_id: str | None = None
    account_id: str | None = None
    task_id: str | None = None


def current_context(*, account_id: str | None = None) -> QuotaContext:
    return QuotaContext(
        user_id=os.getenv("LAKEJOB_USER_ID") or None,
        organization_id=os.getenv("LAKEJOB_ORGANIZATION_ID") or None,
        account_id=account_id,
    )


def _row_dict(cur, row: Any) -> dict[str, Any]:
    columns = [getattr(item, "name", None) or item[0] for item in cur.description]
    return dict(zip(columns, row))


def _valid_context(context: QuotaContext) -> bool:
    return bool(context.user_id and context.organization_id)


def _write_block_records(
    action: str,
    context: QuotaContext,
    reason: str,
    error: str,
    metadata: dict[str, Any] | None = None,
) -> dict[str, bool]:
    payload = {
        "quota_action": action,
        "reason": reason,
        "error": error,
        "user_id": context.user_id,
        "organization_id": context.organization_id,
        **(metadata or {}),
    }
    written = {"audit_logs": False, "logs": False}
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO audit_logs (
                    organization_id, actor_user_id, actor_role, action,
                    target_type, status, reason, outcome, metadata
                ) VALUES (%s,%s,%s,%s,%s,'blocked',%s,'blocked',%s::jsonb)
                """,
                (
                    context.organization_id,
                    context.user_id,
                    os.getenv("LAKEJOB_USER_ROLE", "jobseeker"),
                    "quota.blocked",
                    action,
                    reason,
                    json.dumps(payload, ensure_ascii=False, default=str),
                ),
            )
            written["audit_logs"] = True
    except Exception as exc:
        print(f"WARN: failed to write quota audit log: {exc}")
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO logs (
                    account_id, log_type, level, message, entity_type, payload, status
                ) VALUES (%s,'security','error',%s,'quota',%s::jsonb,'active')
                """,
                (
                    context.account_id,
                    error,
                    json.dumps(payload, ensure_ascii=False, default=str),
                ),
            )
            written["logs"] = True
    except Exception as exc:
        print(f"WARN: failed to write quota security log: {exc}")
    return written


def _blocked(
    action: str,
    context: QuotaContext,
    reason: str,
    error: str,
    *,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    written = _write_block_records(action, context, reason, error, metadata)
    return {
        "allowed": False,
        "consumed": False,
        "reason": reason,
        "error": error,
        "audit_logged": written["audit_logs"],
        "log_written": written["logs"],
    }


def _get_effective_quota(cur, context: QuotaContext) -> dict[str, int]:
    cur.execute(
        """
        SELECT q.*
        FROM quotas q
        LEFT JOIN subscriptions s ON s.plan_id = q.plan_id
        LEFT JOIN plans p ON p.id = q.plan_id
        WHERE EXISTS (
                SELECT 1 FROM memberships m
                WHERE m.user_id = %s AND m.organization_id = %s AND m.status = 'active'
              )
          AND (
                q.user_id = %s
                OR q.organization_id = %s
                OR (
                    q.plan_id IS NOT NULL AND s.status IN ('trialing','active')
                    AND (s.user_id = %s OR s.organization_id = %s)
                )
                OR (q.plan_id IS NOT NULL AND p.is_default = true)
              )
        ORDER BY
            CASE WHEN q.user_id = %s THEN 1 WHEN q.organization_id = %s THEN 2
                 WHEN s.id IS NOT NULL THEN 3 ELSE 4 END
        LIMIT 1
        """,
        (
            context.user_id,
            context.organization_id,
            context.user_id,
            context.organization_id,
            context.user_id,
            context.organization_id,
            context.user_id,
            context.organization_id,
        ),
    )
    row = cur.fetchone()
    if not row:
        raise LookupError("no quota configuration for user and organization")
    data = _row_dict(cur, row)
    return {key: int(data[key]) for key in DEFAULT_LIMITS}


def _get_usage(cur, action: str, context: QuotaContext) -> tuple[int, int]:
    cur.execute(
        """
        SELECT
            COALESCE(SUM(amount) FILTER (
                WHERE action_type = %s AND created_at >= date_trunc('day', now())
            ), 0),
            COALESCE(SUM(credits) FILTER (
                WHERE created_at >= date_trunc('month', now())
            ), 0)
        FROM quota_ledger
        WHERE user_id = %s AND organization_id = %s
        """,
        (action, context.user_id, context.organization_id),
    )
    row = cur.fetchone()
    return int(row[0]), int(row[1])


def _evaluate(cur, action: str, context: QuotaContext, quantity: int, credits: int) -> dict[str, Any]:
    limits = _get_effective_quota(cur, context)
    daily_used, monthly_used = _get_usage(cur, action, context)
    field = ACTION_LIMIT_FIELDS[action]
    daily_remaining = limits[field] - daily_used
    monthly_remaining = limits["monthly_credit_limit"] - monthly_used
    reason = "allowed"
    if quantity > daily_remaining:
        reason = f"{field}_reached"
    elif credits > monthly_remaining:
        reason = "monthly_credit_limit_reached"
    return {
        "allowed": reason == "allowed",
        "reason": reason,
        "daily_used": daily_used,
        "daily_remaining": max(0, daily_remaining),
        "monthly_used": monthly_used,
        "monthly_remaining": max(0, monthly_remaining),
        "limits": limits,
    }


def get_effective_quota(context: QuotaContext | None = None) -> dict[str, int]:
    context = context or current_context()
    if not _valid_context(context):
        raise PermissionError(QUOTA_IDENTITY_ERROR)
    try:
        with db_conn() as conn:
            return _get_effective_quota(conn.cursor(), context)
    except Exception as exc:
        raise RuntimeError(QUOTA_UNAVAILABLE_ERROR) from exc


def clamp_run_limit(value: int | None, *, context: QuotaContext | None = None) -> int:
    limit = get_effective_quota(context)["per_run_limit"]
    return min(max(0, int(value or 0)), limit)


def check_quota(
    action: str,
    *,
    context: QuotaContext | None = None,
    quantity: int = 1,
    credits: int = 1,
) -> dict[str, Any]:
    if action not in ACTION_LIMIT_FIELDS:
        raise ValueError(f"unsupported quota action: {action}")
    context = context or current_context()
    if not _valid_context(context):
        return _blocked(action, context, "quota_identity_required", QUOTA_IDENTITY_ERROR)
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            lock_key = f"quota:{context.organization_id}:{context.user_id}"
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (lock_key,))
            decision = _evaluate(cur, action, context, quantity, credits)
    except Exception as exc:
        return _blocked(
            action,
            context,
            "quota_system_unavailable",
            QUOTA_UNAVAILABLE_ERROR,
            metadata={"exception": str(exc)},
        )
    if not decision["allowed"]:
        written = _write_block_records(action, context, decision["reason"], decision["reason"])
        decision.update(audit_logged=written["audit_logs"], log_written=written["logs"])
    return decision


def consume_quota(
    action: str,
    *,
    context: QuotaContext | None = None,
    quantity: int = 1,
    credits: int = 1,
    idempotency_key: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Check and append usage under one transaction and one advisory lock."""
    if action not in ACTION_LIMIT_FIELDS:
        raise ValueError(f"unsupported quota action: {action}")
    context = context or current_context()
    if not _valid_context(context):
        return _blocked(action, context, "quota_identity_required", QUOTA_IDENTITY_ERROR, metadata=metadata)
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            lock_key = f"quota:{context.organization_id}:{context.user_id}"
            cur.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (lock_key,))

            if idempotency_key:
                cur.execute(
                    """
                    SELECT id FROM quota_ledger
                    WHERE idempotency_key = %s AND action_type = %s
                      AND user_id = %s AND organization_id = %s
                    LIMIT 1
                    """,
                    (idempotency_key, action, context.user_id, context.organization_id),
                )
                existing = cur.fetchone()
                if existing:
                    return {
                        "allowed": True,
                        "consumed": False,
                        "reason": "idempotent_replay",
                        "ledger_id": str(existing[0]),
                    }

            decision = _evaluate(cur, action, context, quantity, credits)
            if not decision["allowed"]:
                blocked_decision = decision
            else:
                cur.execute(
                    """
                    INSERT INTO quota_ledger (
                        user_id, organization_id, account_id, task_id,
                        action_type, amount, action, quantity, credits,
                        idempotency_key, metadata, created_at, occurred_at
                    ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,now(),now())
                    ON CONFLICT (idempotency_key) DO NOTHING
                    RETURNING id
                    """,
                    (
                        context.user_id,
                        context.organization_id,
                        context.account_id,
                        context.task_id,
                        action,
                        quantity,
                        action,
                        quantity,
                        credits,
                        idempotency_key,
                        json.dumps(metadata or {}, ensure_ascii=False, default=str),
                    ),
                )
                row = cur.fetchone()
                if idempotency_key and not row:
                    raise RuntimeError("idempotency key belongs to another quota scope")
                return {
                    **decision,
                    "consumed": bool(row),
                    "ledger_id": str(row[0]) if row else None,
                }
    except Exception as exc:
        return _blocked(
            action,
            context,
            "quota_system_unavailable",
            QUOTA_UNAVAILABLE_ERROR,
            metadata={**(metadata or {}), "exception": str(exc)},
        )

    written = _write_block_records(action, context, blocked_decision["reason"], blocked_decision["reason"], metadata)
    blocked_decision.update(
        consumed=False,
        audit_logged=written["audit_logs"],
        log_written=written["logs"],
    )
    return blocked_decision


def require_quota(action: str, **kwargs: Any) -> dict[str, Any]:
    decision = check_quota(action, **kwargs)
    if not decision["allowed"]:
        raise PermissionError(decision.get("error") or f"Quota blocked {action}: {decision['reason']}")
    return decision


def check_and_consume(action: str, **kwargs: Any) -> dict[str, Any]:
    """Compatibility name for the atomic quota gate used by action orchestrators."""
    return consume_quota(action, **kwargs)

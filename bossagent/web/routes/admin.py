from typing import Any

from fastapi import APIRouter, Request

from admin_skill import QUOTA_FIELDS, _identity, _render, _require_admin, _rows


router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/users")
def users_page(request: Request, message: str = "", error: str = ""):
    identity = _require_admin(request)
    where = "" if identity["role"] == "platform_admin" else "WHERE m.organization_id = %s"
    params = () if not where else (identity["organization_id"],)
    users = _rows(
        f"""
        SELECT u.id, u.email, u.display_name, u.role, u.status,
               string_agg(DISTINCT o.name, ', ') AS organizations, u.created_at
        FROM users u
        LEFT JOIN memberships m ON m.user_id = u.id
        LEFT JOIN organizations o ON o.id = m.organization_id
        {where}
        GROUP BY u.id ORDER BY u.created_at DESC LIMIT 500
        """,
        params,
    )
    return _render(request, "admin_users.html", users=users, message=message, error=error)


@router.get("/plans")
def plans_page(request: Request, message: str = "", error: str = ""):
    _require_admin(request, platform_only=True)
    plans = _rows(
        """
        SELECT p.*, q.daily_search_limit, q.daily_message_draft_limit,
               q.daily_real_apply_limit, q.daily_real_message_limit,
               q.per_run_limit, q.monthly_credit_limit
        FROM plans p LEFT JOIN quotas q ON q.plan_id = p.id
        ORDER BY p.price_monthly_cents, p.name
        """
    )
    return _render(request, "admin_plans.html", plans=plans, quota_fields=QUOTA_FIELDS, message=message, error=error)


@router.get("/quotas")
def quotas_page(request: Request, message: str = "", error: str = ""):
    identity = _require_admin(request)
    scope_filter = "" if identity["role"] == "platform_admin" else "WHERE q.organization_id = %s"
    params = () if not scope_filter else (identity["organization_id"],)
    quotas = _rows(
        f"""
        SELECT q.*, p.name AS plan_name, o.name AS organization_name, u.email AS user_email
        FROM quotas q
        LEFT JOIN plans p ON p.id = q.plan_id
        LEFT JOIN organizations o ON o.id = q.organization_id
        LEFT JOIN users u ON u.id = q.user_id
        {scope_filter}
        ORDER BY COALESCE(o.name, u.email, p.name)
        """,
        params,
    )
    return _render(request, "admin_quotas.html", quotas=quotas, quota_fields=QUOTA_FIELDS, message=message, error=error)


@router.get("/audit-logs")
def audit_logs_page(request: Request, action: str = "", outcome: str = ""):
    identity = _require_admin(request)
    clauses: list[str] = []
    params: list[Any] = []
    if identity["role"] != "platform_admin":
        clauses.append("a.organization_id = %s")
        params.append(identity["organization_id"])
    if action:
        clauses.append("a.action = %s")
        params.append(action)
    if outcome:
        clauses.append("a.status = %s")
        params.append(outcome)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    logs = _rows(
        f"""
        SELECT a.*, u.email AS actor_email, o.name AS organization_name
        FROM audit_logs a
        LEFT JOIN users u ON u.id = a.actor_user_id
        LEFT JOIN organizations o ON o.id = a.organization_id
        {where} ORDER BY a.created_at DESC LIMIT 1000
        """,
        tuple(params),
    )
    return _render(request, "admin_audit_logs.html", logs=logs, action=action, outcome=outcome)


@router.get("/task-runs")
def task_runs_page(request: Request, status: str = ""):
    identity = _require_admin(request)
    clauses: list[str] = []
    params: list[Any] = []
    if identity["role"] != "platform_admin":
        clauses.append("tr.organization_id = %s")
        params.append(identity["organization_id"])
    if status:
        clauses.append("tr.status = %s")
        params.append(status)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    runs = _rows(
        f"""
        SELECT tr.id, tr.task_id, tr.user_id, tr.organization_id, tr.task_type,
               tr.status, tr.started_at, tr.finished_at, tr.result_count,
               tr.quota_consumed, tr.error_code, tr.error_message, tr.result,
               t.name AS task_name
        FROM task_runs tr JOIN tasks t ON t.id = tr.task_id
        {where} ORDER BY COALESCE(tr.started_at, tr.created_at) DESC LIMIT 1000
        """,
        tuple(params),
    )
    return _render(request, "admin_task_runs.html", runs=runs, status=status)

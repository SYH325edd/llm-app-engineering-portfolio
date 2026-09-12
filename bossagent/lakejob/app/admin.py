"""FastAPI SaaS Admin Skill for the existing Jinja web console."""

from __future__ import annotations

import json
import os
from pathlib import Path

from lakejob.paths import PROJECT_ROOT
from typing import Any
from urllib.parse import urlencode

from fastapi import APIRouter, Form, HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.templating import Jinja2Templates

from lakejob.safety.audit import record_audit
from lakejob.shared.i18n import get_locale, t
from lakejob.infrastructure.database.jobs import db_conn


ROOT = PROJECT_ROOT
templates = Jinja2Templates(directory=str(PROJECT_ROOT / "templates"))
templates.env.globals["get_locale"] = get_locale
templates.env.globals["t"] = t
router = APIRouter(prefix="/admin", tags=["admin"])
ADMIN_ROLES = {"org_admin", "platform_admin"}
PLATFORM_ADMIN_ONLY = {"platform_admin"}
QUOTA_FIELDS = (
    "daily_search_limit",
    "daily_message_draft_limit",
    "daily_real_apply_limit",
    "daily_real_message_limit",
    "per_run_limit",
    "monthly_credit_limit",
)


def _column_name(description: Any) -> str:
    return getattr(description, "name", description[0])


def _rows(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        columns = [_column_name(item) for item in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def _one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    rows = _rows(sql, params)
    return rows[0] if rows else None


def _identity(request: Request) -> dict[str, str | None]:
    # Authentication middleware can replace these headers later. The default is
    # deliberately non-admin so an exposed console does not grant admin access.
    trust_headers = os.getenv("LAKEJOB_TRUST_IDENTITY_HEADERS", "false").lower() in {"1", "true", "yes"}
    return {
        "user_id": (request.headers.get("x-lakejob-user-id") if trust_headers else None) or os.getenv("LAKEJOB_USER_ID") or None,
        "organization_id": (request.headers.get("x-lakejob-organization-id") if trust_headers else None) or os.getenv("LAKEJOB_ORGANIZATION_ID") or None,
        "role": (request.headers.get("x-lakejob-role") if trust_headers else None) or os.getenv("LAKEJOB_USER_ROLE", "jobseeker"),
    }


def _require_admin(request: Request, *, platform_only: bool = False) -> dict[str, str | None]:
    identity = _identity(request)
    allowed = PLATFORM_ADMIN_ONLY if platform_only else ADMIN_ROLES
    if identity["role"] not in allowed:
        raise HTTPException(status_code=403, detail="admin role required")
    return identity


def _render(request: Request, template: str, **context: Any):
    return templates.TemplateResponse(
        request,
        template,
        {"active": "admin", "identity": _identity(request), "message": "", "error": "", **context},
    )


def _redirect(path: str, *, message: str = "", error: str = "") -> RedirectResponse:
    query = {key: value for key, value in {"message": message, "error": error}.items() if value}
    return RedirectResponse(path + ("?" + urlencode(query) if query else ""), status_code=303)


@router.post("/plans/{plan_id}")
async def update_plan(request: Request, plan_id: str):
    identity = _require_admin(request, platform_only=True)
    form = await request.form()
    before = _one("SELECT * FROM plans WHERE id = %s", (plan_id,))
    if not before:
        return _redirect("/admin/plans", error="plan not found")
    try:
        name = str(form.get("name") or before["name"]).strip()
        price = max(0, int(form.get("price_monthly_cents") or 0))
        status = str(form.get("status") or "active")
        if status not in {"active", "archived"}:
            raise ValueError("invalid plan status")
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                "UPDATE plans SET name=%s, price_monthly_cents=%s, status=%s, updated_at=now() WHERE id=%s",
                (name, price, status, plan_id),
            )
        after = _one("SELECT * FROM plans WHERE id = %s", (plan_id,))
        record_audit(
            "admin.plan_changed", target_type="plan", target_id=plan_id,
            actor_user_id=identity["user_id"], actor_role=identity["role"],
            organization_id=identity["organization_id"], before=before, after=after,
        )
        return _redirect("/admin/plans", message="plan updated")
    except Exception as exc:
        return _redirect("/admin/plans", error=str(exc))


@router.post("/quotas/{quota_id}")
async def update_quota(request: Request, quota_id: str):
    identity = _require_admin(request)
    before = _one("SELECT * FROM quotas WHERE id = %s", (quota_id,))
    if not before:
        return _redirect("/admin/quotas", error="quota not found")
    if identity["role"] != "platform_admin" and str(before.get("organization_id")) != identity["organization_id"]:
        raise HTTPException(status_code=403, detail="cannot modify another organization")
    try:
        form = await request.form()
        values = [max(0, int(form.get(field) or 0)) for field in QUOTA_FIELDS]
        assignments = ", ".join(f"{field}=%s" for field in QUOTA_FIELDS)
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(f"UPDATE quotas SET {assignments}, updated_at=now() WHERE id=%s", (*values, quota_id))
        after = _one("SELECT * FROM quotas WHERE id = %s", (quota_id,))
        record_audit(
            "admin.quota_changed", target_type="quota", target_id=quota_id,
            actor_user_id=identity["user_id"], actor_role=identity["role"],
            organization_id=identity["organization_id"], before=before, after=after,
        )
        return _redirect("/admin/quotas", message="quota updated")
    except Exception as exc:
        return _redirect("/admin/quotas", error=str(exc))


@router.get("/account-pauses")
def account_pauses_page(request: Request):
    _require_admin(request)
    try:
        pauses = _rows(
            """
            SELECT account_id, reason, source, screenshot_path, created_at, resolved_at
            FROM account_pauses
            ORDER BY created_at DESC
            LIMIT 1000
            """
        )
    except Exception:
        fallback = PROJECT_ROOT / "runtime" / "account_pauses.jsonl"
        pauses = []
        if fallback.exists():
            for line in fallback.read_text(encoding="utf-8", errors="ignore").splitlines()[-1000:]:
                try:
                    item = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if isinstance(item, dict):
                    pauses.append(item)
            pauses.reverse()
    return _render(request, "admin_account_pauses.html", pauses=pauses)

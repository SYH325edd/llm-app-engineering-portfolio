"""AI message draft center.

Drafts are stored in logs payload only. This module never sends messages and
never calls platform automation.
"""

from __future__ import annotations

import json
from typing import Any
from core.platform_targets import platform_target_from_record

from ai.provider import get_ai_provider, load_ai_config
from audit_log import record_audit
from quota_policy import consume_quota, current_context
from safety_guard import guard_real_message
from talent_pool import db_conn


SEND_DRAFT_CONFIRM_PHRASE = "SEND_DRAFT_ONCE"
DRAFT_SEND_STATUSES = {"sent", "failed", "blocked"}


def _json(data: Any) -> str:
    return json.dumps(data or {}, ensure_ascii=False, default=str)


def _dicts(cur, rows) -> list[dict[str, Any]]:
    cols = [getattr(item, "name", item[0]) for item in cur.description]
    return [dict(zip(cols, row)) for row in rows]


def _one(cur) -> dict[str, Any] | None:
    row = cur.fetchone()
    if not row:
        return None
    cols = [getattr(item, "name", item[0]) for item in cur.description]
    return dict(zip(cols, row))


def _payload_obj(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return {}


def create_recruiter_message_draft(candidate_id: str, recruiter_profile: dict[str, Any]) -> dict[str, Any]:
    candidate = _get_candidate(candidate_id)
    if not candidate:
        raise LookupError("candidate not found")
    quota = consume_quota(
        "message_draft", context=current_context(account_id=str(candidate.get("account_id") or "") or None),
        metadata={"candidate_id": candidate_id, "draft_type": "recruiter"},
    )
    if not quota.get("allowed"):
        raise PermissionError(quota.get("error") or f"Quota blocked message draft: {quota.get('reason')}")
    analysis = _latest_match_analysis("candidate", candidate_id)
    provider_name = _provider_name()
    fallback_used = False
    try:
        provider = get_ai_provider()
        content = provider.generate_recruiter_message(candidate, recruiter_profile, analysis)
        provider_name = str(getattr(provider, "name", provider_name))
    except Exception as exc:
        fallback_used = True
        content = _fallback_recruiter_message(candidate, recruiter_profile)
        analysis = {**(analysis or {}), "draft_error": _safe_error(str(exc))}
    return _save_draft(
        draft_type="recruiter",
        target_id=candidate_id,
        target_name=str(candidate.get("name") or "candidate"),
        content=content,
        ai_provider=provider_name,
        fallback_used=fallback_used,
        match_analysis=analysis,
    )


def create_jobseeker_message_draft(job_id: str, jobseeker_profile: dict[str, Any]) -> dict[str, Any]:
    job = _get_job(job_id)
    if not job:
        raise LookupError("job not found")
    quota = consume_quota(
        "message_draft", context=current_context(account_id=str(job.get("account_id") or "") or None),
        metadata={"job_id": job_id, "draft_type": "jobseeker"},
    )
    if not quota.get("allowed"):
        raise PermissionError(quota.get("error") or f"Quota blocked message draft: {quota.get('reason')}")
    analysis = _latest_match_analysis("job", job_id)
    provider_name = _provider_name()
    fallback_used = False
    try:
        provider = get_ai_provider()
        content = provider.generate_jobseeker_message(job, jobseeker_profile, analysis)
        provider_name = str(getattr(provider, "name", provider_name))
    except Exception as exc:
        fallback_used = True
        content = _fallback_jobseeker_message(job, jobseeker_profile)
        analysis = {**(analysis or {}), "draft_error": _safe_error(str(exc))}
    return _save_draft(
        draft_type="jobseeker",
        target_id=job_id,
        target_name=str(job.get("title") or "job"),
        content=content,
        ai_provider=provider_name,
        fallback_used=fallback_used,
        match_analysis=analysis,
    )


def list_message_drafts() -> list[dict[str, Any]]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id AS draft_id, created_at, payload
            FROM logs
            WHERE payload->>'message_draft' = 'true'
            ORDER BY created_at DESC
            LIMIT 200
            """
        )
        rows = _dicts(cur, cur.fetchall())
    drafts = []
    for row in rows:
        payload = _payload_obj(row.get("payload"))
        status = get_latest_draft_status(str(row["draft_id"])) or payload.get("status", "draft")
        drafts.append(
            {
                "draft_id": str(row["draft_id"]),
                "created_at": row.get("created_at"),
                "draft_type": payload.get("draft_type", ""),
                "target_id": payload.get("target_id", ""),
                "target_name": payload.get("target_name", ""),
                "content": payload.get("content", ""),
                "summary": str(payload.get("content") or "")[:120],
                "ai_provider": payload.get("ai_provider", ""),
                "fallback_used": payload.get("fallback_used", False),
                "status": status,
                "payload": payload,
            }
        )
    return drafts


def get_message_draft(draft_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id AS draft_id, created_at, payload
            FROM logs
            WHERE id = %s AND payload->>'message_draft' = 'true'
            LIMIT 1
            """,
            (draft_id,),
        )
        row = _one(cur)
    if not row:
        return None
    payload = _payload_obj(row.get("payload"))
    status = get_latest_draft_status(draft_id) or payload.get("status", "draft")
    return {
        "draft_id": str(row["draft_id"]),
        "created_at": row.get("created_at"),
        "draft_type": payload.get("draft_type", ""),
        "target_id": payload.get("target_id", ""),
        "target_name": payload.get("target_name", ""),
        "content": payload.get("content", ""),
        "ai_provider": payload.get("ai_provider", ""),
        "fallback_used": payload.get("fallback_used", False),
        "status": status,
        "match_analysis": payload.get("match_analysis") or {},
        "payload": payload,
    }


def get_latest_draft_status(draft_id: str) -> str | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload
            FROM logs
            WHERE payload->>'message_draft_send' = 'true'
              AND payload->>'draft_id' = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (draft_id,),
        )
        row = cur.fetchone()
        if row:
            payload = _payload_obj(row[0])
            if payload.get("sent") is True:
                return "sent"
            if payload.get("blocked") is True:
                return "blocked"
            return "failed"
        cur.execute("SELECT payload FROM logs WHERE id = %s AND payload->>'message_draft' = 'true' LIMIT 1", (draft_id,))
        row = cur.fetchone()
    if not row:
        return None
    return str(_payload_obj(row[0]).get("status") or "draft")


def send_message_draft_once(
    draft_id: str,
    *,
    confirm_phrase: str,
    sender: Any | None = None,
    skip_delay: bool = False,
) -> dict[str, Any]:
    draft = get_message_draft(draft_id)
    if not draft:
        raise LookupError("message draft not found")
    if confirm_phrase != SEND_DRAFT_CONFIRM_PHRASE:
        result = _send_result(draft, sent=False, success=False, blocked=False, error="confirmation phrase mismatch")
        _log_send_result(result)
        return result
    current_status = get_latest_draft_status(draft_id)
    if current_status == "sent":
        result = _send_result(draft, sent=False, success=False, blocked=True, reason="draft_already_sent")
        _log_send_result(result)
        return result

    content = str(draft.get("content") or "").strip()
    if not content:
        result = _send_result(draft, sent=False, success=False, blocked=False, error="empty draft content")
        _log_send_result(result)
        return result
    if len(content) > 300:
        result = _send_result(draft, sent=False, success=False, blocked=False, error="draft content exceeds 300 characters")
        _log_send_result(result)
        return result

    target = _load_send_target(draft)
    source_url = str(target.get("source_url") or "")
    if not source_url or source_url.startswith("mock://"):
        result = _send_result(
            draft,
            sent=False,
            success=False,
            blocked=False,
            error="缺少目标页面链接，无法发送，请先通过真实搜索或补充 source_url。",
        )
        _log_send_result(result)
        return result

    try:
        platform_target_from_record(target).require("message")
    except PermissionError as exc:
        result = _send_result(
            draft, sent=False, success=False, blocked=True,
            reason=str(exc),
        )
        result["state"] = "blocked_by_safety"
        _log_send_result(result)
        return result

    guard = guard_real_message(
        platform_id=target.get("platform_id"),
        account_id=target.get("account_id"),
        job=target if draft.get("draft_type") == "jobseeker" else None,
        candidate=target if draft.get("draft_type") == "recruiter" else None,
        smoke=True,
        skip_delay=skip_delay,
    )
    if not guard.get("allowed"):
        result = _send_result(
            draft,
            sent=False,
            success=False,
            blocked=True,
            reason=str(guard.get("reason") or "safety_guard_blocked"),
        )
        _log_send_result(result)
        return result

    quota_context = current_context(account_id=target.get("account_id"))
    consumed = consume_quota(
        "real_message", context=quota_context,
        idempotency_key=f"real_message:draft:{draft_id}",
        metadata={"draft_id": draft_id, "target_id": draft.get("target_id")},
    )
    if not consumed.get("allowed"):
        result = _send_result(
            draft, sent=False, success=False, blocked=True,
            reason=str(consumed.get("error") or consumed.get("reason") or "quota_policy_blocked"),
        )
        _log_send_result(result)
        return result

    try:
        active_sender = sender or _send_via_boss
        sent = bool(active_sender(draft, target, content))
        result = _send_result(draft, sent=sent, success=sent, blocked=False, error="" if sent else "sender returned false")
        _log_send_result(result)
        return result
    except Exception as exc:
        result = _send_result(draft, sent=False, success=False, blocked=False, error=_safe_error(str(exc)))
        _log_send_result(result)
        return result


def build_draft_payload(
    *,
    draft_type: str,
    target_id: str,
    target_name: str,
    content: str,
    ai_provider: str,
    fallback_used: bool,
    match_analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "message_draft": True,
        "draft_type": draft_type,
        "target_id": target_id,
        "target_name": target_name,
        "content": content[:100],
        "ai_provider": ai_provider,
        "fallback_used": fallback_used,
        "status": "draft",
        "real_send": False,
        "draft_only": True,
        "match_analysis": match_analysis or {},
    }


def _save_draft(
    *,
    draft_type: str,
    target_id: str,
    target_name: str,
    content: str,
    ai_provider: str,
    fallback_used: bool,
    match_analysis: dict[str, Any] | None = None,
) -> dict[str, Any]:
    payload = build_draft_payload(
        draft_type=draft_type,
        target_id=target_id,
        target_name=target_name,
        content=content,
        ai_provider=ai_provider,
        fallback_used=fallback_used,
        match_analysis=match_analysis,
    )
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO logs (log_type, level, message, entity_type, entity_id, payload, status)
            VALUES ('audit','info','message draft created',%s,%s,%s::jsonb,'active')
            RETURNING id, created_at
            """,
            ("message_draft", target_id, _json(payload)),
        )
        row = _one(cur)
    result = {"draft_id": str(row["id"]), "created_at": row["created_at"], **payload}
    record_audit(
        "message.draft_generated", target_type="message_draft", target_id=result["draft_id"],
        metadata={"draft_type": draft_type, "target_id": target_id, "ai_provider": ai_provider},
    )
    return result


def _get_candidate(candidate_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
        return _one(cur)


def _get_job(job_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM jobs WHERE id = %s LIMIT 1", (job_id,))
        return _one(cur)


def _load_send_target(draft: dict[str, Any]) -> dict[str, Any]:
    target_id = str(draft.get("target_id") or "")
    if draft.get("draft_type") == "recruiter":
        candidate = _get_candidate(target_id) or {}
        return {
            **candidate,
            "candidate_id": target_id,
            "source_url": candidate.get("source_url") or "",
            "platform_id": str(candidate.get("platform_id") or "") or None,
            "account_id": str(candidate.get("account_id") or "") or None,
            "counterparty_name": candidate.get("name") or draft.get("target_name") or "",
        }
    if draft.get("draft_type") == "jobseeker":
        job = _get_job(target_id) or {}
        return {
            **job,
            "job_id": target_id,
            "source_url": job.get("source_url") or job.get("url") or "",
            "platform_id": str(job.get("platform_id") or "") or None,
            "account_id": str(job.get("account_id") or "") or None,
            "counterparty_name": job.get("company_name") or job.get("company") or draft.get("target_name") or "",
        }
    return {}


def _send_via_boss(draft: dict[str, Any], target: dict[str, Any], content: str) -> bool:
    from adapters.boss import BossAdapter

    adapter = BossAdapter(headless=False, allow_mock=False)
    adapter.set_safety_context(account_id=target.get("account_id"), source="message_draft_send")
    try:
        adapter.start()
        return bool(
            adapter.send_message(
                {
                    "source_url": target.get("source_url") or "",
                    "candidate_id": target.get("candidate_id") or "",
                    "counterparty_name": target.get("counterparty_name") or target.get("name") or "",
                    "name": target.get("name") or target.get("counterparty_name") or "",
                    "hr_name": target.get("counterparty_name") or "",
                },
                content,
            )
        )
    finally:
        adapter.close()


DEFAULT_BOSS_SENDER = _send_via_boss


def _send_result(
    draft: dict[str, Any],
    *,
    sent: bool,
    success: bool,
    blocked: bool = False,
    reason: str = "",
    error: str = "",
) -> dict[str, Any]:
    return {
        "message_draft_send": True,
        "draft_id": str(draft.get("draft_id") or ""),
        "draft_type": draft.get("draft_type") or "",
        "target_id": draft.get("target_id") or "",
        "target_name": draft.get("target_name") or "",
        "real_send": bool(sent),
        "sent": bool(sent),
        "success": bool(success),
        "blocked": bool(blocked),
        "reason": reason,
        "content": draft.get("content") or "",
        "error": _safe_error(error),
    }


def _log_send_result(result: dict[str, Any]) -> str | None:
    try:
        with db_conn() as conn:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO logs (log_type, level, message, entity_type, entity_id, payload, status)
                VALUES ('audit',%s,'message draft send attempted','message_draft',%s,%s::jsonb,'active')
                RETURNING id
                """,
                (
                    "info" if result.get("success") else "warning",
                    result.get("draft_id") or None,
                    _json(result),
                ),
            )
            row = _one(cur)
            log_id = str(row["id"]) if row else None
            record_audit(
                "message.draft_sent", target_type="message_draft",
                target_id=str(result.get("draft_id") or "") or None,
                outcome="success" if result.get("success") else ("blocked" if result.get("blocked") else "failure"),
                metadata={key: value for key, value in result.items() if key != "content"},
            )
            return log_id
    except Exception as exc:
        print(f"WARN: failed to write message draft send log: {exc}")
        return None


def _latest_match_analysis(target_type: str, target_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload
            FROM logs
            WHERE payload->>'match_analysis' = 'true'
              AND payload->>'target_type' = %s
              AND payload->>'target_id' = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (target_type, target_id),
        )
        row = cur.fetchone()
    return _payload_obj(row[0]) if row else {}


def _provider_name() -> str:
    try:
        return str(load_ai_config().get("provider") or "mock")
    except Exception:
        return "mock"


def _fallback_recruiter_message(candidate: dict[str, Any], recruiter_profile: dict[str, Any]) -> str:
    name = candidate.get("name") or "您好"
    title = recruiter_profile.get("job_title") or recruiter_profile.get("title") or "这个岗位"
    return _trim_100(f"{name}您好，我们在招聘{title}，想和您简单沟通一下岗位机会。")


def _fallback_jobseeker_message(job: dict[str, Any], jobseeker_profile: dict[str, Any]) -> str:
    title = job.get("title") or "这个岗位"
    return _trim_100(f"您好，我对{title}比较感兴趣，想进一步了解岗位要求和团队情况。")


def _trim_100(message: str) -> str:
    return message.replace("\n", " ").strip()[:100]


def _safe_error(error: str) -> str:
    return error.replace("DEEPSEEK_API_KEY", "[redacted]").replace("Bearer ", "[redacted] ")[:300]

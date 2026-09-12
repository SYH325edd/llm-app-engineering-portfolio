"""Operational metrics for the LakeJob console dashboard."""

from __future__ import annotations

import json
from typing import Any, Callable


NA = "N/A"


def _scalar(cur, sql: str, params: tuple[Any, ...] = ()) -> Any:
    cur.execute(sql, params)
    row = cur.fetchone()
    return row[0] if row else None


def _rows(cur, sql: str, params: tuple[Any, ...] = ()) -> list[tuple[Any, ...]]:
    cur.execute(sql, params)
    return list(cur.fetchall())


def _payload_value(payload: Any, key: str) -> Any:
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    if isinstance(payload, dict):
        return payload.get(key, "")
    return ""


def _top_pairs(rows: list[tuple[Any, Any]]) -> list[dict[str, Any]]:
    return [{"name": row[0] or NA, "count": int(row[1] or 0)} for row in rows]


def _safe_section(factory: Callable[[Any], dict[str, Any]], cur: Any) -> dict[str, Any]:
    try:
        return factory(cur)
    except Exception as exc:
        return {"error": str(exc)}


def fetch_operation_metrics(connect: Callable[[], Any]) -> dict[str, Any]:
    try:
        with connect() as conn:
            cur = conn.cursor()
            return {
                "recruiting_funnel": _safe_section(_recruiting_funnel, cur),
                "talent_profile": _safe_section(_talent_profile, cur),
                "job_pool": _safe_section(_job_pool, cur),
                "company_pool": _safe_section(_company_pool, cur),
                "ai_effect": _safe_section(_ai_effect, cur),
                "safety_guard": _safe_section(_safety_guard, cur),
                "task_flow": _safe_section(_task_flow, cur),
            }
    except Exception as exc:
        return {"error": str(exc)}


def _recruiting_funnel(cur: Any) -> dict[str, Any]:
    candidates = _scalar(cur, "SELECT COUNT(*) FROM candidates;") or 0
    scored_candidates = _scalar(cur, "SELECT COUNT(DISTINCT candidate_id) FROM match_scores WHERE candidate_id IS NOT NULL;") or 0
    candidate_conversations = _scalar(cur, "SELECT COUNT(*) FROM conversations WHERE candidate_id IS NOT NULL;") or 0
    candidate_messages = (
        _scalar(
            cur,
            """
            SELECT COUNT(*)
            FROM messages m
            JOIN conversations c ON c.id = m.conversation_id
            WHERE c.candidate_id IS NOT NULL
            """,
        )
        or 0
    )
    applications = _scalar(cur, "SELECT COUNT(*) FROM applications;") or 0
    submitted = _scalar(cur, "SELECT COUNT(*) FROM applications WHERE status = 'submitted';") or 0
    responded = _scalar(cur, "SELECT COUNT(*) FROM applications WHERE status = 'responded';") or 0
    return {
        "candidates": candidates,
        "scored_candidates": scored_candidates,
        "candidate_conversations": candidate_conversations,
        "candidate_messages": candidate_messages,
        "applications": applications,
        "submitted_applications": submitted,
        "responded_applications": responded,
    }


def _talent_profile(cur: Any) -> dict[str, Any]:
    total = _scalar(cur, "SELECT COUNT(*) FROM candidates;") or 0
    active = _scalar(cur, "SELECT COUNT(*) FROM candidates WHERE status = 'active';") or 0
    top_cities = _top_pairs(
        _rows(
            cur,
            """
            SELECT city, COUNT(*)
            FROM candidates
            WHERE city IS NOT NULL AND city <> ''
            GROUP BY city
            ORDER BY COUNT(*) DESC, city ASC
            LIMIT 5
            """,
        )
    )
    top_titles = _top_pairs(
        _rows(
            cur,
            """
            SELECT current_title, COUNT(*)
            FROM candidates
            WHERE current_title IS NOT NULL AND current_title <> ''
            GROUP BY current_title
            ORDER BY COUNT(*) DESC, current_title ASC
            LIMIT 5
            """,
        )
    )
    top_education = _top_pairs(
        _rows(
            cur,
            """
            SELECT education_text, COUNT(*)
            FROM candidates
            WHERE education_text IS NOT NULL AND education_text <> ''
            GROUP BY education_text
            ORDER BY COUNT(*) DESC, education_text ASC
            LIMIT 5
            """,
        )
    )
    return {
        "total": total,
        "active": active,
        "top_cities": top_cities,
        "top_titles": top_titles,
        "top_education": top_education,
    }


def _job_pool(cur: Any) -> dict[str, Any]:
    total = _scalar(cur, "SELECT COUNT(*) FROM jobs;") or 0
    active = _scalar(cur, "SELECT COUNT(*) FROM jobs WHERE status = 'active';") or 0
    created_today = _scalar(cur, "SELECT COUNT(*) FROM jobs WHERE created_at::date = CURRENT_DATE;") or 0
    top_cities = _top_pairs(
        _rows(
            cur,
            """
            SELECT city, COUNT(*)
            FROM jobs
            WHERE city IS NOT NULL AND city <> ''
            GROUP BY city
            ORDER BY COUNT(*) DESC, city ASC
            LIMIT 5
            """,
        )
    )
    top_companies = _top_pairs(
        _rows(
            cur,
            """
            SELECT company_name, COUNT(*)
            FROM jobs
            WHERE company_name IS NOT NULL AND company_name <> ''
            GROUP BY company_name
            ORDER BY COUNT(*) DESC, company_name ASC
            LIMIT 5
            """,
        )
    )
    return {
        "total": total,
        "active": active,
        "created_today": created_today,
        "top_cities": top_cities,
        "top_companies": top_companies,
    }


def _company_pool(cur: Any) -> dict[str, Any]:
    distinct_companies = _scalar(cur, "SELECT COUNT(DISTINCT company_name) FROM jobs WHERE company_name IS NOT NULL AND company_name <> '';") or 0
    companies_with_applications = (
        _scalar(
            cur,
            """
            SELECT COUNT(DISTINCT j.company_name)
            FROM applications a
            JOIN jobs j ON j.id = a.job_id
            WHERE j.company_name IS NOT NULL AND j.company_name <> ''
            """,
        )
        or 0
    )
    top_by_jobs = _top_pairs(
        _rows(
            cur,
            """
            SELECT company_name, COUNT(*)
            FROM jobs
            WHERE company_name IS NOT NULL AND company_name <> ''
            GROUP BY company_name
            ORDER BY COUNT(*) DESC, company_name ASC
            LIMIT 5
            """,
        )
    )
    top_by_applications = _top_pairs(
        _rows(
            cur,
            """
            SELECT j.company_name, COUNT(*)
            FROM applications a
            JOIN jobs j ON j.id = a.job_id
            WHERE j.company_name IS NOT NULL AND j.company_name <> ''
            GROUP BY j.company_name
            ORDER BY COUNT(*) DESC, j.company_name ASC
            LIMIT 5
            """,
        )
    )
    return {
        "distinct_companies": distinct_companies,
        "companies_with_applications": companies_with_applications,
        "top_by_jobs": top_by_jobs,
        "top_by_applications": top_by_applications,
    }


def _ai_effect(cur: Any) -> dict[str, Any]:
    total_scores = _scalar(cur, "SELECT COUNT(*) FROM match_scores;") or 0
    avg_score = _scalar(cur, "SELECT AVG(score) FROM match_scores;")
    ai_scores = _scalar(cur, "SELECT COUNT(*) FROM match_scores WHERE score_type IN ('ai', 'hybrid');") or 0
    rule_scores = _scalar(cur, "SELECT COUNT(*) FROM match_scores WHERE score_type = 'rule';") or 0
    high_scores = _scalar(cur, "SELECT COUNT(*) FROM match_scores WHERE score >= 80;") or 0
    by_type = _top_pairs(
        _rows(
            cur,
            """
            SELECT score_type, COUNT(*)
            FROM match_scores
            GROUP BY score_type
            ORDER BY COUNT(*) DESC, score_type ASC
            LIMIT 5
            """,
        )
    )
    return {
        "total_scores": total_scores,
        "avg_score": float(avg_score) if avg_score is not None else NA,
        "ai_or_hybrid_scores": ai_scores,
        "rule_scores": rule_scores,
        "high_scores_80_plus": high_scores,
        "by_type": by_type,
    }


def _safety_guard(cur: Any) -> dict[str, Any]:
    total_events = (
        _scalar(
            cur,
            "SELECT COUNT(*) FROM logs WHERE COALESCE((payload->>'safety_guard')::boolean, false) = true;",
        )
        or 0
    )
    blocked_events = (
        _scalar(
            cur,
            """
            SELECT COUNT(*)
            FROM logs
            WHERE COALESCE((payload->>'safety_guard')::boolean, false) = true
              AND COALESCE((payload->>'blocked')::boolean, false) = true
            """,
        )
        or 0
    )
    blocked_today = (
        _scalar(
            cur,
            """
            SELECT COUNT(*)
            FROM logs
            WHERE created_at::date = CURRENT_DATE
              AND COALESCE((payload->>'safety_guard')::boolean, false) = true
              AND COALESCE((payload->>'blocked')::boolean, false) = true
            """,
        )
        or 0
    )
    reasons = _top_pairs(
        _rows(
            cur,
            """
            SELECT payload->>'reason', COUNT(*)
            FROM logs
            WHERE COALESCE((payload->>'safety_guard')::boolean, false) = true
              AND COALESCE((payload->>'blocked')::boolean, false) = true
              AND payload ? 'reason'
            GROUP BY payload->>'reason'
            ORDER BY COUNT(*) DESC, payload->>'reason' ASC
            LIMIT 5
            """,
        )
    )
    return {
        "total_events": total_events,
        "blocked_events": blocked_events,
        "blocked_today": blocked_today,
        "top_reasons": reasons,
    }


def _task_flow(cur: Any) -> dict[str, Any]:
    rows = _rows(
        cur,
        """
        SELECT created_at, message, level, payload
        FROM logs
        WHERE COALESCE((payload->>'scheduler')::boolean, false) = true
           OR COALESCE((payload->>'dashboard_action')::boolean, false) = true
           OR COALESCE((payload->>'safety_guard')::boolean, false) = true
        ORDER BY created_at DESC
        LIMIT 10
        """,
    )
    events = []
    for created_at, message, level, payload in rows:
        events.append(
            {
                "created_at": str(created_at),
                "level": level,
                "message": message,
                "task_name": _payload_value(payload, "task_name"),
                "success": _payload_value(payload, "success"),
                "blocked": _payload_value(payload, "blocked"),
                "reason": _payload_value(payload, "reason"),
            }
        )
    return {"events": events}

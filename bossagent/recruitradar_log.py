"""RecruitRadar MVP Core data access.

This module writes to the LakeJob Core PostgreSQL schema only. It reuses
the existing Core connection helpers and does not call platform automation.
"""

from __future__ import annotations

from typing import Any

from jobradar_log import _json, _one, add_message, create_conversation, db_conn, ensure_platform, log_event


def ensure_recruiter_account(platform_id: str, display_name: str = "default-recruiter") -> str:
    external_id = f"recruiter:{display_name}"
    sql = """
    INSERT INTO accounts (platform_id, account_type, display_name, external_account_id, status)
    VALUES (%s, 'recruiter', %s, %s, 'active')
    ON CONFLICT (platform_id, external_account_id) WHERE external_account_id IS NOT NULL
    DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (platform_id, display_name, external_id))
        return str(_one(cur)["id"])


def bootstrap_boss_recruiter(account_name: str = "default-recruiter") -> tuple[str, str]:
    platform_id = ensure_platform()
    account_id = ensure_recruiter_account(platform_id, account_name)
    return platform_id, account_id


def upsert_candidate(platform_id: str, account_id: str, candidate: dict[str, Any]) -> dict[str, Any]:
    sql = """
    INSERT INTO candidates (
      platform_id, account_id, external_candidate_id, source_url, name, headline,
      current_company, current_title, city, location, experience_text,
      education_text, skills, resume_text, status, raw_data
    )
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,'active',%s::jsonb)
    ON CONFLICT (platform_id, external_candidate_id) WHERE external_candidate_id IS NOT NULL
    DO UPDATE SET
      source_url = EXCLUDED.source_url,
      name = EXCLUDED.name,
      headline = EXCLUDED.headline,
      current_company = EXCLUDED.current_company,
      current_title = EXCLUDED.current_title,
      city = EXCLUDED.city,
      location = EXCLUDED.location,
      experience_text = EXCLUDED.experience_text,
      education_text = EXCLUDED.education_text,
      skills = EXCLUDED.skills,
      resume_text = EXCLUDED.resume_text,
      raw_data = EXCLUDED.raw_data
    RETURNING *
    """
    external_id = candidate.get("external_candidate_id") or candidate.get("source_url") or candidate["name"]
    params = (
        platform_id,
        account_id,
        external_id,
        candidate.get("source_url"),
        candidate.get("name") or "Unknown Candidate",
        candidate.get("headline"),
        candidate.get("current_company"),
        candidate.get("current_title"),
        candidate.get("city"),
        candidate.get("location"),
        candidate.get("experience_text"),
        candidate.get("education_text"),
        _json(candidate.get("skills") or []),
        candidate.get("resume_text"),
        _json(candidate),
    )
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return _one(cur)


def get_candidate(candidate_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM candidates WHERE id=%s LIMIT 1", (candidate_id,))
        candidate = _one(cur)
    if not candidate:
        raise LookupError("candidate not found in Core schema")
    return candidate


def create_recruit_application(
    platform_id: str,
    account_id: str,
    candidate_id: str,
    *,
    job_id: str | None = None,
) -> str:
    sql = """
    INSERT INTO applications (platform_id, account_id, job_id, candidate_id, direction, status)
    VALUES (%s, %s, %s, %s, 'recruitradar', 'pending')
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (platform_id, account_id, job_id, candidate_id))
        return str(_one(cur)["id"])


def set_recruit_application_status(application_id: str, status: str) -> None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE applications SET status=%s, last_activity_at=now() WHERE id=%s",
            (status, application_id),
        )


def add_match_score(
    candidate_id: str,
    score: float,
    *,
    job_id: str | None = None,
    application_id: str | None = None,
    score_type: str = "rule",
    summary: str = "",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sql = """
    INSERT INTO match_scores (
      job_id, candidate_id, application_id, score, score_type,
      summary, details, status, computed_at
    )
    VALUES (%s,%s,%s,%s,%s,%s,%s::jsonb,'active',now())
    RETURNING *
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (job_id, candidate_id, application_id, score, score_type, summary, _json(details)))
        return _one(cur)


def create_candidate_conversation(
    *,
    platform_id: str,
    account_id: str,
    candidate_id: str,
    application_id: str,
    candidate_name: str,
    job_id: str | None = None,
) -> str:
    return create_conversation(
        platform_id=platform_id,
        account_id=account_id,
        application_id=application_id,
        job_id=job_id,
        candidate_id=candidate_id,
        subject_type="candidate",
        subject_id=candidate_id,
        counterparty_name=candidate_name,
        counterparty_role="candidate",
    )


__all__ = [
    "add_match_score",
    "add_message",
    "bootstrap_boss_recruiter",
    "create_candidate_conversation",
    "create_recruit_application",
    "get_candidate",
    "log_event",
    "set_recruit_application_status",
    "upsert_candidate",
]

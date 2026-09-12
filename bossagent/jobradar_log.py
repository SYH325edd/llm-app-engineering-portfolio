"""JobRadar MVP Core logging and schema access.

This module writes only to the LakeJob Core PostgreSQL schema defined in
schema.sql. It does not implement API, platform automation, search, or AI.
"""

from __future__ import annotations

import json
import os
from contextlib import contextmanager
from typing import Any


DB_URL = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")


def _driver():
    try:
        import psycopg  # type: ignore

        return "psycopg", psycopg
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return "psycopg2", psycopg2
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 to use Core PostgreSQL schema") from exc


@contextmanager
def db_conn():
    if not DB_URL:
        raise RuntimeError("Set LAKEJOB_DATABASE_URL or DATABASE_URL")
    _, driver = _driver()
    conn = driver.connect(DB_URL)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _one(cur) -> dict[str, Any] | None:
    row = cur.fetchone()
    if row is None:
        return None
    cols = [d[0] for d in cur.description]
    return dict(zip(cols, row))


def _json(data: Any) -> str:
    return json.dumps(data or {}, ensure_ascii=False)


def ensure_platform(code: str = "boss", name: str = "BOSS直聘") -> str:
    sql = """
    INSERT INTO platforms (code, name, category, base_url, status)
    VALUES (%s, %s, 'job_board', 'https://www.zhipin.com', 'active')
    ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (code, name))
        return str(_one(cur)["id"])


def ensure_account(platform_id: str, display_name: str = "default-jobseeker") -> str:
    sql = """
    INSERT INTO accounts (platform_id, account_type, display_name, external_account_id, status)
    VALUES (%s, 'job_seeker', %s, %s, 'active')
    ON CONFLICT (platform_id, external_account_id) WHERE external_account_id IS NOT NULL
    DO UPDATE SET display_name = EXCLUDED.display_name
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (platform_id, display_name, display_name))
        return str(_one(cur)["id"])


def upsert_job(platform_id: str, account_id: str, job: dict[str, Any]) -> dict[str, Any]:
    url = job.get("url") or job.get("source_url") or ""
    title = job.get("title") or "Untitled Job"
    sql = """
    INSERT INTO jobs (
      platform_id, account_id, external_job_id, source_url, title, company_name,
      salary_text, city, experience_text, education_text, description, status, raw_data
    )
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'active',%s::jsonb)
    ON CONFLICT (platform_id, external_job_id) WHERE external_job_id IS NOT NULL
    DO UPDATE SET
      source_url = EXCLUDED.source_url,
      title = EXCLUDED.title,
      company_name = EXCLUDED.company_name,
      salary_text = EXCLUDED.salary_text,
      city = EXCLUDED.city,
      experience_text = EXCLUDED.experience_text,
      education_text = EXCLUDED.education_text,
      description = EXCLUDED.description,
      raw_data = EXCLUDED.raw_data
    RETURNING *
    """
    external_id = job.get("external_job_id") or url
    params = (
        platform_id,
        account_id,
        external_id,
        url,
        title,
        job.get("company") or job.get("company_name"),
        job.get("salary") or job.get("salary_text"),
        job.get("city"),
        job.get("experience") or job.get("experience_text"),
        job.get("education") or job.get("education_text"),
        job.get("description"),
        _json(job),
    )
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return _one(cur)


def get_job(job_id: str | None = None, source_url: str | None = None) -> dict[str, Any]:
    if not job_id and not source_url:
        raise ValueError("job_id or source_url required")
    where = "id = %s" if job_id else "source_url = %s"
    value = job_id or source_url
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT * FROM jobs WHERE {where} LIMIT 1", (value,))
        job = _one(cur)
    if not job:
        raise LookupError("job not found in Core schema")
    return job


def create_application(platform_id: str, account_id: str, job_id: str) -> str:
    sql = """
    INSERT INTO applications (platform_id, account_id, job_id, direction, status)
    VALUES (%s, %s, %s, 'jobradar', 'pending')
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (platform_id, account_id, job_id))
        return str(_one(cur)["id"])


def set_application_status(application_id: str, status: str) -> None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            "UPDATE applications SET status=%s, last_activity_at=now() WHERE id=%s",
            (status, application_id),
        )


def add_match_score(
    job_id: str,
    score: float,
    *,
    score_type: str = "rule",
    summary: str = "",
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    sql = """
    INSERT INTO match_scores (
      job_id, score, score_type, summary, details, status, computed_at
    )
    VALUES (%s,%s,%s,%s,%s::jsonb,'active',now())
    RETURNING *
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, (job_id, score, score_type, summary, _json(details)))
        return _one(cur)


def create_conversation(
    *,
    platform_id: str,
    account_id: str,
    application_id: str | None = None,
    job_id: str | None = None,
    candidate_id: str | None = None,
    subject_type: str = "application",
    subject_id: str | None = None,
    counterparty_name: str = "",
    counterparty_role: str = "hr",
) -> str:
    sql = """
    INSERT INTO conversations (
      platform_id, account_id, application_id, job_id, candidate_id,
      subject_type, subject_id, counterparty_name, counterparty_role, status
    )
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,'active')
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            sql,
            (
                platform_id,
                account_id,
                application_id,
                job_id,
                candidate_id,
                subject_type,
                subject_id,
                counterparty_name,
                counterparty_role,
            ),
        )
        return str(_one(cur)["id"])


def add_message(
    *,
    conversation_id: str,
    platform_id: str,
    account_id: str,
    content: str,
    sender_type: str = "ai",
    sender_name: str = "JobRadar AI",
    direction: str = "outbound",
    status: str = "draft",
    metadata: dict[str, Any] | None = None,
) -> str:
    sql = """
    INSERT INTO messages (
      conversation_id, platform_id, account_id, sender_type, sender_name,
      content, content_type, direction, sent_at, status, metadata
    )
    VALUES (%s,%s,%s,%s,%s,%s,'text',%s,
            CASE WHEN %s = 'sent' THEN now() ELSE NULL END,%s,%s::jsonb)
    RETURNING id
    """
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            sql,
            (
                conversation_id,
                platform_id,
                account_id,
                sender_type,
                sender_name,
                content,
                direction,
                status,
                status,
                _json(metadata),
            ),
        )
        return str(_one(cur)["id"])


def set_message_status(message_id: str, status: str) -> None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """UPDATE messages SET status = %s,
               sent_at = CASE WHEN %s = 'sent' THEN now() ELSE sent_at END,
               updated_at = now() WHERE id = %s""",
            (status, status, message_id),
        )


def log_event(
    message: str,
    *,
    level: str = "info",
    log_type: str = "audit",
    platform_id: str | None = None,
    account_id: str | None = None,
    task_id: str | None = None,
    conversation_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    payload: dict[str, Any] | None = None,
) -> str:
    sql = """
    INSERT INTO logs (
      platform_id, account_id, task_id, conversation_id, log_type, level,
      message, entity_type, entity_id, payload, status
    )
    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,'active')
    RETURNING id
    """
    params = (
        platform_id,
        account_id,
        task_id,
        conversation_id,
        log_type,
        level,
        message,
        entity_type,
        entity_id,
        _json(payload),
    )
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return str(_one(cur)["id"])


def bootstrap_boss_account(account_name: str = "default-jobseeker") -> tuple[str, str]:
    platform_id = ensure_platform()
    account_id = ensure_account(platform_id, account_name)
    return platform_id, account_id

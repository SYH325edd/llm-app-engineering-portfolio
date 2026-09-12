"""Talent Pool status management using Core candidates and logs."""

from __future__ import annotations

import json
import os
from typing import Any


ALLOWED_STATUSES = [
    "new",
    "matched",
    "contacted",
    "replied",
    "wechat_exchanged",
    "interview_scheduled",
    "interviewed",
    "offer",
    "hired",
    "rejected",
    "blacklisted",
]


def _driver():
    try:
        import psycopg  # type: ignore

        return psycopg
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return psycopg2
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 to use Talent Pool") from exc


def db_conn():
    url = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Set LAKEJOB_DATABASE_URL or DATABASE_URL")
    return _driver().connect(url)


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


def get_candidate_status(candidate_id: str) -> str:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload
            FROM logs
            WHERE payload->>'talent_pool' = 'true'
              AND payload->>'candidate_id' = %s
              AND payload->>'action' = 'update_status'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (candidate_id,),
        )
        row = cur.fetchone()
    if not row:
        return "new"
    return str(_payload_obj(row[0]).get("new_status") or _payload_obj(row[0]).get("status") or "new")


def get_candidate_notes(candidate_id: str) -> str:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload
            FROM logs
            WHERE payload->>'talent_pool' = 'true'
              AND payload->>'candidate_id' = %s
              AND payload->>'action' = 'update_notes'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (candidate_id,),
        )
        row = cur.fetchone()
    if not row:
        return ""
    return str(_payload_obj(row[0]).get("notes") or "")


def update_candidate_status(candidate_id: str, new_status: str) -> dict[str, Any]:
    if new_status not in ALLOWED_STATUSES:
        raise ValueError(f"unsupported talent status: {new_status}")
    old_status = get_candidate_status(candidate_id)
    with db_conn() as conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
            if not cur.fetchone():
                raise LookupError("candidate not found")
            payload = {
                "talent_pool": True,
                "candidate_id": candidate_id,
                "old_status": old_status,
                "new_status": new_status,
                "status": new_status,
                "action": "update_status",
                "success": True,
            }
            cur.execute(
                """
                INSERT INTO logs (log_type, level, message, entity_type, entity_id, payload, status)
                VALUES ('audit','info','talent status updated','candidate',%s,%s::jsonb,'active')
                RETURNING id
                """,
                (candidate_id, _json(payload)),
            )
            log_id = str(cur.fetchone()[0])
            conn.commit()
            return {"log_id": log_id, "old_status": old_status, "new_status": new_status}
        except Exception:
            conn.rollback()
            raise


def update_candidate_notes(candidate_id: str, notes: str) -> dict[str, Any]:
    with db_conn() as conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT id FROM candidates WHERE id = %s LIMIT 1", (candidate_id,))
            if not cur.fetchone():
                raise LookupError("candidate not found")
            payload = {
                "talent_pool": True,
                "candidate_id": candidate_id,
                "notes": notes,
                "action": "update_notes",
                "success": True,
            }
            cur.execute(
                """
                INSERT INTO logs (log_type, level, message, entity_type, entity_id, payload, status)
                VALUES ('audit','info','talent notes updated','candidate',%s,%s::jsonb,'active')
                RETURNING id
                """,
                (candidate_id, _json(payload)),
            )
            log_id = str(cur.fetchone()[0])
            conn.commit()
            return {"log_id": log_id, "notes": notes}
        except Exception:
            conn.rollback()
            raise


def list_candidates(
    *,
    status: str = "all",
    keyword: str = "",
    city: str = "",
    skill: str = "",
    score_min: str = "",
) -> list[dict[str, Any]]:
    filters = []
    params: list[Any] = []
    if keyword:
        filters.append("(c.name ILIKE %s OR c.headline ILIKE %s OR c.resume_text ILIKE %s)")
        params.extend([f"%{keyword}%", f"%{keyword}%", f"%{keyword}%"])
    if city:
        filters.append("c.city ILIKE %s")
        params.append(f"%{city}%")
    if skill:
        filters.append("c.skills::text ILIKE %s")
        params.append(f"%{skill}%")
    if score_min:
        filters.append("COALESCE(ms.score, 0) >= %s")
        params.append(float(score_min))
    where = "WHERE " + " AND ".join(filters) if filters else ""
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT c.id, c.name, c.city, c.current_title, c.skills::text AS skills,
                   c.status AS core_status, c.created_at, c.raw_data, ms.score
            FROM candidates c
            LEFT JOIN (
              SELECT candidate_id, MAX(score) AS score
              FROM match_scores
              WHERE candidate_id IS NOT NULL
              GROUP BY candidate_id
            ) ms ON ms.candidate_id = c.id
            {where}
            ORDER BY c.created_at DESC
            LIMIT 200
            """,
            tuple(params),
        )
        rows = _dicts(cur, cur.fetchall())
    for row in rows:
        candidate_id = str(row["id"])
        row["talent_status"] = get_candidate_status(candidate_id)
        row["source"] = (_payload_obj(row.get("raw_data")).get("source") or "unknown")
    if status != "all":
        rows = [row for row in rows if row["talent_status"] == status]
    return rows


def status_counts() -> dict[str, int]:
    counts = {status: 0 for status in ALLOWED_STATUSES}
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute("SELECT id FROM candidates")
        candidate_ids = [str(row[0]) for row in cur.fetchall()]
    for candidate_id in candidate_ids:
        status = get_candidate_status(candidate_id)
        if status in counts:
            counts[status] += 1
        else:
            counts["new"] += 1
    return counts


def get_candidate_detail(candidate_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT c.*, ms.score
            FROM candidates c
            LEFT JOIN (
              SELECT candidate_id, MAX(score) AS score
              FROM match_scores
              WHERE candidate_id IS NOT NULL
              GROUP BY candidate_id
            ) ms ON ms.candidate_id = c.id
            WHERE c.id = %s
            LIMIT 1
            """,
            (candidate_id,),
        )
        candidate = _one(cur)
        if not candidate:
            return None
        cur.execute(
            """
            SELECT created_at, direction, sender_type, sender_name, content, status
            FROM messages
            WHERE conversation_id IN (SELECT id FROM conversations WHERE candidate_id = %s)
            ORDER BY created_at DESC
            LIMIT 10
            """,
            (candidate_id,),
        )
        messages = _dicts(cur, cur.fetchall())
        cur.execute(
            """
            SELECT created_at, message, level, payload
            FROM logs
            WHERE entity_id = %s OR payload->>'candidate_id' = %s
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (candidate_id, candidate_id),
        )
        logs = _dicts(cur, cur.fetchall())

    raw_data = _payload_obj(candidate.get("raw_data"))
    resume_center = raw_data.get("resume_center") if isinstance(raw_data.get("resume_center"), dict) else {}
    return {
        "candidate": candidate,
        "talent_status": get_candidate_status(candidate_id),
        "notes": get_candidate_notes(candidate_id),
        "source": raw_data.get("source") or "unknown",
        "resume_summary": resume_center.get("summary", {}),
        "messages": messages,
        "logs": logs,
        "allowed_statuses": ALLOWED_STATUSES,
    }

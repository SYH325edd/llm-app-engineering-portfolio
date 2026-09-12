"""Message Center data access for conversations and messages.

This module only reads Core data and writes local status events to logs. It
does not send messages and does not call platform automation.
"""

from __future__ import annotations

import json
from typing import Any

from lakejob.application.recruiting.talent_pool import db_conn


ALLOWED_CONVERSATION_STATUSES = ["open", "replied", "pending", "closed", "archived", "failed"]


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


def get_latest_conversation_status(conversation_id: str) -> str:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload
            FROM logs
            WHERE payload->>'message_center' = 'true'
              AND payload->>'conversation_id' = %s
              AND payload->>'action' = 'update_conversation_status'
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (conversation_id,),
        )
        row = cur.fetchone()
        if row:
            status = str(_payload_obj(row[0]).get("new_status") or "")
            if status in ALLOWED_CONVERSATION_STATUSES:
                return status
        cur.execute("SELECT status FROM conversations WHERE id = %s LIMIT 1", (conversation_id,))
        row = cur.fetchone()
    core_status = str(row[0]) if row else ""
    if core_status == "active":
        return "open"
    if core_status in {"closed", "archived"}:
        return core_status
    return "pending"


def _conversation_source(row: dict[str, Any]) -> str:
    metadata = _payload_obj(row.get("metadata"))
    if metadata.get("source"):
        return str(metadata["source"])
    if row.get("candidate_id"):
        return "candidate"
    if row.get("job_id"):
        return "job"
    if row.get("application_id"):
        return "application"
    return "core"


def list_conversations(filters: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    filters = filters or {}
    where = []
    params: list[Any] = []
    keyword = str(filters.get("keyword") or "").strip()
    source_filter = str(filters.get("source") or "").strip()
    date_filter = str(filters.get("date") or "").strip()

    if keyword:
        where.append(
            """
            (
              c.counterparty_name ILIKE %s
              OR c.last_message_preview ILIKE %s
              OR cand.name ILIKE %s
              OR j.title ILIKE %s
              OR j.company_name ILIKE %s
            )
            """
        )
        params.extend([f"%{keyword}%"] * 5)
    if date_filter:
        where.append("COALESCE(c.last_message_at, c.created_at)::date = %s::date")
        params.append(date_filter)
    sql_where = "WHERE " + " AND ".join(where) if where else ""

    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            f"""
            SELECT
              c.id AS conversation_id,
              c.subject_type,
              c.subject_id,
              c.candidate_id,
              c.job_id,
              c.application_id,
              c.counterparty_name,
              c.counterparty_role,
              c.last_message_at,
              c.last_message_preview,
              c.status AS core_status,
              c.metadata,
              c.created_at,
              cand.name AS candidate_name,
              j.title AS job_title,
              j.company_name,
              app.direction AS application_direction,
              COUNT(m.id) AS message_count,
              MAX(m.created_at) AS latest_message_time,
              COALESCE(
                (ARRAY_AGG(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.id IS NOT NULL))[1],
                c.last_message_preview,
                ''
              ) AS latest_message
            FROM conversations c
            LEFT JOIN candidates cand ON cand.id = c.candidate_id
            LEFT JOIN jobs j ON j.id = c.job_id
            LEFT JOIN applications app ON app.id = c.application_id
            LEFT JOIN messages m ON m.conversation_id = c.id
            {sql_where}
            GROUP BY c.id, cand.name, j.title, j.company_name, app.direction
            ORDER BY COALESCE(MAX(m.created_at), c.last_message_at, c.created_at) DESC
            LIMIT 200
            """,
            tuple(params),
        )
        rows = _dicts(cur, cur.fetchall())

    result = []
    for row in rows:
        conversation_id = str(row["conversation_id"])
        status = get_latest_conversation_status(conversation_id)
        source = _conversation_source(row)
        if filters.get("status") and filters.get("status") != "all" and status != filters.get("status"):
            continue
        if source_filter and source_filter != "all" and source != source_filter:
            continue
        object_name = row.get("candidate_name") or row.get("job_title") or row.get("company_name") or row.get("counterparty_name") or "N/A"
        object_type = row.get("subject_type") or ("candidate" if row.get("candidate_id") else "job" if row.get("job_id") else "company")
        result.append(
            {
                **row,
                "conversation_id": conversation_id,
                "object_type": object_type,
                "object_name": object_name,
                "latest_message": row.get("latest_message") or "",
                "latest_message_time": row.get("latest_message_time") or row.get("last_message_at") or row.get("created_at"),
                "message_count": int(row.get("message_count") or 0),
                "status": status,
                "source": source,
            }
        )
    return result


def list_messages(conversation_id: str) -> list[dict[str, Any]]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, conversation_id, sender_type, sender_name, content, direction,
                   status, created_at, sent_at, metadata
            FROM messages
            WHERE conversation_id = %s
            ORDER BY created_at ASC
            """,
            (conversation_id,),
        )
        return _dicts(cur, cur.fetchall())


def get_conversation_detail(conversation_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT c.*, cand.name AS candidate_name, cand.city AS candidate_city,
                   cand.current_title AS candidate_title, j.title AS job_title,
                   j.company_name AS job_company, j.city AS job_city,
                   app.direction AS application_direction, app.status AS application_status
            FROM conversations c
            LEFT JOIN candidates cand ON cand.id = c.candidate_id
            LEFT JOIN jobs j ON j.id = c.job_id
            LEFT JOIN applications app ON app.id = c.application_id
            WHERE c.id = %s
            LIMIT 1
            """,
            (conversation_id,),
        )
        conversation = _one(cur)
        if not conversation:
            return None
        cur.execute(
            """
            SELECT created_at, level, message, payload
            FROM logs
            WHERE conversation_id = %s OR payload->>'conversation_id' = %s
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (conversation_id, conversation_id),
        )
        logs = _dicts(cur, cur.fetchall())
    return {
        "conversation": conversation,
        "status": get_latest_conversation_status(conversation_id),
        "messages": list_messages(conversation_id),
        "logs": logs,
        "allowed_statuses": ALLOWED_CONVERSATION_STATUSES,
        "source": _conversation_source(conversation),
    }


def update_conversation_status(conversation_id: str, status: str) -> dict[str, Any]:
    if status not in ALLOWED_CONVERSATION_STATUSES:
        raise ValueError(f"unsupported conversation status: {status}")
    old_status = get_latest_conversation_status(conversation_id)
    with db_conn() as conn:
        try:
            cur = conn.cursor()
            cur.execute("SELECT id FROM conversations WHERE id = %s LIMIT 1", (conversation_id,))
            if not cur.fetchone():
                raise LookupError("conversation not found")
            payload = {
                "message_center": True,
                "conversation_id": conversation_id,
                "action": "update_conversation_status",
                "old_status": old_status,
                "new_status": status,
                "success": True,
            }
            cur.execute(
                """
                INSERT INTO logs (conversation_id, log_type, level, message, entity_type, entity_id, payload, status)
                VALUES (%s,'audit','info','conversation status updated','conversation',%s,%s::jsonb,'active')
                RETURNING id
                """,
                (conversation_id, conversation_id, _json(payload)),
            )
            log_id = str(cur.fetchone()[0])
            conn.commit()
            return {"log_id": log_id, "old_status": old_status, "new_status": status}
        except Exception:
            conn.rollback()
            raise

"""Job 360 aggregation from existing Core tables and logs."""

from __future__ import annotations

import json
from typing import Any

from jobradar_log import db_conn


EMPTY = "暂无数据"


def _dicts(cur, rows) -> list[dict[str, Any]]:
    cols = [getattr(item, "name", item[0]) for item in cur.description]
    return [dict(zip(cols, row)) for row in rows]


def _one(cur) -> dict[str, Any] | None:
    row = cur.fetchone()
    if not row:
        return None
    cols = [getattr(item, "name", item[0]) for item in cur.description]
    return dict(zip(cols, row))


def payload_obj(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return {}


def get_job360(job_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT j.*, ms.score AS match_score
            FROM jobs j
            LEFT JOIN (
              SELECT job_id, MAX(score) AS score
              FROM match_scores
              WHERE job_id IS NOT NULL
              GROUP BY job_id
            ) ms ON ms.job_id = j.id
            WHERE j.id = %s
            LIMIT 1
            """,
            (job_id,),
        )
        job = _one(cur)
        if not job:
            return None

        cur.execute(
            """
            SELECT payload, created_at
            FROM logs
            WHERE payload->>'match_analysis' = 'true'
              AND payload->>'target_type' = 'job'
              AND payload->>'target_id' = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (job_id,),
        )
        analysis_row = _one(cur)

        cur.execute(
            """
            SELECT COUNT(DISTINCT candidate_id) AS matched_candidates,
                   COUNT(DISTINCT CASE WHEN score >= 85 THEN candidate_id END) AS a_count,
                   COUNT(DISTINCT CASE WHEN score >= 70 AND score < 85 THEN candidate_id END) AS b_count,
                   COUNT(DISTINCT CASE WHEN score < 70 THEN candidate_id END) AS c_count
            FROM match_scores
            WHERE job_id = %s AND candidate_id IS NOT NULL
            """,
            (job_id,),
        )
        candidate_stats = _one(cur) or {}

        cur.execute(
            """
            SELECT COUNT(DISTINCT CASE WHEN m.direction = 'outbound' THEN c.id END) AS sent_people,
                   COUNT(DISTINCT CASE WHEN m.direction = 'inbound' THEN c.id END) AS replied_people,
                   COUNT(m.id) AS message_count,
                   COALESCE((ARRAY_AGG(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.id IS NOT NULL))[1], '') AS latest_message
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.job_id = %s
            """,
            (job_id,),
        )
        communication = _one(cur) or {}

        cur.execute(
            """
            SELECT payload->>'new_status' AS status, COUNT(DISTINCT payload->>'candidate_id') AS count
            FROM logs
            WHERE payload->>'talent_pool' = 'true'
              AND payload->>'candidate_id' IN (
                SELECT candidate_id::text
                FROM conversations
                WHERE job_id = %s AND candidate_id IS NOT NULL
              )
            GROUP BY payload->>'new_status'
            """,
            (job_id,),
        )
        status_rows = _dicts(cur, cur.fetchall())

        cur.execute(
            """
            SELECT created_at, message, payload
            FROM logs
            WHERE entity_id = %s OR payload->>'job_id' = %s OR payload->>'target_id' = %s
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (job_id, job_id, job_id),
        )
        timeline = _dicts(cur, cur.fetchall())

    raw_data = payload_obj(job.get("raw_data"))
    analysis = payload_obj(analysis_row.get("payload")) if analysis_row else {}
    status_counts = {row.get("status"): int(row.get("count") or 0) for row in status_rows if row.get("status")}
    candidate_counts = {
        "matched_candidates": int(candidate_stats.get("matched_candidates") or 0),
        "a_count": int(candidate_stats.get("a_count") or 0),
        "b_count": int(candidate_stats.get("b_count") or 0),
        "c_count": int(candidate_stats.get("c_count") or 0),
    }
    comm = {
        "sent_people": int(communication.get("sent_people") or 0),
        "replied_people": int(communication.get("replied_people") or 0),
        "interview_people": status_counts.get("interview_scheduled", 0)
        + status_counts.get("interviewed", 0)
        + status_counts.get("interview", 0),
        "offer_people": status_counts.get("offer", 0),
        "message_count": int(communication.get("message_count") or 0),
        "latest_message": communication.get("latest_message") or EMPTY,
    }
    return {
        "job": job,
        "source": raw_data.get("source") or raw_data.get("platform") or EMPTY,
        "analysis": {
            "score": analysis.get("score", job.get("match_score") or EMPTY),
            "level": analysis.get("level", EMPTY),
            "tags": analysis.get("tags") or [],
            "summary": analysis.get("summary") or analysis.get("suggested_action") or EMPTY,
            "reasons": analysis.get("reasons") or [],
            "created_at": analysis_row.get("created_at") if analysis_row else EMPTY,
        },
        "candidate_stats": candidate_counts,
        "communication": comm,
        "ai_next_action": generate_ai_next_action(job, analysis, candidate_counts, comm),
        "timeline": timeline,
    }


def generate_ai_next_action(
    job: dict[str, Any] | None = None,
    analysis: dict[str, Any] | None = None,
    candidate_stats: dict[str, Any] | None = None,
    communication: dict[str, Any] | None = None,
) -> str:
    job = job or {}
    analysis = analysis or {}
    candidate_stats = candidate_stats or {}
    communication = communication or {}
    score_text = analysis.get("score") or job.get("match_score") or 0
    score = float(score_text) if str(score_text).replace(".", "", 1).isdigit() else 0
    if int(candidate_stats.get("a_count") or 0) >= 3:
        return "暂停搜索，优先推进A级候选人"
    if score and score < 70:
        return "优化JD或调整岗位画像"
    if int(candidate_stats.get("matched_candidates") or 0) == 0:
        return "继续搜索候选人"
    if int(communication.get("sent_people") or 0) == 0:
        return "建议生成沟通草稿"
    if int(communication.get("replied_people") or 0) == 0:
        return "继续跟进已沟通候选人"
    return "继续推进候选人流程"

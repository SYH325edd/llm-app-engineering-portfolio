"""Candidate 360 aggregation from existing Core tables and logs."""

from __future__ import annotations

import json
from typing import Any

from talent_pool import get_candidate_status
from talent_pool import db_conn


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


def get_candidate360(candidate_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT c.*, ms.score AS resume_or_match_score
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
            SELECT payload, created_at
            FROM logs
            WHERE payload->>'match_analysis' = 'true'
              AND payload->>'target_type' = 'candidate'
              AND payload->>'target_id' = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (candidate_id,),
        )
        analysis_row = _one(cur)

        cur.execute(
            """
            SELECT c.id, c.status, c.last_message_at, c.last_message_preview,
                   COUNT(m.id) AS message_count,
                   MAX(m.created_at) AS latest_message_time,
                   COALESCE((ARRAY_AGG(m.content ORDER BY m.created_at DESC) FILTER (WHERE m.id IS NOT NULL))[1], '') AS latest_message
            FROM conversations c
            LEFT JOIN messages m ON m.conversation_id = c.id
            WHERE c.candidate_id = %s
            GROUP BY c.id
            ORDER BY COALESCE(MAX(m.created_at), c.last_message_at, c.created_at) DESC
            LIMIT 1
            """,
            (candidate_id,),
        )
        conversation = _one(cur)

        cur.execute(
            """
            SELECT COUNT(*) AS count,
                   COALESCE((ARRAY_AGG(payload->>'content' ORDER BY created_at DESC))[1], '') AS latest_draft,
                   COALESCE((ARRAY_AGG(payload->>'status' ORDER BY created_at DESC))[1], '') AS latest_status
            FROM logs
            WHERE payload->>'message_draft' = 'true'
              AND payload->>'target_id' = %s
            """,
            (candidate_id,),
        )
        draft = _one(cur) or {}

        cur.execute(
            """
            SELECT created_at, message, payload
            FROM logs
            WHERE entity_id = %s OR payload->>'candidate_id' = %s OR payload->>'target_id' = %s
            ORDER BY created_at DESC
            LIMIT 20
            """,
            (candidate_id, candidate_id, candidate_id),
        )
        timeline = _dicts(cur, cur.fetchall())

    raw_data = payload_obj(candidate.get("raw_data"))
    resume_center = raw_data.get("resume_center") if isinstance(raw_data.get("resume_center"), dict) else {}
    summary = resume_center.get("summary") if isinstance(resume_center.get("summary"), dict) else {}
    analysis = payload_obj(analysis_row.get("payload")) if analysis_row else {}
    talent_status = get_candidate_status(candidate_id)
    return {
        "candidate": candidate,
        "source": raw_data.get("source") or EMPTY,
        "talent_status": talent_status,
        "resume": {
            "education": candidate.get("education_text") or raw_data.get("education") or EMPTY,
            "work_experience": candidate.get("experience_text") or raw_data.get("work_experience") or EMPTY,
            "project_experience": raw_data.get("project_experience") or resume_center.get("project_experience") or EMPTY,
            "skills": candidate.get("skills") or EMPTY,
            "score": candidate.get("resume_or_match_score") or resume_center.get("score") or EMPTY,
            "summary": summary or resume_center.get("summary") or EMPTY,
        },
        "match_analysis": {
            "score": analysis.get("score", EMPTY),
            "level": analysis.get("level", EMPTY),
            "strengths": analysis.get("strengths") or [],
            "risks": analysis.get("risks") or [],
            "suggested_action": analysis.get("suggested_action") or EMPTY,
            "tags": analysis.get("tags") or [],
            "created_at": analysis_row.get("created_at") if analysis_row else EMPTY,
        },
        "communication": {
            "message_count": int((conversation or {}).get("message_count") or 0),
            "latest_message": (conversation or {}).get("latest_message") or (conversation or {}).get("last_message_preview") or EMPTY,
            "latest_reply_time": (conversation or {}).get("latest_message_time") or (conversation or {}).get("last_message_at") or EMPTY,
            "conversation_status": (conversation or {}).get("status") or EMPTY,
        },
        "drafts": {
            "count": int(draft.get("count") or 0),
            "latest": draft.get("latest_draft") or EMPTY,
            "status": draft.get("latest_status") or EMPTY,
        },
        "ai_next_action": generate_ai_next_action(talent_status, analysis, conversation, draft),
        "timeline": timeline,
    }


def generate_ai_next_action(status: str, analysis: dict[str, Any] | None = None, conversation: dict[str, Any] | None = None, draft: dict[str, Any] | None = None) -> str:
    analysis = analysis or {}
    score = float(analysis.get("score") or 0) if str(analysis.get("score") or "").replace(".", "", 1).isdigit() else 0
    if status in {"rejected", "blacklisted"}:
        return "建议淘汰"
    if status in {"interview_scheduled", "interviewed"}:
        return "建议安排面试跟进"
    if score >= 85:
        return "建议安排面试"
    if (conversation or {}).get("latest_message"):
        return "建议继续沟通"
    if int((draft or {}).get("count") or 0) > 0:
        return "建议审核草稿后再沟通"
    return "建议补充匹配分析后再判断"

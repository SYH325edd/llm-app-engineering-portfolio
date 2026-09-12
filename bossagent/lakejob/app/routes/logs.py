from fastapi import APIRouter, Request

from lakejob.app.db import db_safe, fetch_dicts, fetch_one
from lakejob.app.payload import payload_obj, payload_text
from lakejob.app.ui import templates


router = APIRouter()


@router.get("/logs")
def logs(request: Request):
    rows = db_safe(
        [],
        fetch_dicts,
        """
        SELECT created_at, message, status, payload
        FROM logs
        ORDER BY created_at DESC
        LIMIT 100
        """,
    )
    for row in rows:
        payload = payload_obj(row.get("payload"))
        row["payload_text"] = payload_text(payload)
        row["action"] = payload.get("action") or payload.get("command") or payload.get("task_name") or row.get("message")
        row["reason"] = payload.get("reason", "")
        row["blocked"] = payload.get("blocked", "")
    return templates.TemplateResponse(request, "logs.html", {"active": "logs", "logs": rows})


@router.get("/match-analysis/{log_id}")
def match_analysis_detail(request: Request, log_id: str, message: str = "", error: str = ""):
    try:
        row = fetch_one("SELECT payload FROM logs WHERE id = %s AND payload->>'match_analysis' = 'true' LIMIT 1", (log_id,))
        analysis = payload_obj(row.get("payload")) if row else None
    except Exception as exc:
        analysis = None
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "match_analysis_detail.html",
        {"active": "logs", "analysis": analysis, "message": message, "error": error or ("" if analysis else "match analysis not found")},
    )

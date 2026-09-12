from fastapi import APIRouter, Request

from audit_log import record_audit
from candidate360 import get_candidate360
from recruit_flow import clamp_limit as clamp_recruit_limit
from recruit_flow import load_recruit_profile, run_recruit_flow
from web.db import db_safe, fetch_dicts
from web.ui import redirect, templates
from web.security import require_local_request


router = APIRouter()


@router.get("/candidates")
def candidates(request: Request):
    rows = db_safe(
        [],
        fetch_dicts,
        """
        SELECT c.id, c.name, c.city, c.skills::text AS skills, ms.score, c.status, c.created_at
        FROM candidates c
        LEFT JOIN (
          SELECT candidate_id, MAX(score) AS score FROM match_scores
          WHERE candidate_id IS NOT NULL GROUP BY candidate_id
        ) ms ON ms.candidate_id = c.id
        ORDER BY c.created_at DESC
        LIMIT 100
        """,
    )
    return templates.TemplateResponse(
        request,
        "candidates.html",
        {"active": "candidates", "candidates": rows},
    )


@router.post("/recruit/run")
async def recruit_run(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/recruit", error=guard.reason)

    try:
        form = await request.form()
        keyword = str(form.get("keyword") or "Python")
        profile_keyword = str(load_recruit_profile().get("job_title") or "")
        record_audit(
            "task.created",
            target_type="candidate_search",
            metadata={"keyword": keyword, "source": "web_console"},
        )
        if profile_keyword and profile_keyword != keyword:
            record_audit(
                "task.keywords_changed",
                target_type="candidate_search",
                before={"keyword": profile_keyword},
                after={"keyword": keyword},
            )
        limit = clamp_recruit_limit(form.get("limit") or 1)
        mode = "real" if form.get("mode") == "real" else "mock"
        result = run_recruit_flow(
            keyword=keyword,
            city=str(form.get("city") or ""),
            skills=str(form.get("skills") or ""),
            limit=limit,
            mode=mode,
            dry_run=str(form.get("dry_run", "on")).lower() in {"1", "true", "yes", "on"},
        )
        return templates.TemplateResponse(
            request,
            "recruit_flow_results.html",
            {"active": "recruit", "result": result, "message": "", "error": ""},
        )
    except Exception as exc:
        return redirect("/recruit", error=str(exc))


@router.get("/candidate360/{candidate_id}")
def candidate360_page(request: Request, candidate_id: str, message: str = "", error: str = ""):
    try:
        detail = get_candidate360(candidate_id)
    except Exception as exc:
        detail = None
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "candidate360.html",
        {
            "active": "talent_pool",
            "detail": detail,
            "message": message,
            "error": error or ("" if detail else "candidate not found"),
        },
    )

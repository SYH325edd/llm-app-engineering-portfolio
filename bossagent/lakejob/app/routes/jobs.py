from typing import Any

from fastapi import APIRouter, Request

from lakejob.safety.audit import record_audit
from lakejob.application.jobs.job360 import get_job360
from lakejob.application.jobs.flow import clamp_limit as clamp_job_limit
from lakejob.application.jobs.flow import load_jobseeker_profile_for_flow, run_job_flow
from lakejob.app.db import db_safe, fetch_dicts
from lakejob.app.ui import redirect, templates
from lakejob.app.security import require_local_request


router = APIRouter()


@router.get("/jobs")
def jobs(request: Request, keyword: str = "", city: str = "", company: str = ""):
    filters = []
    params: list[Any] = []
    if keyword:
        filters.append("(j.title ILIKE %s OR j.description ILIKE %s)")
        params.extend([f"%{keyword}%", f"%{keyword}%"])
    if city:
        filters.append("j.city ILIKE %s")
        params.append(f"%{city}%")
    if company:
        filters.append("j.company_name ILIKE %s")
        params.append(f"%{company}%")
    where = "WHERE " + " AND ".join(filters) if filters else ""
    rows = db_safe(
        [],
        fetch_dicts,
        f"""
        SELECT j.id, j.title, j.company_name, j.city, j.salary_text, ms.score AS match_score,
               j.status, j.created_at
        FROM jobs j
        LEFT JOIN (SELECT job_id, MAX(score) AS score FROM match_scores GROUP BY job_id) ms
          ON ms.job_id = j.id
        {where}
        ORDER BY j.created_at DESC
        LIMIT 100
        """,
        tuple(params),
    )
    return templates.TemplateResponse(
        request,
        "jobs.html",
        {"active": "jobs", "jobs": rows, "keyword": keyword, "city": city, "company": company},
    )


@router.post("/job/run")
async def job_run(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/job", error=guard.reason)

    try:
        form = await request.form()
        keyword = str(form.get("keyword") or "Python")
        profile_keyword = str(load_jobseeker_profile_for_flow().get("target_job_title") or "")
        record_audit(
            "task.created",
            target_type="job_search",
            metadata={"keyword": keyword, "source": "web_console"},
        )
        if profile_keyword and profile_keyword != keyword:
            record_audit(
                "task.keywords_changed",
                target_type="job_search",
                before={"keyword": profile_keyword},
                after={"keyword": keyword},
            )
        limit = clamp_job_limit(form.get("limit") or 1)
        mode = "real" if form.get("mode") == "real" else "mock"
        result = run_job_flow(
            keyword=keyword,
            city=str(form.get("city") or ""),
            skills=str(form.get("skills") or ""),
            limit=limit,
            mode=mode,
            dry_run=True,
        )
        return templates.TemplateResponse(
            request,
            "job_flow_results.html",
            {"active": "job", "result": result, "message": "", "error": ""},
        )
    except Exception as exc:
        return redirect("/job", error=str(exc))


@router.get("/job360/{job_id}")
def job360_page(request: Request, job_id: str, message: str = "", error: str = ""):
    try:
        detail = get_job360(job_id)
    except Exception as exc:
        detail = None
        error = error or str(exc)
    return templates.TemplateResponse(
        request,
        "job360.html",
        {
            "active": "jobs",
            "detail": detail,
            "message": message,
            "error": error or ("" if detail else "job not found"),
        },
    )

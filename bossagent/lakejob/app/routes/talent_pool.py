from fastapi import APIRouter, Form, Request

from lakejob.application.recruiting.talent_pool import (
    ALLOWED_STATUSES,
    get_candidate_detail,
    list_candidates,
    status_counts,
    update_candidate_notes,
    update_candidate_status,
)
from lakejob.app.ui import redirect, templates
from lakejob.app.security import require_local_request


router = APIRouter()


@router.get("/talent-pool")
def talent_pool_page(
    request: Request,
    status: str = "all",
    keyword: str = "",
    city: str = "",
    skill: str = "",
    score_min: str = "",
    message: str = "",
    error: str = "",
):
    try:
        counts = status_counts()
        candidates = list_candidates(
            status=status,
            keyword=keyword,
            city=city,
            skill=skill,
            score_min=score_min,
        )
    except Exception as exc:
        counts = {item: 0 for item in ALLOWED_STATUSES}
        candidates = []
        error = error or str(exc)

    return templates.TemplateResponse(
        request,
        "talent_pool.html",
        {
            "active": "talent_pool",
            "counts": counts,
            "candidates": candidates,
            "allowed_statuses": ALLOWED_STATUSES,
            "filters": {
                "status": status,
                "keyword": keyword,
                "city": city,
                "skill": skill,
                "score_min": score_min,
            },
            "message": message,
            "error": error,
        },
    )


@router.get("/talent-pool/{candidate_id}")
def talent_candidate_detail_page(
    request: Request,
    candidate_id: str,
    message: str = "",
    error: str = "",
):
    try:
        detail = get_candidate_detail(candidate_id)
    except Exception as exc:
        detail = None
        error = error or str(exc)

    return templates.TemplateResponse(
        request,
        "talent_candidate_detail.html",
        {
            "active": "talent_pool",
            "detail": detail,
            "message": message,
            "error": error or ("" if detail else "candidate not found"),
        },
    )


@router.post("/talent-pool/{candidate_id}/status")
def talent_candidate_status(
    request: Request,
    candidate_id: str,
    status: str = Form(...),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect(f"/talent-pool/{candidate_id}", error=guard.reason)

    try:
        update_candidate_status(candidate_id, status)
        return redirect(f"/talent-pool/{candidate_id}", "status updated")
    except Exception as exc:
        return redirect(f"/talent-pool/{candidate_id}", error=str(exc))


@router.post("/talent-pool/{candidate_id}/notes")
def talent_candidate_notes(
    request: Request,
    candidate_id: str,
    notes: str = Form(""),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect(f"/talent-pool/{candidate_id}", error=guard.reason)

    try:
        update_candidate_notes(candidate_id, notes)
        return redirect(f"/talent-pool/{candidate_id}", "notes updated")
    except Exception as exc:
        return redirect(f"/talent-pool/{candidate_id}", error=str(exc))

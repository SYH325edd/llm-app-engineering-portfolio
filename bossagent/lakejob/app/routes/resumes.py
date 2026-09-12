from fastapi import APIRouter, File, Request, UploadFile

from lakejob.application.resumes.center import (
    get_resume_ai_status,
    get_resume_detail,
    list_resumes,
    process_resume_upload,
)
from lakejob.app.ui import redirect, templates
from lakejob.app.security import require_local_request


router = APIRouter()


@router.get("/resumes")
def resumes(request: Request, provider: str = "all", status: str = "all", message: str = "", error: str = ""):
    try:
        rows = list_resumes(provider=provider, status=status)
    except Exception as exc:
        rows = []
        error = error or str(exc)

    return templates.TemplateResponse(
        request,
        "resumes.html",
        {
            "active": "resumes",
            "resumes": rows,
            "provider_filter": provider,
            "status_filter": status,
            "message": message,
            "error": error,
        },
    )



@router.get("/resumes/upload")
def resume_upload_page(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "resume_upload.html",
        {
            "active": "resumes",
            "ai_status": get_resume_ai_status(),
            "message": message,
            "error": error,
        },
    )


@router.post("/resumes/upload")
async def resume_upload(request: Request, file: UploadFile = File(...)):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/resumes/upload", error=guard.reason)

    try:
        content = await file.read()
        result = process_resume_upload(file.filename or "resume.txt", content)
        candidate_id = result["candidate"]["id"]
        return redirect(f"/resumes/{candidate_id}", "resume uploaded")
    except Exception as exc:
        return redirect("/resumes/upload", error=str(exc))


@router.get("/resumes/{candidate_id}")
def resume_detail(request: Request, candidate_id: str, message: str = "", error: str = ""):
    try:
        detail = get_resume_detail(candidate_id)
    except Exception as exc:
        detail = None
        error = error or str(exc)

    if not detail:
        return templates.TemplateResponse(
            request,
            "resume_detail.html",
            {
                "active": "resumes",
                "resume": None,
                "message": message,
                "error": error or "resume not found",
            },
        )

    return templates.TemplateResponse(
        request,
        "resume_detail.html",
        {
            "active": "resumes",
            "resume": detail,
            "message": message,
            "error": error,
        },
    )

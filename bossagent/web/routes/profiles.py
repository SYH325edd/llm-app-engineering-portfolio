from fastapi import APIRouter, Request

from profile_center import (
    JOBSEEKER_FIELDS,
    RECRUITER_FIELDS,
    load_jobseeker_profile,
    load_recruiter_profile,
    save_jobseeker_profile,
    save_recruiter_profile,
)
from web.ui import redirect, templates
from web.security import require_local_request


router = APIRouter()


@router.get("/profiles")
def profiles(request: Request):
    return templates.TemplateResponse(request, "profiles.html", {"active": "profiles"})


@router.get("/profiles/recruiter")
def recruiter_profile_page(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "profile_recruiter.html",
        {
            "active": "profiles",
            "profile": load_recruiter_profile(),
            "fields": RECRUITER_FIELDS,
            "message": message,
            "error": error,
        },
    )


@router.post("/profiles/recruiter")
async def save_recruiter_profile_page(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/profiles/recruiter", error=guard.reason)

    try:
        form = await request.form()
        data = {field: str(form.get(field, "")) for field in RECRUITER_FIELDS}
        save_recruiter_profile(data)
        return redirect("/profiles/recruiter", "profile saved")
    except Exception as exc:
        return redirect("/profiles/recruiter", error=str(exc))


@router.get("/profiles/jobseeker")
def jobseeker_profile_page(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "profile_jobseeker.html",
        {
            "active": "profiles",
            "profile": load_jobseeker_profile(),
            "fields": JOBSEEKER_FIELDS,
            "message": message,
            "error": error,
        },
    )


@router.post("/profiles/jobseeker")
async def save_jobseeker_profile_page(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/profiles/jobseeker", error=guard.reason)

    try:
        form = await request.form()
        data = {field: str(form.get(field, "")) for field in JOBSEEKER_FIELDS}
        save_jobseeker_profile(data)
        return redirect("/profiles/jobseeker", "profile saved")
    except Exception as exc:
        return redirect("/profiles/jobseeker", error=str(exc))

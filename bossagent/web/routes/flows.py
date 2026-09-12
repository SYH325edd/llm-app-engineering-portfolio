from fastapi import APIRouter, Request

from job_flow import load_jobseeker_profile_for_flow
from recruit_flow import load_recruit_profile
from web.ui import templates


router = APIRouter()


@router.get("/recruit")
def recruit_page(request: Request, message: str = "", error: str = ""):
    profile = load_recruit_profile()
    defaults = {
        "keyword": profile.get("job_title") or "Python",
        "city": profile.get("city") or "鏉窞",
        "skills": profile.get("core_skills") or "Python,FastAPI",
        "limit": 1,
    }
    return templates.TemplateResponse(
        request,
        "recruit_flow.html",
        {"active": "recruit", "profile": profile, "defaults": defaults, "message": message, "error": error},
    )


@router.get("/job")
def job_page(request: Request, message: str = "", error: str = ""):
    profile = load_jobseeker_profile_for_flow()
    defaults = {
        "keyword": profile.get("target_job_title") or "Python",
        "city": profile.get("target_city") or "鏉窞",
        "skills": profile.get("skills") or "Python,FastAPI",
        "limit": 1,
    }
    return templates.TemplateResponse(
        request,
        "job_flow.html",
        {"active": "job", "profile": profile, "defaults": defaults, "message": message, "error": error},
    )

from fastapi import APIRouter, Request

from lakejob.app.dashboard_data import dashboard_stats, recent_task_flow
from lakejob.app.ui import templates


router = APIRouter()


@router.get("/")
def dashboard(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "active": "dashboard",
            "stats": dashboard_stats(),
            "task_flow": recent_task_flow(10),
            "message": message,
            "error": error,
        },
    )

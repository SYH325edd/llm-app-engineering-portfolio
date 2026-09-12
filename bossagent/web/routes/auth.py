from fastapi import APIRouter, Request

from auth_center import (
    get_auth_center_status,
    reset_auth_state,
    reset_browser_profile,
)
from web.ui import redirect, templates
from web.security import require_local_request


router = APIRouter()


@router.get("/auth-center")
def auth_center_page(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "local_control.html",
        {
            "active": "auth_center",
            "auth_only": True,
            "auth": get_auth_center_status(),
            "message": message,
            "error": error,
        },
    )


@router.post("/auth-center/reset-auth")
def auth_center_reset_auth(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/auth-center", error=guard.reason)

    try:
        removed = reset_auth_state()
        return redirect(
            "/auth-center",
            "auth_state reset" if removed else "auth_state already absent",
        )
    except Exception as exc:
        return redirect("/auth-center", error=str(exc))


@router.post("/auth-center/reset-browser-profile")
def auth_center_reset_browser_profile(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/auth-center", error=guard.reason)

    try:
        removed = reset_browser_profile()
        return redirect(
            "/auth-center",
            "browser profile reset" if removed else "browser profile already absent",
        )
    except Exception as exc:
        return redirect("/auth-center", error=str(exc))

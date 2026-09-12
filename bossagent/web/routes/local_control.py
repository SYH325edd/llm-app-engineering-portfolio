from fastapi import APIRouter, Request

from local_control import (
    config_from_form,
    load_config as load_local_control_config,
    resume_center_status,
    save_config as save_local_control_config,
    system_status as local_system_status,
)
from web.ui import redirect, templates
from web.security import require_local_request


router = APIRouter()


@router.get("/control")
def control_page(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "local_control.html",
        {
            "active": "control",
            "config": load_local_control_config(),
            "resume_status": resume_center_status(),
            "system_status": local_system_status(),
            "auth_only": False,
            "message": message,
            "error": error,
        },
    )


@router.post("/control/save")
async def control_save(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/control", error=guard.reason)

    try:
        form = await request.form()
        save_local_control_config(config_from_form(dict(form), load_local_control_config()))
        return redirect("/control", "control config saved")
    except Exception as exc:
        return redirect("/control", error=str(exc))


@router.post("/control/run/{target}/{action}")
async def control_run(request: Request, target: str, action: str):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/control", error=guard.reason)

    # Local Control intentionally does not execute real search/apply/message actions.
    del request, target, action
    return redirect(
        "/control",
        error="Control Center does not execute search, apply, or message actions.",
    )

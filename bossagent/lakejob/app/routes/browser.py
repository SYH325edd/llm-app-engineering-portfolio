from __future__ import annotations

from fastapi import APIRouter, Request

from lakejob.infrastructure.browser.browser_launcher import BOSS_HOME_URL, launch_boss_browser
from lakejob.infrastructure.browser.browser_runtime import (
    get_boss_runtime_status,
    start_boss_runtime_browser,
    stop_boss_runtime_browser,
)
from lakejob.infrastructure.browser.browser_session import get_browser_session_status
from lakejob.app.audit import log_web_action
from lakejob.app.ui import redirect, templates


router = APIRouter()


def _safe_log(action: str, payload: dict, result: dict, ok: bool, error: str = "") -> None:
    try:
        log_web_action(action, payload, result, ok, error)
    except Exception:
        # Browser routes must keep working even when optional audit tables do not exist.
        pass


@router.get("/browser")
def browser_page(request: Request, message: str = "", error: str = ""):
    session_status = get_browser_session_status()
    runtime_status = get_boss_runtime_status()
    return templates.TemplateResponse(
        request,
        "browser.html",
        {
            "active": "browser",
            "message": message,
            "error": error,
            "boss_home_url": BOSS_HOME_URL,
            "session_status": session_status.to_dict(),
            "runtime_status": runtime_status.to_dict(),
        },
    )


@router.post("/browser/launch")
def browser_launch():
    result = launch_boss_browser()
    session_status = get_browser_session_status()
    _safe_log(
        "launch_boss_browser",
        {"session_mode": session_status.mode},
        {"launch_result": result.to_dict(), "session_status": session_status.to_dict()},
        result.ok,
        "" if result.ok else result.message,
    )

    if result.ok:
        return redirect("/browser", message=result.message)
    return redirect("/browser", error=result.message)


@router.get("/browser/runtime/status")
def browser_runtime_status():
    return get_boss_runtime_status().to_dict()


@router.post("/browser/runtime/start")
def browser_runtime_start():
    status = start_boss_runtime_browser()
    _safe_log(
        "start_boss_runtime_browser",
        {},
        status.to_dict(),
        status.runtime_available and status.is_running,
        "" if status.runtime_available and status.is_running else status.message,
    )
    if status.runtime_available and status.is_running:
        return redirect("/browser", message=status.message)
    return redirect("/browser", error=status.message)


@router.post("/browser/runtime/stop")
def browser_runtime_stop():
    status = stop_boss_runtime_browser()
    _safe_log("stop_boss_runtime_browser", {}, status.to_dict(), True, "")
    return redirect("/browser", message=status.message)

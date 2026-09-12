from fastapi import APIRouter, Form, Request

from lakejob.application.control.actions import (
    get_ai_settings_view,
    load_real_run_config,
    save_ai_settings,
    save_yaml,
    test_ai_settings_connection,
)
from lakejob.app.audit import log_web_action
from lakejob.app.config_schema import CONFIG_FIELDS, REAL_RUN_CONFIG
from lakejob.app.ui import redirect, templates
from lakejob.app.security import require_local_request


router = APIRouter()



def parse_int_field(name: str, raw: str, *, min_value: int | None = None, max_value: int | None = None) -> int:
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be an integer") from exc

    if min_value is not None and value < min_value:
        raise ValueError(f"{name} must be >= {min_value}")

    if max_value is not None and value > max_value:
        raise ValueError(f"{name} must be <= {max_value}")

    return value


def parse_delay(raw: str):
    value = str(raw or "").strip()
    if not value:
        raise ValueError("random_delay_seconds is required")

    normalized = value.strip("[]()")
    if "," in normalized:
        parts = [part.strip() for part in normalized.split(",") if part.strip()]
        if len(parts) != 2:
            raise ValueError("random_delay_seconds must be an integer or a two-item range")
        start = int(parts[0])
        end = int(parts[1])
        if start < 0:
            raise ValueError("random_delay_seconds must be >= 0")
        if end < start:
            raise ValueError("random_delay_seconds range end must be >= start")
        return [start, end]

    parsed = int(normalized)
    if parsed < 0:
        raise ValueError("random_delay_seconds must be >= 0")
    return parsed



@router.get("/config")
def config_page(request: Request, message: str = "", error: str = ""):
    config = load_real_run_config()
    delay = config.get("random_delay_seconds", config.get("random_delay_range_seconds", [30, 90]))
    if isinstance(delay, list):
        delay_text = ",".join(str(item) for item in delay)
    else:
        delay_text = str(delay)
    view = {key: config.get(key, "") for key in CONFIG_FIELDS}
    view["random_delay_seconds"] = delay_text
    return templates.TemplateResponse(
        request,
        "config.html",
        {"active": "config", "config": view, "message": message, "error": error},
    )


@router.get("/ai-settings")
def ai_settings_page(request: Request, message: str = "", error: str = ""):
    return templates.TemplateResponse(
        request,
        "ai_settings.html",
        {
            "active": "ai_settings",
            "settings": get_ai_settings_view(),
            "message": message,
            "error": error,
            "test_result": None,
        },
    )


@router.post("/config")
def update_config(
    request: Request,
    daily_real_apply_limit: str = Form(...),
    daily_real_message_limit: str = Form(...),
    max_items_per_run: str = Form(...),
    min_action_interval_seconds: str = Form(...),
    random_delay_seconds: str = Form(...),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/config", error=guard.reason)

    before = load_real_run_config()
    try:
        after = dict(before)
        after["daily_real_apply_limit"] = parse_int_field(
            "daily_real_apply_limit",
            daily_real_apply_limit,
            min_value=0,
            max_value=20,
        )
        after["daily_real_message_limit"] = parse_int_field(
            "daily_real_message_limit",
            daily_real_message_limit,
            min_value=0,
            max_value=20,
        )
        after["max_items_per_run"] = parse_int_field(
            "max_items_per_run",
            max_items_per_run,
            min_value=1,
            max_value=10,
        )
        interval = parse_int_field(
            "min_action_interval_seconds",
            min_action_interval_seconds,
            min_value=30,
        )
        after["min_action_interval_seconds"] = interval
        after["min_interval_seconds"] = interval

        delay = parse_delay(random_delay_seconds)
        after["random_delay_seconds"] = delay
        after["random_delay_range_seconds"] = delay

        save_yaml(REAL_RUN_CONFIG, after)
        log_web_action(
            "update_config",
            before,
            {key: after.get(key) for key in CONFIG_FIELDS},
            True,
        )
        return redirect("/config", "saved")

    except Exception as exc:
        log_web_action("update_config", before, {}, False, str(exc))
        return redirect("/config", error=str(exc))


@router.post("/ai-settings")
def update_ai_settings(
    request: Request,
    provider: str = Form(...),
    model: str = Form(...),
    base_url: str = Form(...),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/ai-settings", error=guard.reason)

    result = save_ai_settings(provider, model, base_url)
    if result.success:
        return redirect("/ai-settings", "saved")
    return redirect("/ai-settings", error=result.message)


@router.post("/ai-settings/test")
def test_ai_settings(request: Request):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/ai-settings", error=guard.reason)

    result = test_ai_settings_connection()
    return templates.TemplateResponse(
        request,
        "ai_settings.html",
        {
            "active": "ai_settings",
            "settings": get_ai_settings_view(),
            "message": "test completed" if result["success"] else "",
            "error": result["error"] if not result["success"] else "",
            "test_result": result,
        },
    )

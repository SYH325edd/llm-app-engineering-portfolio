from fastapi import APIRouter, Form, Request

from lakejob.safety.audit import record_audit
from lakejob.application.control.actions import SCHEDULER_CONFIG, load_scheduler_config, save_yaml
from lakejob.app.audit import log_web_action
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


SCHEDULER_TASKS = (
    "jobradar_search",
    "jobradar_apply",
    "recruitradar_search",
    "message_draft",
)


@router.get("/scheduler")
def scheduler_page(request: Request, message: str = "", error: str = ""):
    config = load_scheduler_config()
    tasks = []
    for task_name in SCHEDULER_TASKS:
        task = config.get(task_name, {}) or {}
        tasks.append(
            {
                "task_name": task_name,
                "enabled": bool(task.get("enabled", False)),
                "cron": task.get("cron", ""),
                "dry_run": bool(task.get("dry_run", True)),
                "limit": task.get("limit", task.get("apply_limit", task.get("message_limit", 1))),
            }
        )
    return templates.TemplateResponse(
        request,
        "scheduler.html",
        {"active": "scheduler", "tasks": tasks, "message": message, "error": error},
    )


@router.post("/scheduler")
def update_scheduler(
    request: Request,
    task_name: str = Form(...),
    enabled: str = Form("false"),
    cron: str = Form(""),
    dry_run: str = Form("false"),
    limit: str = Form(...),
):
    guard = require_local_request(request.client.host if request.client else None)
    if not guard.allowed:
        return redirect("/scheduler", error=guard.reason)

    before_all = load_scheduler_config()
    try:
        if task_name not in SCHEDULER_TASKS:
            raise ValueError("unsupported scheduler task")

        parsed_limit = parse_int_field("limit", limit, min_value=1, max_value=10)
        after_all = dict(before_all)
        before = dict(after_all.get(task_name, {}) or {})
        task = dict(before)

        task["enabled"] = enabled == "true"
        task["cron"] = cron.strip()
        task["dry_run"] = dry_run == "true"

        if not task["cron"]:
            raise ValueError("cron is required")

        if task_name == "jobradar_apply":
            task["apply_limit"] = parsed_limit
            task.pop("limit", None)
        elif task_name == "recruitradar_message":
            task["message_limit"] = parsed_limit
            task.pop("limit", None)
        else:
            task["limit"] = parsed_limit

        after_all[task_name] = task
        save_yaml(SCHEDULER_CONFIG, after_all)

        log_web_action("update_scheduler", {task_name: before}, {task_name: task}, True)

        if not before:
            record_audit(
                "task.created",
                target_type="scheduler_task",
                target_id=task_name,
                before=before,
                after=task,
            )
        elif before.get("keyword") != task.get("keyword"):
            record_audit(
                "task.keywords_changed",
                target_type="scheduler_task",
                target_id=task_name,
                before={"keyword": before.get("keyword")},
                after={"keyword": task.get("keyword")},
            )

        return redirect("/scheduler", "saved")

    except Exception as exc:
        log_web_action("update_scheduler", before_all.get(task_name, {}), {}, False, str(exc))
        return redirect("/scheduler", error=str(exc))

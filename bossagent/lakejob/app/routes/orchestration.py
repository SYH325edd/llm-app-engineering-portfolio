from __future__ import annotations

from fastapi import APIRouter, Form, HTTPException, Request

from lakejob.orchestration import SerialOrchestrationEngine, TaskRequest
from lakejob.orchestration.models import AutomationMode, BusinessDomain, RiskLevel
from lakejob.orchestration.public_view import public_task_payload, public_task_summary
from lakejob.app.audit import log_web_action
from lakejob.app.ui import redirect, templates


router = APIRouter()
_ENGINE = SerialOrchestrationEngine()


def _safe_log(action: str, payload: dict, result: dict, ok: bool, error: str = "") -> None:
    try:
        log_web_action(action, payload, result, ok, error)
    except Exception:
        pass


@router.get("/orchestration")
def orchestration_page(request: Request, task_id: str = "", message: str = "", error: str = ""):
    records = _ENGINE.list(50)
    selected = None
    if task_id:
        try:
            selected = _ENGINE.get(task_id)
        except FileNotFoundError:
            error = error or "任务不存在"
    return templates.TemplateResponse(
        request,
        "orchestration.html",
        {
            "active": "orchestration",
            "message": message,
            "error": error,
            "records": records,
            "selected": selected,
            "task_types": [
                ("double_end_visual_agent", "双端视觉招聘闭环"),
                ("visual_runtime_demo", "视觉执行核心验证"),
                ("jobseeker_demo", "求职端闭环验证"),
                ("recruiter_demo", "招聘端闭环验证"),
                ("generic", "通用结构化任务"),
            ],
        },
    )


@router.post("/orchestration/tasks")
def create_orchestration_task(
    objective: str = Form(...),
    task_type: str = Form("double_end_visual_agent"),
    business_domain: str = Form("shared"),
    automation_mode: str = Form("supervised"),
    run_now: str = Form("1"),
):
    try:
        request = TaskRequest(
            objective=objective,
            task_type=task_type,
            business_domain=BusinessDomain(business_domain),
            automation_mode=AutomationMode(automation_mode),
            risk_level=RiskLevel.medium,
        )
        record = _ENGINE.create_and_run(request) if run_now == "1" else _ENGINE.create_task(request)
        _safe_log(
            "orchestration_task_created",
            request.model_dump(mode="json"),
            {"task_id": record.task_id, "status": record.status.value},
            True,
        )
        return redirect(
            f"/orchestration?task_id={record.task_id}",
            message=f"任务 {record.task_id} 已进入五角色串行闭环",
        )
    except Exception as exc:
        _safe_log("orchestration_task_created", {"objective": objective}, {}, False, str(exc))
        return redirect("/orchestration", error=f"创建任务失败：{exc}")


@router.post("/orchestration/tasks/{task_id}/run")
def run_orchestration_task(task_id: str):
    try:
        record = _ENGINE.run(task_id)
        _safe_log(
            "orchestration_task_run",
            {"task_id": task_id},
            {"status": record.status.value, "retry_count": record.retry_count},
            True,
        )
        return redirect(
            f"/orchestration?task_id={task_id}",
            message=f"任务状态：{record.status.value}",
        )
    except FileNotFoundError:
        return redirect("/orchestration", error="任务不存在")
    except Exception as exc:
        _safe_log("orchestration_task_run", {"task_id": task_id}, {}, False, str(exc))
        return redirect(f"/orchestration?task_id={task_id}", error=f"运行失败：{exc}")


@router.get("/api/orchestration/tasks")
def api_list_orchestration_tasks(limit: int = 50):
    return {
        "tasks": [public_task_summary(record) for record in _ENGINE.list(limit)],
    }


@router.post("/api/orchestration/tasks")
def api_create_orchestration_task(request: TaskRequest, run_now: bool = True):
    try:
        record = _ENGINE.create_and_run(request) if run_now else _ENGINE.create_task(request)
        return public_task_payload(record, _ENGINE.store)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/api/orchestration/tasks/{task_id}")
def api_get_orchestration_task(task_id: str):
    try:
        return public_task_payload(_ENGINE.get(task_id), _ENGINE.store)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="task not found") from exc


@router.post("/api/orchestration/tasks/{task_id}/run")
def api_run_orchestration_task(task_id: str):
    try:
        return public_task_payload(_ENGINE.run(task_id), _ENGINE.store)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail="task not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

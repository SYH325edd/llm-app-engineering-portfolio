from __future__ import annotations

from typing import Any

from .models import TaskRecord
from .store import OrchestrationStore


ROLE_LABELS = {
    "commander": "总指挥",
    "executor": "执行员",
    "supervisor": "监督员",
    "validator": "合验员",
    "auditor": "终审审计员",
    "system": "系统",
}


def public_task_payload(record: TaskRecord, store: OrchestrationStore | None = None) -> dict[str, Any]:
    """Return the user-facing result without exposing intermediate role drafts.

    Internal manifests, executor drafts, reviewer objects and private role context remain
    in the local store for auditability. The public response contains only the final
    result, role scores and the structured workflow log requested by the product spec.
    """

    final = record.final_result.model_dump(mode="json") if record.final_result else None
    log = []
    for entry in record.workflow_log:
        data = entry.model_dump(mode="json")
        role = str(data.get("role") or "system")
        data["role_label"] = ROLE_LABELS.get(role, role)
        log.append(data)

    lock_verified = False
    audit_chain_verified = False
    if store is not None:
        try:
            audit_chain_verified = store.verify_audit_chain(record.task_id)
        except Exception:
            audit_chain_verified = False
        if record.final_result and record.final_result.lock:
            try:
                lock_verified = store.verify_lock(record.task_id)
            except Exception:
                lock_verified = False

    scores = dict(record.final_result.scores) if record.final_result else _latest_scores(record)
    return {
        "task_id": record.task_id,
        "status": record.status.value,
        "objective": record.request.objective,
        "task_type": record.request.task_type,
        "business_domain": record.request.business_domain.value,
        "automation_mode": record.request.automation_mode.value,
        "retry_count": record.retry_count,
        "maximum_retry_count": record.manifest.maximum_retry_count if record.manifest else 3,
        "scores": scores,
        "workflow_log": log,
        "final_result": final,
        "integrity": {
            "audit_chain_verified": audit_chain_verified,
            "lock_verified": lock_verified,
        },
        "created_at": record.created_at,
        "updated_at": record.updated_at,
    }


def public_task_summary(record: TaskRecord) -> dict[str, Any]:
    scores = dict(record.final_result.scores) if record.final_result else _latest_scores(record)
    return {
        "task_id": record.task_id,
        "status": record.status.value,
        "objective": record.request.objective,
        "task_type": record.request.task_type,
        "retry_count": record.retry_count,
        "overall_score": scores.get("overall", 0),
        "locked": bool(record.final_result and record.final_result.lock),
        "updated_at": record.updated_at,
    }


def _latest_scores(record: TaskRecord) -> dict[str, int]:
    scores: dict[str, int] = {}
    for entry in record.workflow_log:
        role = str(entry.role)
        if role in ROLE_LABELS and role != "system" and entry.score is not None:
            scores[role] = int(entry.score)
    values = list(scores.values())
    scores["overall"] = round(sum(values) / len(values)) if values else 0
    return scores

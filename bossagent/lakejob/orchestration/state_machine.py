from __future__ import annotations

from .models import RoleName, TaskStatus


ALLOWED_TRANSITIONS: dict[TaskStatus, set[TaskStatus]] = {
    TaskStatus.created: {TaskStatus.commander_running},
    TaskStatus.commander_running: {TaskStatus.plan_ready, TaskStatus.terminated},
    TaskStatus.plan_ready: {TaskStatus.executor_running},
    TaskStatus.executor_running: {TaskStatus.draft_ready, TaskStatus.terminated},
    TaskStatus.draft_ready: {TaskStatus.supervisor_running},
    TaskStatus.supervisor_running: {TaskStatus.supervisor_passed, TaskStatus.supervisor_rejected},
    TaskStatus.supervisor_passed: {TaskStatus.validator_running},
    TaskStatus.supervisor_rejected: {TaskStatus.rework_created, TaskStatus.retry_limit_reached},
    TaskStatus.validator_running: {TaskStatus.validation_passed, TaskStatus.validation_rejected},
    TaskStatus.validation_passed: {TaskStatus.auditor_running},
    TaskStatus.validation_rejected: {TaskStatus.rework_created, TaskStatus.retry_limit_reached},
    TaskStatus.auditor_running: {TaskStatus.final_approved, TaskStatus.auditor_rejected},
    TaskStatus.auditor_rejected: {TaskStatus.rework_created, TaskStatus.retry_limit_reached},
    TaskStatus.rework_created: {TaskStatus.executor_running},
    TaskStatus.retry_limit_reached: {TaskStatus.terminated},
    TaskStatus.terminated: {TaskStatus.human_intervention_required},
    TaskStatus.final_approved: {TaskStatus.locked},
    TaskStatus.locked: set(),
    TaskStatus.human_intervention_required: set(),
}

ROLE_BY_RUNNING_STATUS = {
    TaskStatus.commander_running: RoleName.commander,
    TaskStatus.executor_running: RoleName.executor,
    TaskStatus.supervisor_running: RoleName.supervisor,
    TaskStatus.validator_running: RoleName.validator,
    TaskStatus.auditor_running: RoleName.auditor,
}


class InvalidWorkflowTransition(RuntimeError):
    pass


def transition(current: TaskStatus, target: TaskStatus) -> TaskStatus:
    if target not in ALLOWED_TRANSITIONS.get(current, set()):
        raise InvalidWorkflowTransition(f"invalid orchestration transition: {current.value} -> {target.value}")
    return target


def active_role_for(status: TaskStatus) -> RoleName | None:
    return ROLE_BY_RUNNING_STATUS.get(status)

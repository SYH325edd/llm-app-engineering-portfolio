from __future__ import annotations

from datetime import datetime, timezone
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class RoleName(StrEnum):
    commander = "commander"
    executor = "executor"
    supervisor = "supervisor"
    validator = "validator"
    auditor = "auditor"


class TaskStatus(StrEnum):
    created = "CREATED"
    commander_running = "COMMANDER_RUNNING"
    plan_ready = "PLAN_READY"
    executor_running = "EXECUTOR_RUNNING"
    draft_ready = "DRAFT_READY"
    supervisor_running = "SUPERVISOR_RUNNING"
    supervisor_passed = "SUPERVISOR_PASSED"
    supervisor_rejected = "SUPERVISOR_REJECTED"
    validator_running = "VALIDATOR_RUNNING"
    validation_passed = "VALIDATION_PASSED"
    validation_rejected = "VALIDATION_REJECTED"
    auditor_running = "AUDITOR_RUNNING"
    auditor_rejected = "AUDITOR_REJECTED"
    final_approved = "FINAL_APPROVED"
    locked = "LOCKED"
    rework_created = "REWORK_CREATED"
    retry_limit_reached = "RETRY_LIMIT_REACHED"
    terminated = "TERMINATED"
    human_intervention_required = "HUMAN_INTERVENTION_REQUIRED"


class Decision(StrEnum):
    pass_ = "PASS"
    reject = "REJECT"
    rewrite = "REWRITE"


class BusinessDomain(StrEnum):
    candidate = "candidate"
    employer = "employer"
    visual_runtime = "visual_runtime"
    shared = "shared"


class RiskLevel(StrEnum):
    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class AutomationMode(StrEnum):
    assist = "assist"
    supervised = "supervised"
    auto = "auto"


class AcceptanceCriterion(StrictModel):
    criterion_id: str
    description: str
    weight: int = Field(ge=1, le=100)
    mandatory: bool = True
    evidence_required: bool = True
    verification_method: str = "structured_check"


class Subtask(StrictModel):
    subtask_id: str
    order: int = Field(ge=1)
    title: str
    action: str
    inputs: list[str] = Field(default_factory=list)
    dependencies: list[str] = Field(default_factory=list)
    output_format: str = "json"
    evidence_required: list[str] = Field(default_factory=list)
    risk_level: RiskLevel = RiskLevel.low
    completion_condition: str


class TaskScope(StrictModel):
    included: list[str] = Field(default_factory=list)
    excluded: list[str] = Field(default_factory=list)


class TaskManifest(StrictModel):
    task_id: str
    prompt_format_version: str = "lakejob-serial-role-format/1.0"
    task_version: str = "1.0.0"
    final_objective: str
    task_type: str = "generic"
    business_domain: BusinessDomain = BusinessDomain.shared
    priority: Literal["P0", "P1", "P2"] = "P0"
    risk_level: RiskLevel = RiskLevel.medium
    automation_mode: AutomationMode = AutomationMode.supervised
    scope: TaskScope
    inputs: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    prohibited_actions: list[str] = Field(default_factory=list)
    acceptance_criteria: list[AcceptanceCriterion]
    subtasks: list[Subtask]
    maximum_retry_count: int = Field(default=3, ge=0, le=3)
    minimum_validation_score: int = Field(default=95, ge=95, le=100)
    lock_policy: Literal["immutable_after_final_approval"] = "immutable_after_final_approval"
    created_at: str = Field(default_factory=utc_now_iso)

    @field_validator("acceptance_criteria")
    @classmethod
    def criterion_weights_must_total_100(cls, value: list[AcceptanceCriterion]) -> list[AcceptanceCriterion]:
        if not value:
            raise ValueError("at least one acceptance criterion is required")
        total = sum(item.weight for item in value)
        if total != 100:
            raise ValueError(f"acceptance criterion weights must total 100, got {total}")
        return value

    @field_validator("subtasks")
    @classmethod
    def subtasks_must_be_strictly_ordered(cls, value: list[Subtask]) -> list[Subtask]:
        if not value:
            raise ValueError("at least one subtask is required")
        orders = [item.order for item in value]
        if orders != list(range(1, len(value) + 1)):
            raise ValueError("subtasks must use contiguous order starting at 1")
        ids = [item.subtask_id for item in value]
        if len(set(ids)) != len(ids):
            raise ValueError("subtask ids must be unique")
        return value


class TaskRequest(StrictModel):
    objective: str = Field(min_length=8)
    task_type: str = "generic"
    business_domain: BusinessDomain = BusinessDomain.shared
    priority: Literal["P0", "P1", "P2"] = "P0"
    risk_level: RiskLevel = RiskLevel.medium
    automation_mode: AutomationMode = AutomationMode.supervised
    scope_included: list[str] = Field(default_factory=list)
    scope_excluded: list[str] = Field(default_factory=list)
    inputs: list[str] = Field(default_factory=list)
    constraints: list[str] = Field(default_factory=list)
    prohibited_actions: list[str] = Field(default_factory=list)
    payload: dict[str, Any] = Field(default_factory=dict)


class Deliverable(StrictModel):
    deliverable_id: str
    type: Literal["code", "document", "visual_action", "analysis", "report", "json"]
    content_location: str
    summary: str
    content: dict[str, Any] | list[Any] | str | None = None


class Evidence(StrictModel):
    evidence_id: str
    subtask_id: str
    type: Literal["screenshot", "log", "test", "file", "database_record", "structured_result"]
    location: str
    description: str
    sha256: str = ""


class CriterionSelfCheck(StrictModel):
    criterion_id: str
    status: Literal["met", "not_met", "uncertain"]
    evidence_ids: list[str] = Field(default_factory=list)


class ExecutorOutput(StrictModel):
    task_id: str
    attempt_number: int = Field(ge=1)
    execution_status: Literal["draft_completed", "partial", "failed"]
    completed_subtasks: list[str] = Field(default_factory=list)
    failed_subtasks: list[str] = Field(default_factory=list)
    deliverables: list[Deliverable] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    deviations: list[str] = Field(default_factory=list)
    known_limitations: list[str] = Field(default_factory=list)
    executor_self_check: list[CriterionSelfCheck] = Field(default_factory=list)
    executor_score: int = Field(default=0, ge=0, le=100)
    created_at: str = Field(default_factory=utc_now_iso)


class SupervisorIssue(StrictModel):
    issue_id: str
    criterion_id: str = ""
    severity: Literal["minor", "major", "critical"]
    location: str
    problem: str
    required_fix: str
    verification_method: str


class SupervisorOutput(StrictModel):
    task_id: str
    attempt_number: int = Field(ge=1)
    supervisor_decision: Decision
    supervisor_score: int = Field(ge=0, le=100)
    issues: list[SupervisorIssue] = Field(default_factory=list)
    scope_violation: bool = False
    missing_deliverables: list[str] = Field(default_factory=list)
    unauthorized_changes: list[str] = Field(default_factory=list)
    summary: str
    created_at: str = Field(default_factory=utc_now_iso)


class CriterionResult(StrictModel):
    criterion_id: str
    weight: int
    score: int = Field(ge=0)
    status: Literal["passed", "failed", "insufficient_evidence"]
    evidence_checked: list[str] = Field(default_factory=list)
    finding: str


class ValidatorOutput(StrictModel):
    task_id: str
    attempt_number: int = Field(ge=1)
    validation_score: int = Field(ge=0, le=100)
    minimum_required_score: int = Field(default=95, ge=95, le=100)
    validation_decision: Decision
    mandatory_criteria_passed: bool
    criteria_results: list[CriterionResult]
    blocking_failures: list[str] = Field(default_factory=list)
    validation_summary: str
    created_at: str = Field(default_factory=utc_now_iso)


class AuditorOutput(StrictModel):
    task_id: str
    audit_mode: Literal["blind"] = "blind"
    audit_score: int = Field(ge=0, le=100)
    audit_decision: Decision
    objective_alignment: int = Field(ge=0, le=100)
    completeness_score: int = Field(ge=0, le=100)
    reliability_score: int = Field(ge=0, le=100)
    safety_score: int = Field(ge=0, le=100)
    evidence_score: int = Field(ge=0, le=100)
    critical_findings: list[str] = Field(default_factory=list)
    rejection_reasons: list[str] = Field(default_factory=list)
    lock_recommendation: Literal["APPROVE_LOCK", "DENY_LOCK"]
    audit_summary: str
    created_at: str = Field(default_factory=utc_now_iso)


class ReworkItem(StrictModel):
    item_id: str
    location: str
    current_problem: str
    required_result: str
    verification_method: str


class ReworkOrder(StrictModel):
    rework_id: str
    task_id: str
    attempt_number: int
    rejected_by: Literal["supervisor", "validator", "auditor"]
    rejection_type: Literal["partial_fix", "full_rewrite"]
    rejection_reasons: list[str]
    required_modifications: list[ReworkItem]
    unchanged_scope: list[str] = Field(default_factory=list)
    prohibited_changes: list[str] = Field(default_factory=list)
    deadline_policy: Literal["immediate_next_execution"] = "immediate_next_execution"
    created_at: str = Field(default_factory=utc_now_iso)


class WorkflowLogEntry(StrictModel):
    sequence: int
    role: RoleName | Literal["system"]
    status: TaskStatus
    attempt: int
    decision: str = ""
    score: int | None = None
    started_at: str
    completed_at: str
    rejection_reasons: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    entry_hash: str = ""
    previous_hash: str = ""


class ResultLock(StrictModel):
    locked: bool
    locked_at: str
    result_version: str
    content_hash: str
    signature: str
    modifiable: bool = False
    lock_file: str


class FinalResult(StrictModel):
    task_id: str
    status: Literal["COMPLETED_AND_LOCKED", "HUMAN_INTERVENTION_REQUIRED"]
    summary: str
    deliverables: list[Deliverable] = Field(default_factory=list)
    evidence: list[Evidence] = Field(default_factory=list)
    usage_instructions: list[str] = Field(default_factory=list)
    known_limitations: list[str] = Field(default_factory=list)
    scores: dict[str, int] = Field(default_factory=dict)
    workflow_log: list[WorkflowLogEntry] = Field(default_factory=list)
    retry_count: int = 0
    lock: ResultLock | None = None


class TaskRecord(StrictModel):
    task_id: str
    request: TaskRequest
    status: TaskStatus = TaskStatus.created
    active_role: RoleName | None = None
    manifest: TaskManifest | None = None
    executor_outputs: list[ExecutorOutput] = Field(default_factory=list)
    supervisor_outputs: list[SupervisorOutput] = Field(default_factory=list)
    validator_outputs: list[ValidatorOutput] = Field(default_factory=list)
    auditor_outputs: list[AuditorOutput] = Field(default_factory=list)
    rework_orders: list[ReworkOrder] = Field(default_factory=list)
    workflow_log: list[WorkflowLogEntry] = Field(default_factory=list)
    retry_count: int = 0
    final_result: FinalResult | None = None
    created_at: str = Field(default_factory=utc_now_iso)
    updated_at: str = Field(default_factory=utc_now_iso)

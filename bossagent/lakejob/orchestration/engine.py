from __future__ import annotations

import statistics
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .executors import BusinessTaskExecutor
from .models import (
    Decision,
    FinalResult,
    ReworkOrder,
    RoleName,
    TaskRecord,
    TaskRequest,
    TaskStatus,
    WorkflowLogEntry,
    utc_now_iso,
)
from .roles import (
    AuditorRole,
    CommanderRole,
    DeterministicBlindAuditor,
    DeterministicCommander,
    DeterministicExecutor,
    DeterministicSupervisor,
    DeterministicValidator,
    ExecutorRole,
    SupervisorRole,
    ValidatorRole,
    build_rework_order,
    commander_score,
)
from .state_machine import active_role_for, transition
from .store import OrchestrationStore


class RoleIsolationError(RuntimeError):
    pass


@dataclass
class RoleSet:
    commander: CommanderRole
    executor: ExecutorRole
    supervisor: SupervisorRole
    validator: ValidatorRole
    auditor: AuditorRole


class SerialOrchestrationEngine:
    """Strict five-role serial orchestration engine.

    The engine persists every state change, enforces one active role, retries only
    through Executor, provides a blind context to Auditor, and locks approved
    results with a content hash and signature.
    """

    def __init__(
        self,
        *,
        store: OrchestrationStore | None = None,
        roles: RoleSet | None = None,
    ) -> None:
        self.store = store or OrchestrationStore()
        if roles is None:
            business_executor = BusinessTaskExecutor(self.store.base_dir / "evidence")
            roles = RoleSet(
                commander=DeterministicCommander(),
                executor=DeterministicExecutor(business_executor),
                supervisor=DeterministicSupervisor(),
                validator=DeterministicValidator(),
                auditor=DeterministicBlindAuditor(),
            )
        self.roles = roles

    def create_task(self, request: TaskRequest, *, task_id: str | None = None) -> TaskRecord:
        task_id = task_id or f"TASK-{uuid.uuid4().hex[:16]}"
        record = TaskRecord(task_id=task_id, request=request)
        self.store.save(record)
        self._system_log(record, TaskStatus.created, "task_created", metadata={"task_type": request.task_type})
        return record

    def create_and_run(self, request: TaskRequest) -> TaskRecord:
        record = self.create_task(request)
        return self.run(record.task_id)

    def run(self, task_id: str) -> TaskRecord:
        record = self.store.load(task_id)
        if record.status == TaskStatus.locked:
            return record
        if record.status == TaskStatus.human_intervention_required:
            return record
        if record.manifest is None:
            self._run_commander(record)
        while record.status not in {TaskStatus.locked, TaskStatus.human_intervention_required}:
            attempt_number = len(record.executor_outputs) + 1
            rework = record.rework_orders[-1] if record.rework_orders else None
            executor_output = self._run_executor(record, attempt_number, rework)
            supervisor_output = self._run_supervisor(record, executor_output)
            if supervisor_output.supervisor_decision != Decision.pass_:
                if not self._schedule_rework_from_supervisor(record, supervisor_output):
                    break
                continue
            validator_output = self._run_validator(record, executor_output)
            if validator_output.validation_decision != Decision.pass_ or validator_output.validation_score < 95:
                if not self._schedule_rework_from_validator(record, validator_output):
                    break
                continue
            auditor_output = self._run_auditor(record, executor_output)
            if auditor_output.audit_decision != Decision.pass_ or auditor_output.audit_score < 95:
                if not self._schedule_rework_from_auditor(record, auditor_output):
                    break
                continue
            self._approve_and_lock(record, executor_output)
        return self.store.load(task_id)

    def get(self, task_id: str) -> TaskRecord:
        return self.store.load(task_id)

    def list(self, limit: int = 50) -> list[TaskRecord]:
        return self.store.list_records(limit)

    def _run_commander(self, record: TaskRecord) -> None:
        started = self._enter_role(record, TaskStatus.commander_running, RoleName.commander)
        try:
            manifest = self.roles.commander.plan(record.task_id, record.request)
            score = commander_score(manifest)
            if score < 95:
                raise RuntimeError(f"commander manifest score {score} is below 95")
            record.manifest = manifest
            self._finish_role(
                record,
                TaskStatus.plan_ready,
                RoleName.commander,
                started,
                decision="PASS",
                score=score,
                metadata={"subtasks": len(manifest.subtasks), "criteria": len(manifest.acceptance_criteria)},
            )
        except Exception as exc:
            self._abort_role(record, RoleName.commander, started, str(exc))
            raise

    def _run_executor(self, record: TaskRecord, attempt: int, rework: ReworkOrder | None):
        assert record.manifest is not None
        started = self._enter_role(record, TaskStatus.executor_running, RoleName.executor)
        try:
            output = self.roles.executor.execute(
                record.manifest,
                record.request,
                attempt_number=attempt,
                rework_order=rework,
            )
            if output.task_id != record.task_id or output.attempt_number != attempt:
                raise RoleIsolationError("executor returned output for a different task or attempt")
            record.executor_outputs.append(output)
            self._finish_role(
                record,
                TaskStatus.draft_ready,
                RoleName.executor,
                started,
                decision="DRAFT_READY",
                score=output.executor_score,
                metadata={
                    "deliverables": len(output.deliverables),
                    "evidence": len(output.evidence),
                    "completed_subtasks": output.completed_subtasks,
                },
            )
            return output
        except Exception as exc:
            self._abort_role(record, RoleName.executor, started, str(exc))
            raise

    def _run_supervisor(self, record: TaskRecord, output):
        assert record.manifest is not None
        started = self._enter_role(record, TaskStatus.supervisor_running, RoleName.supervisor)
        try:
            review = self.roles.supervisor.review(record.manifest, output)
            record.supervisor_outputs.append(review)
            target = TaskStatus.supervisor_passed if review.supervisor_decision == Decision.pass_ else TaskStatus.supervisor_rejected
            self._finish_role(
                record,
                target,
                RoleName.supervisor,
                started,
                decision=review.supervisor_decision.value,
                score=review.supervisor_score,
                rejection_reasons=[item.problem for item in review.issues],
                metadata={"issues": len(review.issues)},
            )
            return review
        except Exception as exc:
            self._abort_role(record, RoleName.supervisor, started, str(exc))
            raise

    def _run_validator(self, record: TaskRecord, output):
        assert record.manifest is not None
        started = self._enter_role(record, TaskStatus.validator_running, RoleName.validator)
        try:
            validation = self.roles.validator.validate(record.manifest, output)
            record.validator_outputs.append(validation)
            passed = validation.validation_decision == Decision.pass_ and validation.validation_score >= 95
            target = TaskStatus.validation_passed if passed else TaskStatus.validation_rejected
            self._finish_role(
                record,
                target,
                RoleName.validator,
                started,
                decision=validation.validation_decision.value,
                score=validation.validation_score,
                rejection_reasons=validation.blocking_failures,
                metadata={"mandatory_criteria_passed": validation.mandatory_criteria_passed},
            )
            return validation
        except Exception as exc:
            self._abort_role(record, RoleName.validator, started, str(exc))
            raise

    def _run_auditor(self, record: TaskRecord, output):
        assert record.manifest is not None
        started = self._enter_role(record, TaskStatus.auditor_running, RoleName.auditor)
        try:
            # Deliberately pass no supervisor, validator, rework or previous audit context.
            audit = self.roles.auditor.blind_audit(
                task_id=record.task_id,
                final_objective=record.manifest.final_objective,
                acceptance_criteria=record.manifest.acceptance_criteria,
                output=output,
            )
            record.auditor_outputs.append(audit)
            passed = audit.audit_decision == Decision.pass_ and audit.audit_score >= 95
            target = TaskStatus.final_approved if passed else TaskStatus.auditor_rejected
            self._finish_role(
                record,
                target,
                RoleName.auditor,
                started,
                decision=audit.audit_decision.value,
                score=audit.audit_score,
                rejection_reasons=audit.rejection_reasons,
                metadata={"audit_mode": audit.audit_mode, "lock_recommendation": audit.lock_recommendation},
            )
            return audit
        except Exception as exc:
            self._abort_role(record, RoleName.auditor, started, str(exc))
            raise

    def _schedule_rework_from_supervisor(self, record: TaskRecord, output) -> bool:
        reasons = [item.problem for item in output.issues] or [output.summary]
        modifications = [
            (item.location, item.problem, item.required_fix, item.verification_method)
            for item in output.issues
        ] or [("executor_output", output.summary, "按监督结论修正", "重新监督")]
        return self._schedule_rework(
            record,
            rejected_by="supervisor",
            reasons=reasons,
            modifications=modifications,
            full_rewrite=output.supervisor_decision == Decision.rewrite,
        )

    def _schedule_rework_from_validator(self, record: TaskRecord, output) -> bool:
        reasons = output.blocking_failures or [output.validation_summary]
        modifications = [
            (
                f"acceptance_criteria.{item.criterion_id}",
                item.finding,
                "补齐该验收项的真实成果和证据",
                "合验员重新按权重评分",
            )
            for item in output.criteria_results
            if item.status != "passed"
        ] or [("validation", output.validation_summary, "达到95分并通过全部强制项", "重新量化验收")]
        return self._schedule_rework(
            record,
            rejected_by="validator",
            reasons=reasons,
            modifications=modifications,
        )

    def _schedule_rework_from_auditor(self, record: TaskRecord, output) -> bool:
        reasons = output.rejection_reasons or [output.audit_summary]
        modifications = [
            ("final_output", reason, "修正问题并提供可独立验证的最终成果", "重新进行独立盲审")
            for reason in reasons
        ]
        return self._schedule_rework(
            record,
            rejected_by="auditor",
            reasons=reasons,
            modifications=modifications,
        )

    def _schedule_rework(
        self,
        record: TaskRecord,
        *,
        rejected_by: str,
        reasons: list[str],
        modifications: list[tuple[str, str, str, str]],
        full_rewrite: bool = False,
    ) -> bool:
        assert record.manifest is not None
        if record.retry_count >= record.manifest.maximum_retry_count:
            self._terminate_for_human(record, reasons)
            return False
        record.retry_count += 1
        order = build_rework_order(
            task_id=record.task_id,
            attempt_number=len(record.executor_outputs) + 1,
            rejected_by=rejected_by,
            reasons=reasons,
            modifications=modifications,
            prohibited_changes=record.manifest.prohibited_actions,
            full_rewrite=full_rewrite,
        )
        record.rework_orders.append(order)
        record.status = transition(record.status, TaskStatus.rework_created)
        record.active_role = None
        self.store.save(record)
        self._system_log(
            record,
            TaskStatus.rework_created,
            "rework_created",
            attempt=order.attempt_number,
            rejection_reasons=reasons,
            metadata={"rejected_by": rejected_by, "retry_count": record.retry_count},
        )
        return True

    def _terminate_for_human(self, record: TaskRecord, reasons: list[str]) -> None:
        record.status = transition(record.status, TaskStatus.retry_limit_reached)
        self.store.save(record)
        self._system_log(record, TaskStatus.retry_limit_reached, "retry_limit_reached", rejection_reasons=reasons)
        record.status = transition(record.status, TaskStatus.terminated)
        self.store.save(record)
        self._system_log(record, TaskStatus.terminated, "automation_terminated", rejection_reasons=reasons)
        record.status = transition(record.status, TaskStatus.human_intervention_required)
        record.final_result = FinalResult(
            task_id=record.task_id,
            status="HUMAN_INTERVENTION_REQUIRED",
            summary="自动返工达到上限，任务已终止并等待人工介入。",
            deliverables=record.executor_outputs[-1].deliverables if record.executor_outputs else [],
            evidence=record.executor_outputs[-1].evidence if record.executor_outputs else [],
            known_limitations=reasons,
            scores=self._scores(record),
            workflow_log=record.workflow_log,
            retry_count=record.retry_count,
        )
        self.store.save(record)
        self._system_log(record, TaskStatus.human_intervention_required, "human_intervention_required", rejection_reasons=reasons)

    def _approve_and_lock(self, record: TaskRecord, output) -> None:
        assert record.manifest is not None
        if record.status != TaskStatus.final_approved:
            raise RoleIsolationError("result can only be locked after final approval")
        scores = self._scores(record)
        record.status = transition(record.status, TaskStatus.locked)
        record.active_role = None
        self.store.save(record)
        self._system_log(
            record,
            TaskStatus.locked,
            "COMPLETED_AND_LOCKED",
            score=scores.get("overall"),
            metadata={"lock_policy": record.manifest.lock_policy, "event": "result_lock_pending"},
        )
        final_result = FinalResult(
            task_id=record.task_id,
            status="COMPLETED_AND_LOCKED",
            summary=f"任务已通过五角色串行闭环，完成 {len(output.deliverables)} 项交付并永久锁定。",
            deliverables=output.deliverables,
            evidence=output.evidence,
            usage_instructions=[
                "通过 Web 控制台或 CLI 查看结构化结果和全流程日志。",
                "真实平台操作必须在用户明确授权和 SafetyGuard 通过后执行。",
                "需要修改时创建新任务或新版本，不覆盖已锁定结果。",
            ],
            known_limitations=output.known_limitations,
            scores=scores,
            workflow_log=record.workflow_log,
            retry_count=record.retry_count,
        )
        record.final_result = final_result
        self.store.save(record)
        lock = self.store.lock(record, final_result)
        record.final_result.lock = lock
        self.store.save(record)

    def _enter_role(self, record: TaskRecord, target_status: TaskStatus, role: RoleName) -> str:
        if record.active_role is not None:
            raise RoleIsolationError(f"role {record.active_role.value} is already active")
        expected = active_role_for(target_status)
        if expected != role:
            raise RoleIsolationError(f"status {target_status.value} does not belong to role {role.value}")
        record.status = transition(record.status, target_status)
        record.active_role = role
        started = utc_now_iso()
        self.store.save(record)
        return started

    def _finish_role(
        self,
        record: TaskRecord,
        target_status: TaskStatus,
        role: RoleName,
        started: str,
        *,
        decision: str,
        score: int | None,
        rejection_reasons: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        if record.active_role != role:
            raise RoleIsolationError(f"role {role.value} is not active")
        record.status = transition(record.status, target_status)
        record.active_role = None
        self._append_role_log(
            record,
            role=role,
            status=target_status,
            attempt=max(1, len(record.executor_outputs)),
            decision=decision,
            score=score,
            started_at=started,
            rejection_reasons=rejection_reasons or [],
            metadata=metadata or {},
        )
        self.store.save(record)

    def _abort_role(self, record: TaskRecord, role: RoleName, started: str, error: str) -> None:
        record.active_role = None
        record.status = TaskStatus.terminated
        self._append_role_log(
            record,
            role=role,
            status=TaskStatus.terminated,
            attempt=max(1, len(record.executor_outputs)),
            decision="ERROR",
            score=0,
            started_at=started,
            rejection_reasons=[error],
            metadata={"error": error},
        )
        self.store.save(record)

    def _append_role_log(
        self,
        record: TaskRecord,
        *,
        role: RoleName,
        status: TaskStatus,
        attempt: int,
        decision: str,
        score: int | None,
        started_at: str,
        rejection_reasons: list[str],
        metadata: dict[str, Any],
    ) -> None:
        entry = WorkflowLogEntry(
            sequence=len(record.workflow_log) + 1,
            role=role,
            status=status,
            attempt=attempt,
            decision=decision,
            score=score,
            started_at=started_at,
            completed_at=utc_now_iso(),
            rejection_reasons=rejection_reasons,
            metadata=metadata,
        )
        persisted = self.store.append_audit(record.task_id, entry.model_dump(mode="json"))
        entry.entry_hash = persisted["entry_hash"]
        entry.previous_hash = persisted["previous_hash"]
        record.workflow_log.append(entry)

    def _system_log(
        self,
        record: TaskRecord,
        status: TaskStatus,
        decision: str,
        *,
        attempt: int = 0,
        score: int | None = None,
        rejection_reasons: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> None:
        now = utc_now_iso()
        entry = WorkflowLogEntry(
            sequence=len(record.workflow_log) + 1,
            role="system",
            status=status,
            attempt=attempt,
            decision=decision,
            score=score,
            started_at=now,
            completed_at=now,
            rejection_reasons=rejection_reasons or [],
            metadata=metadata or {},
        )
        persisted = self.store.append_audit(record.task_id, entry.model_dump(mode="json"))
        entry.entry_hash = persisted["entry_hash"]
        entry.previous_hash = persisted["previous_hash"]
        record.workflow_log.append(entry)
        self.store.save(record)

    @staticmethod
    def _scores(record: TaskRecord) -> dict[str, int]:
        values: dict[str, int] = {}
        if record.manifest is not None:
            values["commander"] = commander_score(record.manifest)
        if record.executor_outputs:
            values["executor"] = record.executor_outputs[-1].executor_score
        if record.supervisor_outputs:
            values["supervisor"] = record.supervisor_outputs[-1].supervisor_score
        if record.validator_outputs:
            values["validator"] = record.validator_outputs[-1].validation_score
        if record.auditor_outputs:
            values["auditor"] = record.auditor_outputs[-1].audit_score
        numeric = list(values.values())
        values["overall"] = round(statistics.mean(numeric)) if numeric else 0
        return values

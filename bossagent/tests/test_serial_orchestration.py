from __future__ import annotations

from pathlib import Path

from lakejob.orchestration.engine import RoleSet, SerialOrchestrationEngine
from lakejob.orchestration.executors import BusinessTaskExecutor
from lakejob.orchestration.models import (
    AuditorOutput,
    Decision,
    SupervisorOutput,
    TaskRequest,
    TaskStatus,
)
from lakejob.orchestration.roles import (
    DeterministicBlindAuditor,
    DeterministicCommander,
    DeterministicExecutor,
    DeterministicSupervisor,
    DeterministicValidator,
)
from lakejob.orchestration.store import OrchestrationStore


def build_engine(tmp_path: Path, *, supervisor=None, auditor=None) -> SerialOrchestrationEngine:
    store = OrchestrationStore(tmp_path / "orchestration")
    executor = DeterministicExecutor(BusinessTaskExecutor(store.base_dir / "evidence"))
    return SerialOrchestrationEngine(
        store=store,
        roles=RoleSet(
            commander=DeterministicCommander(),
            executor=executor,
            supervisor=supervisor or DeterministicSupervisor(),
            validator=DeterministicValidator(),
            auditor=auditor or DeterministicBlindAuditor(),
        ),
    )


def request() -> TaskRequest:
    return TaskRequest(
        objective="完成双端视觉招聘智能体的五角色严格串行闭环验证",
        task_type="double_end_visual_agent",
        payload={"keyword": "AI视频设计师"},
    )


def test_five_roles_run_in_fixed_serial_order_and_lock(tmp_path: Path):
    engine = build_engine(tmp_path)
    record = engine.create_and_run(request())

    assert record.status == TaskStatus.locked
    role_order = [str(entry.role) for entry in record.workflow_log if str(entry.role) != "system"]
    assert role_order == ["commander", "executor", "supervisor", "validator", "auditor"]
    assert record.active_role is None
    assert record.retry_count == 0
    assert record.final_result is not None
    assert record.final_result.scores["overall"] >= 95
    assert record.final_result.lock is not None
    assert engine.store.verify_lock(record.task_id) is True
    assert engine.store.verify_audit_chain(record.task_id) is True


class RejectThreeTimesSupervisor:
    def __init__(self) -> None:
        self.calls = 0
        self.delegate = DeterministicSupervisor()

    def review(self, manifest, output):
        self.calls += 1
        if self.calls <= 3:
            return SupervisorOutput(
                task_id=manifest.task_id,
                attempt_number=output.attempt_number,
                supervisor_decision=Decision.reject,
                supervisor_score=80,
                issues=[],
                summary=f"第 {self.calls} 次要求返工",
            )
        return self.delegate.review(manifest, output)


def test_rejection_returns_to_executor_and_allows_three_automatic_retries(tmp_path: Path):
    supervisor = RejectThreeTimesSupervisor()
    engine = build_engine(tmp_path, supervisor=supervisor)
    record = engine.create_and_run(request())

    assert record.status == TaskStatus.locked
    assert record.retry_count == 3
    assert len(record.executor_outputs) == 4
    assert len(record.rework_orders) == 3
    assert [order.rejected_by for order in record.rework_orders] == ["supervisor"] * 3


class AlwaysRejectSupervisor:
    def review(self, manifest, output):
        return SupervisorOutput(
            task_id=manifest.task_id,
            attempt_number=output.attempt_number,
            supervisor_decision=Decision.reject,
            supervisor_score=50,
            issues=[],
            summary="持续不合格",
        )


def test_retry_limit_terminates_and_waits_for_human(tmp_path: Path):
    engine = build_engine(tmp_path, supervisor=AlwaysRejectSupervisor())
    record = engine.create_and_run(request())

    assert record.status == TaskStatus.human_intervention_required
    assert record.retry_count == 3
    assert len(record.executor_outputs) == 4
    assert record.final_result is not None
    assert record.final_result.status == "HUMAN_INTERVENTION_REQUIRED"
    assert record.final_result.lock is None


class BlindAuditSpy:
    def __init__(self) -> None:
        self.received = None

    def blind_audit(self, *, task_id, final_objective, acceptance_criteria, output):
        self.received = {
            "task_id": task_id,
            "final_objective": final_objective,
            "acceptance_criteria": acceptance_criteria,
            "output": output,
        }
        return AuditorOutput(
            task_id=task_id,
            audit_score=100,
            audit_decision=Decision.pass_,
            objective_alignment=100,
            completeness_score=100,
            reliability_score=100,
            safety_score=100,
            evidence_score=100,
            lock_recommendation="APPROVE_LOCK",
            audit_summary="blind pass",
        )


def test_auditor_receives_only_blind_context(tmp_path: Path):
    spy = BlindAuditSpy()
    engine = build_engine(tmp_path, auditor=spy)
    record = engine.create_and_run(request())

    assert record.status == TaskStatus.locked
    assert spy.received is not None
    assert set(spy.received) == {"task_id", "final_objective", "acceptance_criteria", "output"}
    assert "supervisor" not in spy.received
    assert "validator" not in spy.received
    assert "rework" not in spy.received


def test_locked_result_rejects_modified_content(tmp_path: Path):
    engine = build_engine(tmp_path)
    record = engine.create_and_run(request())
    assert record.final_result is not None
    record.final_result.summary = "tampered"

    try:
        engine.store.save(record)
    except PermissionError:
        pass
    else:
        raise AssertionError("modified locked result should be rejected")

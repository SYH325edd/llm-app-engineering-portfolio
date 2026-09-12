from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass
from typing import Any, Protocol

from .business_rules import FIXED_CONSTRAINTS, FIXED_PROHIBITED_ACTIONS
from .executors import BusinessTaskExecutor
from .models import (
    AcceptanceCriterion,
    AuditorOutput,
    CriterionResult,
    Decision,
    ExecutorOutput,
    ReworkItem,
    ReworkOrder,
    Subtask,
    SupervisorIssue,
    SupervisorOutput,
    TaskManifest,
    TaskRequest,
    TaskScope,
    ValidatorOutput,
)


class CommanderRole(Protocol):
    def plan(self, task_id: str, request: TaskRequest) -> TaskManifest: ...


class ExecutorRole(Protocol):
    def execute(
        self,
        manifest: TaskManifest,
        request: TaskRequest,
        *,
        attempt_number: int,
        rework_order: ReworkOrder | None,
    ) -> ExecutorOutput: ...


class SupervisorRole(Protocol):
    def review(self, manifest: TaskManifest, output: ExecutorOutput) -> SupervisorOutput: ...


class ValidatorRole(Protocol):
    def validate(self, manifest: TaskManifest, output: ExecutorOutput) -> ValidatorOutput: ...


class AuditorRole(Protocol):
    def blind_audit(
        self,
        *,
        task_id: str,
        final_objective: str,
        acceptance_criteria: list[AcceptanceCriterion],
        output: ExecutorOutput,
    ) -> AuditorOutput: ...


@dataclass
class DeterministicCommander:
    def plan(self, task_id: str, request: TaskRequest) -> TaskManifest:
        task_type = request.task_type
        if task_type == "double_end_visual_agent":
            subtasks = [
                Subtask(
                    subtask_id="ST-001",
                    order=1,
                    title="视觉执行核心闭环",
                    action="完成截图、定位、鼠标键盘动作、前后证据和结果验证",
                    output_format="visual_action_result_json",
                    evidence_required=["pre_snapshot", "post_snapshot", "verification"],
                    risk_level=request.risk_level,
                    completion_condition="视觉动作序列全部通过结果验证或在安全状态下暂停",
                ),
                Subtask(
                    subtask_id="ST-002",
                    order=2,
                    title="求职端闭环",
                    action="完成岗位匹配、排序和基于真实画像的话术草稿",
                    output_format="jobseeker_report_json",
                    evidence_required=["profile", "job_scores", "draft_messages"],
                    dependencies=["ST-001"],
                    risk_level=request.risk_level,
                    completion_condition="输出岗位推荐顺序且不自动发送或编造履历",
                ),
                Subtask(
                    subtask_id="ST-003",
                    order=3,
                    title="招聘端闭环",
                    action="完成候选人匹配、排序、追问和沟通草稿",
                    output_format="recruiter_report_json",
                    evidence_required=["job_profile", "candidate_scores", "draft_messages"],
                    dependencies=["ST-002"],
                    risk_level=request.risk_level,
                    completion_condition="输出候选人推荐顺序并保留重大决策人工复核",
                ),
                Subtask(
                    subtask_id="ST-004",
                    order=4,
                    title="双端系统整合",
                    action="整合五角色串行编排、视觉核心、双端业务和安全边界",
                    output_format="system_summary_json",
                    evidence_required=["workflow", "safety_boundary", "automation_modes"],
                    dependencies=["ST-001", "ST-002", "ST-003"],
                    risk_level=request.risk_level,
                    completion_condition="形成可运行、可审计、可锁定的本地闭环结果",
                ),
            ]
            criteria = [
                AcceptanceCriterion(
                    criterion_id="AC-001",
                    description="视觉执行链具备操作前后证据、动作执行和结果验证",
                    weight=20,
                    verification_method="检查视觉运行结果和证据文件",
                ),
                AcceptanceCriterion(
                    criterion_id="AC-002",
                    description="求职端完成岗位匹配排序与个性化沟通草稿",
                    weight=20,
                    verification_method="检查求职端结构化报告",
                ),
                AcceptanceCriterion(
                    criterion_id="AC-003",
                    description="招聘端完成候选人匹配排序与沟通草稿",
                    weight=20,
                    verification_method="检查招聘端结构化报告",
                ),
                AcceptanceCriterion(
                    criterion_id="AC-004",
                    description="五角色严格串行、驳回返工、95分门槛和盲审规则可执行",
                    weight=20,
                    verification_method="检查工作流日志、角色顺序和状态机",
                ),
                AcceptanceCriterion(
                    criterion_id="AC-005",
                    description="结果具备安全边界、审计证据、内容哈希和不可覆盖锁定",
                    weight=20,
                    verification_method="检查安全规则、审计链和结果锁",
                ),
            ]
        elif task_type == "visual_runtime_demo":
            subtasks = [
                Subtask(
                    subtask_id="ST-001",
                    order=1,
                    title="视觉运行验证",
                    action="执行安全视觉动作链并保存证据",
                    output_format="visual_action_result_json",
                    evidence_required=["pre_snapshot", "post_snapshot", "verification"],
                    completion_condition="全部动作通过验证",
                )
            ]
            criteria = [
                AcceptanceCriterion(
                    criterion_id="AC-001",
                    description="动作按计划执行并通过前后状态验证",
                    weight=50,
                ),
                AcceptanceCriterion(
                    criterion_id="AC-002",
                    description="证据完整且不绕过验证码或风控",
                    weight=50,
                ),
            ]
        elif task_type == "jobseeker_demo":
            subtasks = [
                Subtask(
                    subtask_id="ST-001",
                    order=1,
                    title="求职端分析",
                    action="完成岗位匹配、排序和话术草稿",
                    output_format="jobseeker_report_json",
                    evidence_required=["job_scores", "draft_messages"],
                    completion_condition="输出可审计求职结果",
                )
            ]
            criteria = [
                AcceptanceCriterion(
                    criterion_id="AC-001",
                    description="岗位评分和排序完整",
                    weight=50,
                ),
                AcceptanceCriterion(
                    criterion_id="AC-002",
                    description="话术基于真实画像且保持草稿状态",
                    weight=50,
                ),
            ]
        elif task_type == "recruiter_demo":
            subtasks = [
                Subtask(
                    subtask_id="ST-001",
                    order=1,
                    title="招聘端分析",
                    action="完成候选人匹配、排序和话术草稿",
                    output_format="recruiter_report_json",
                    evidence_required=["candidate_scores", "draft_messages"],
                    completion_condition="输出可审计招聘结果",
                )
            ]
            criteria = [
                AcceptanceCriterion(
                    criterion_id="AC-001",
                    description="候选人评分和排序完整",
                    weight=50,
                ),
                AcceptanceCriterion(
                    criterion_id="AC-002",
                    description="重大招聘决策保留人工复核",
                    weight=50,
                ),
            ]
        else:
            subtasks = [
                Subtask(
                    subtask_id="ST-001",
                    order=1,
                    title="执行结构化任务",
                    action="按照目标和约束生成可验证成果",
                    output_format="json",
                    evidence_required=["result_file"],
                    completion_condition="输出结果文件和证据",
                )
            ]
            criteria = [
                AcceptanceCriterion(
                    criterion_id="AC-001",
                    description="任务目标完整实现",
                    weight=60,
                ),
                AcceptanceCriterion(
                    criterion_id="AC-002",
                    description="成果具备证据、审计和安全边界",
                    weight=40,
                ),
            ]

        constraints = _dedupe(FIXED_CONSTRAINTS + request.constraints)
        prohibited = _dedupe(FIXED_PROHIBITED_ACTIONS + request.prohibited_actions)
        return TaskManifest(
            task_id=task_id,
            final_objective=request.objective,
            task_type=task_type,
            business_domain=request.business_domain,
            priority=request.priority,
            risk_level=request.risk_level,
            automation_mode=request.automation_mode,
            scope=TaskScope(
                included=request.scope_included or ["五角色串行编排", "本地安全执行", "结构化审计"],
                excluded=request.scope_excluded or ["验证码绕过", "高频批量操作", "自动重大招聘决策"],
            ),
            inputs=request.inputs,
            constraints=constraints,
            prohibited_actions=prohibited,
            acceptance_criteria=criteria,
            subtasks=subtasks,
        )


@dataclass
class DeterministicExecutor:
    business_executor: BusinessTaskExecutor

    def execute(
        self,
        manifest: TaskManifest,
        request: TaskRequest,
        *,
        attempt_number: int,
        rework_order: ReworkOrder | None,
    ) -> ExecutorOutput:
        instructions = []
        if rework_order is not None:
            instructions = [item.required_result for item in rework_order.required_modifications]
        return self.business_executor.execute(
            manifest,
            request,
            attempt_number=attempt_number,
            rework_instructions=instructions,
        )


@dataclass
class DeterministicSupervisor:
    def review(self, manifest: TaskManifest, output: ExecutorOutput) -> SupervisorOutput:
        issues: list[SupervisorIssue] = []
        expected_subtasks = [item.subtask_id for item in manifest.subtasks]
        if output.completed_subtasks != expected_subtasks:
            issues.append(
                SupervisorIssue(
                    issue_id="ISSUE-SUBTASK-ORDER",
                    severity="critical",
                    location="completed_subtasks",
                    problem="子任务未按总指挥清单完整且顺序执行",
                    required_fix=f"必须严格按顺序完成：{expected_subtasks}",
                    verification_method="比较 completed_subtasks 与任务清单",
                )
            )
        if output.execution_status != "draft_completed":
            issues.append(
                SupervisorIssue(
                    issue_id="ISSUE-EXECUTION-STATUS",
                    severity="major",
                    location="execution_status",
                    problem="执行结果不是完整草稿",
                    required_fix="完成全部强制子任务并输出 draft_completed",
                    verification_method="检查执行状态和失败任务",
                )
            )
        if not output.deliverables:
            issues.append(
                SupervisorIssue(
                    issue_id="ISSUE-NO-DELIVERABLE",
                    severity="critical",
                    location="deliverables",
                    problem="缺少交付成果",
                    required_fix="输出至少一个结构化交付成果",
                    verification_method="检查 deliverables 非空",
                )
            )
        if not output.evidence:
            issues.append(
                SupervisorIssue(
                    issue_id="ISSUE-NO-EVIDENCE",
                    severity="critical",
                    location="evidence",
                    problem="缺少执行证据",
                    required_fix="为强制子任务补充文件、测试或结构化结果证据",
                    verification_method="检查 evidence 非空且文件存在",
                )
            )
        if output.deviations:
            issues.append(
                SupervisorIssue(
                    issue_id="ISSUE-DEVIATION",
                    severity="major",
                    location="deviations",
                    problem="执行结果存在未批准偏差",
                    required_fix="消除偏差或严格回到原任务范围",
                    verification_method="检查 deviations 为空",
                )
            )
        score = max(0, 100 - sum(30 if item.severity == "critical" else 15 for item in issues))
        decision = Decision.pass_ if not issues else (Decision.rewrite if any(item.severity == "critical" for item in issues) else Decision.reject)
        return SupervisorOutput(
            task_id=manifest.task_id,
            attempt_number=output.attempt_number,
            supervisor_decision=decision,
            supervisor_score=score,
            issues=issues,
            scope_violation=bool(output.deviations),
            missing_deliverables=[] if output.deliverables else ["至少一个交付成果"],
            unauthorized_changes=list(output.deviations),
            summary="监督审核通过" if not issues else f"发现 {len(issues)} 个必须修改的问题",
        )


@dataclass
class DeterministicValidator:
    def validate(self, manifest: TaskManifest, output: ExecutorOutput) -> ValidatorOutput:
        evidence_ids = {item.evidence_id for item in output.evidence}
        self_checks = {item.criterion_id: item for item in output.executor_self_check}
        results: list[CriterionResult] = []
        blocking: list[str] = []
        total = 0
        for criterion in manifest.acceptance_criteria:
            check = self_checks.get(criterion.criterion_id)
            linked = [item for item in (check.evidence_ids if check else []) if item in evidence_ids]
            passed = bool(check and check.status == "met") and (bool(linked) or not criterion.evidence_required)
            score = criterion.weight if passed else 0
            total += score
            status = "passed" if passed else ("insufficient_evidence" if criterion.evidence_required and not linked else "failed")
            if criterion.mandatory and not passed:
                blocking.append(f"{criterion.criterion_id}: {criterion.description}")
            results.append(
                CriterionResult(
                    criterion_id=criterion.criterion_id,
                    weight=criterion.weight,
                    score=score,
                    status=status,
                    evidence_checked=linked,
                    finding="验收项通过" if passed else "验收项未通过或证据不足",
                )
            )
        mandatory_passed = not blocking
        decision = Decision.pass_ if total >= manifest.minimum_validation_score and mandatory_passed else Decision.reject
        return ValidatorOutput(
            task_id=manifest.task_id,
            attempt_number=output.attempt_number,
            validation_score=total,
            minimum_required_score=manifest.minimum_validation_score,
            validation_decision=decision,
            mandatory_criteria_passed=mandatory_passed,
            criteria_results=results,
            blocking_failures=blocking,
            validation_summary="量化验收通过" if decision == Decision.pass_ else "量化验收未达到95分或存在强制项失败",
        )


@dataclass
class DeterministicBlindAuditor:
    """Independent auditor. Its API intentionally excludes review history."""

    def blind_audit(
        self,
        *,
        task_id: str,
        final_objective: str,
        acceptance_criteria: list[AcceptanceCriterion],
        output: ExecutorOutput,
    ) -> AuditorOutput:
        objective_alignment = 100 if final_objective.strip() and output.deliverables else 0
        completeness = 100 if output.execution_status == "draft_completed" and not output.failed_subtasks else 60
        reliability = 100 if output.executor_score >= 95 and not output.deviations else 70
        safety_text = json.dumps(
            [item.content for item in output.deliverables], ensure_ascii=False, default=str
        ).lower()
        # Explicitly evaluate only observable outputs, never hidden review opinions.
        safety = 100
        critical: list[str] = []
        if any(marker in safety_text for marker in ("captcha_bypass\": true", "unlimited_bulk_actions\": true")):
            safety = 0
            critical.append("成果声明了被禁止的验证码绕过或无限批量操作")
        evidence_score = 100 if output.evidence and all(item.sha256 for item in output.evidence) else 70
        audit_score = round((objective_alignment + completeness + reliability + safety + evidence_score) / 5)
        rejection_reasons = list(critical)
        if audit_score < 95:
            rejection_reasons.append(f"终审评分 {audit_score} 低于95分")
        decision = Decision.pass_ if audit_score >= 95 and not critical else Decision.reject
        return AuditorOutput(
            task_id=task_id,
            audit_score=audit_score,
            audit_decision=decision,
            objective_alignment=objective_alignment,
            completeness_score=completeness,
            reliability_score=reliability,
            safety_score=safety,
            evidence_score=evidence_score,
            critical_findings=critical,
            rejection_reasons=rejection_reasons,
            lock_recommendation="APPROVE_LOCK" if decision == Decision.pass_ else "DENY_LOCK",
            audit_summary="独立盲审通过" if decision == Decision.pass_ else "独立盲审未通过",
        )


def build_rework_order(
    *,
    task_id: str,
    attempt_number: int,
    rejected_by: str,
    reasons: list[str],
    modifications: list[tuple[str, str, str, str]],
    prohibited_changes: list[str],
    full_rewrite: bool = False,
) -> ReworkOrder:
    items = [
        ReworkItem(
            item_id=f"FIX-{index:03d}",
            location=location,
            current_problem=problem,
            required_result=required,
            verification_method=verification,
        )
        for index, (location, problem, required, verification) in enumerate(modifications, start=1)
    ]
    return ReworkOrder(
        rework_id=f"RW-{uuid.uuid4().hex[:12]}",
        task_id=task_id,
        attempt_number=attempt_number,
        rejected_by=rejected_by,
        rejection_type="full_rewrite" if full_rewrite else "partial_fix",
        rejection_reasons=reasons,
        required_modifications=items,
        prohibited_changes=prohibited_changes,
    )


def commander_score(manifest: TaskManifest) -> int:
    score = 0
    if manifest.final_objective.strip():
        score += 25
    if manifest.subtasks and [item.order for item in manifest.subtasks] == list(range(1, len(manifest.subtasks) + 1)):
        score += 25
    if all(item.completion_condition for item in manifest.subtasks):
        score += 20
    if sum(item.weight for item in manifest.acceptance_criteria) == 100:
        score += 20
    if manifest.prohibited_actions:
        score += 10
    return score


def _dedupe(items: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        value = str(item).strip()
        if value and value not in seen:
            seen.add(value)
            result.append(value)
    return result

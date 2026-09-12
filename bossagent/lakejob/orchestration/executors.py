from __future__ import annotations

import hashlib
import json
import uuid
from pathlib import Path
from typing import Any, Callable

from lakejob.infrastructure.ai.mock_provider import MockAIProvider
from lakejob.infrastructure.vision.runtime import ActionType, SimulatedScreenDriver, VisualAction, VisualActionRunner
from lakejob.infrastructure.vision.runtime.models import BoundingBox

from .models import Deliverable, Evidence, ExecutorOutput, TaskManifest, TaskRequest


class BusinessTaskExecutor:
    """Execute LakeJob business tasks without performing uncontrolled real actions.

    The default handlers provide a complete local double-end workflow simulation.
    Real platform actions remain behind the existing SafetyGuard and supervised
    Browser Runtime. This executor never bypasses verification and never sends a
    real message or application by itself.
    """

    def __init__(self, evidence_root: Path | str) -> None:
        self.evidence_root = Path(evidence_root)
        self.handlers: dict[str, Callable[..., dict[str, Any]]] = {
            "generic": self._generic,
            "visual_runtime_demo": self._visual_runtime_demo,
            "jobseeker_demo": self._jobseeker_demo,
            "recruiter_demo": self._recruiter_demo,
            "double_end_visual_agent": self._double_end_visual_agent,
        }

    def execute(
        self,
        manifest: TaskManifest,
        request: TaskRequest,
        *,
        attempt_number: int,
        rework_instructions: list[str] | None = None,
    ) -> ExecutorOutput:
        handler = self.handlers.get(manifest.task_type, self._generic)
        result = handler(manifest, request, attempt_number, rework_instructions or [])
        deliverables = result["deliverables"]
        evidence = result["evidence"]
        completed = [subtask.subtask_id for subtask in manifest.subtasks]
        evidence_ids = [item.evidence_id for item in evidence]
        self_check = [
            {
                "criterion_id": criterion.criterion_id,
                "status": "met" if evidence_ids else "uncertain",
                "evidence_ids": evidence_ids,
            }
            for criterion in manifest.acceptance_criteria
        ]
        score = 100 if deliverables and evidence and len(completed) == len(manifest.subtasks) else 70
        return ExecutorOutput(
            task_id=manifest.task_id,
            attempt_number=attempt_number,
            execution_status="draft_completed" if score == 100 else "partial",
            completed_subtasks=completed,
            failed_subtasks=[],
            deliverables=deliverables,
            evidence=evidence,
            deviations=[],
            known_limitations=[
                "真实第三方平台仍必须由用户授权并在验证码或风控出现时人工接管。",
                "默认交付为本地闭环与安全视觉执行核心，真实批量发送和批量投递保持关闭。",
            ],
            executor_self_check=self_check,
            executor_score=score,
        )

    def _task_dir(self, task_id: str, attempt: int) -> Path:
        path = self.evidence_root / task_id / f"attempt-{attempt}"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @staticmethod
    def _write_json(path: Path, data: Any) -> str:
        text = json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True, default=str) + "\n"
        path.write_text(text, encoding="utf-8")
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def _evidence_for_file(self, *, path: Path, evidence_id: str, subtask_id: str, description: str) -> Evidence:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        return Evidence(
            evidence_id=evidence_id,
            subtask_id=subtask_id,
            type="file",
            location=str(path),
            description=description,
            sha256=digest,
        )

    def _generic(self, manifest: TaskManifest, request: TaskRequest, attempt: int, rework: list[str]) -> dict[str, Any]:
        task_dir = self._task_dir(manifest.task_id, attempt)
        payload = {
            "objective": manifest.final_objective,
            "task_type": manifest.task_type,
            "payload": request.payload,
            "rework_applied": rework,
            "subtasks": [item.model_dump(mode="json") for item in manifest.subtasks],
            "status": "completed_locally",
        }
        path = task_dir / "generic-result.json"
        self._write_json(path, payload)
        return {
            "deliverables": [
                Deliverable(
                    deliverable_id="D-GENERIC-001",
                    type="json",
                    content_location=str(path),
                    summary="结构化任务结果",
                    content=payload,
                )
            ],
            "evidence": [
                self._evidence_for_file(
                    path=path,
                    evidence_id="EV-GENERIC-001",
                    subtask_id=manifest.subtasks[0].subtask_id,
                    description="通用执行结果文件",
                )
            ],
        }

    def _visual_runtime_demo(self, manifest: TaskManifest, request: TaskRequest, attempt: int, rework: list[str]) -> dict[str, Any]:
        task_dir = self._task_dir(manifest.task_id, attempt)
        driver = SimulatedScreenDriver()
        runner = VisualActionRunner(driver, evidence_dir=task_dir / "visual", real_mode=False)
        keyword = str(request.payload.get("keyword") or "AI视觉设计")
        actions = [
            VisualAction(
                action_id="VA-001",
                action_type=ActionType.capture_screen,
                success_signals=["搜索"],
            ),
            VisualAction(
                action_id="VA-002",
                action_type=ActionType.click,
                target_text="搜索",
                target_bbox=BoundingBox(x=120, y=80, width=100, height=36),
                success_signals=["已点击"],
                max_retries=1,
            ),
            VisualAction(
                action_id="VA-003",
                action_type=ActionType.type_text,
                input_text=keyword,
                success_signals=[keyword, "岗位结果"],
                max_retries=1,
            ),
            VisualAction(
                action_id="VA-004",
                action_type=ActionType.press_key,
                key="Enter",
                success_signals=["搜索完成"],
                max_retries=1,
            ),
            VisualAction(
                action_id="VA-005",
                action_type=ActionType.scroll,
                scroll_delta=600,
                success_signals=["更多岗位"],
                max_retries=1,
            ),
            VisualAction(
                action_id="VA-006",
                action_type=ActionType.verify,
                success_signals=["岗位结果"],
            ),
        ]
        run_result = runner.run(actions)
        payload = run_result.model_dump(mode="json")
        payload["rework_applied"] = rework
        path = task_dir / "visual-runtime-result.json"
        self._write_json(path, payload)
        evidence = [
            self._evidence_for_file(
                path=path,
                evidence_id="EV-VISUAL-RESULT",
                subtask_id=self._subtask_id(manifest, 1),
                description="视觉动作执行、前后证据和验证结果",
            )
        ]
        for index, item in enumerate(run_result.evidence, start=1):
            for label, snapshot in (("pre", item.pre_snapshot), ("post", item.post_snapshot)):
                if snapshot and snapshot.screenshot_path:
                    snapshot_path = Path(snapshot.screenshot_path)
                    if snapshot_path.exists():
                        evidence.append(
                            self._evidence_for_file(
                                path=snapshot_path,
                                evidence_id=f"EV-VISUAL-{index:02d}-{label.upper()}",
                                subtask_id=self._subtask_id(manifest, 1),
                                description=f"动作 {item.action_id} 的{label}证据",
                            )
                        )
        return {
            "deliverables": [
                Deliverable(
                    deliverable_id="D-VISUAL-001",
                    type="visual_action",
                    content_location=str(path),
                    summary="视觉执行核心本地闭环结果",
                    content=payload,
                )
            ],
            "evidence": evidence,
        }

    def _jobseeker_demo(self, manifest: TaskManifest, request: TaskRequest, attempt: int, rework: list[str]) -> dict[str, Any]:
        task_dir = self._task_dir(manifest.task_id, attempt)
        provider = MockAIProvider()
        profile = request.payload.get("jobseeker_profile") or {
            "name": "Demo Jobseeker",
            "city": "杭州",
            "skills": ["视觉设计", "视频剪辑", "AI"],
            "salary": "8-15K",
        }
        jobs = request.payload.get("jobs") or [
            {
                "job_id": "demo-job-1",
                "title": "AI视频设计师",
                "company": "示例科技公司",
                "city": "杭州",
                "salary": "10-16K",
                "description": "负责AI视频、视觉设计和短视频剪辑",
            },
            {
                "job_id": "demo-job-2",
                "title": "平面设计师",
                "company": "示例品牌公司",
                "city": "上海",
                "salary": "7-12K",
                "description": "品牌视觉与平面物料设计",
            },
        ]
        recommendations = []
        for job in jobs:
            analysis = provider.analyze_job_match(job, profile)
            recommendations.append(
                {
                    "job": job,
                    "analysis": analysis,
                    "draft_message": provider.generate_jobseeker_message(job, profile, analysis),
                    "action_state": "draft_only",
                }
            )
        recommendations.sort(key=lambda item: float(item["analysis"]["score"]), reverse=True)
        payload = {
            "profile": profile,
            "recommendations": recommendations,
            "real_send": False,
            "real_apply": False,
            "rework_applied": rework,
        }
        path = task_dir / "jobseeker-result.json"
        self._write_json(path, payload)
        return {
            "deliverables": [
                Deliverable(
                    deliverable_id="D-JOBSEEKER-001",
                    type="report",
                    content_location=str(path),
                    summary="求职端岗位匹配、排序和个性化沟通草稿",
                    content=payload,
                )
            ],
            "evidence": [
                self._evidence_for_file(
                    path=path,
                    evidence_id="EV-JOBSEEKER-001",
                    subtask_id=self._subtask_id(manifest, 2),
                    description="求职端结构化分析结果",
                )
            ],
        }

    def _recruiter_demo(self, manifest: TaskManifest, request: TaskRequest, attempt: int, rework: list[str]) -> dict[str, Any]:
        task_dir = self._task_dir(manifest.task_id, attempt)
        provider = MockAIProvider()
        recruiter_profile = request.payload.get("recruiter_profile") or {
            "job_title": "AI视频设计师",
            "city": "杭州",
            "skills": ["AI", "视频剪辑", "视觉设计"],
            "experience": "1-3年",
        }
        candidates = request.payload.get("candidates") or [
            {
                "candidate_id": "demo-candidate-1",
                "name": "候选人A",
                "city": "杭州",
                "skills": ["AI", "视频剪辑", "视觉设计"],
                "experience": "2年",
            },
            {
                "candidate_id": "demo-candidate-2",
                "name": "候选人B",
                "city": "宁波",
                "skills": ["平面设计"],
                "experience": "1年",
            },
        ]
        recommendations = []
        for candidate in candidates:
            analysis = provider.analyze_candidate_match(candidate, recruiter_profile)
            recommendations.append(
                {
                    "candidate": candidate,
                    "analysis": analysis,
                    "draft_message": provider.generate_recruiter_message(candidate, recruiter_profile, analysis),
                    "pipeline_state": "matched",
                    "final_decision": "human_review_required",
                }
            )
        recommendations.sort(key=lambda item: float(item["analysis"]["score"]), reverse=True)
        payload = {
            "recruiter_profile": recruiter_profile,
            "recommendations": recommendations,
            "real_send": False,
            "automated_rejection": False,
            "rework_applied": rework,
        }
        path = task_dir / "recruiter-result.json"
        self._write_json(path, payload)
        return {
            "deliverables": [
                Deliverable(
                    deliverable_id="D-RECRUITER-001",
                    type="report",
                    content_location=str(path),
                    summary="招聘端候选人匹配、排序和沟通草稿",
                    content=payload,
                )
            ],
            "evidence": [
                self._evidence_for_file(
                    path=path,
                    evidence_id="EV-RECRUITER-001",
                    subtask_id=self._subtask_id(manifest, 3),
                    description="招聘端结构化分析结果",
                )
            ],
        }

    def _double_end_visual_agent(self, manifest: TaskManifest, request: TaskRequest, attempt: int, rework: list[str]) -> dict[str, Any]:
        visual = self._visual_runtime_demo(manifest, request, attempt, rework)
        jobseeker = self._jobseeker_demo(manifest, request, attempt, rework)
        recruiter = self._recruiter_demo(manifest, request, attempt, rework)
        task_dir = self._task_dir(manifest.task_id, attempt)
        system_summary = {
            "product": "LakeJob Double-End Visual Recruitment Agent",
            "workflow": ["visual_runtime", "jobseeker", "recruiter", "safety_guard", "five_role_review"],
            "automation_modes": ["assist", "supervised", "auto_with_pre_authorization"],
            "real_platform_boundary": {
                "captcha_bypass": False,
                "security_check_bypass": False,
                "credential_collection": False,
                "unlimited_bulk_actions": False,
                "human_review_for_sensitive_decisions": True,
            },
            "rework_applied": rework,
        }
        path = task_dir / "double-end-system-summary.json"
        self._write_json(path, system_summary)
        system_deliverable = Deliverable(
            deliverable_id="D-SYSTEM-001",
            type="document",
            content_location=str(path),
            summary="双端视觉招聘智能体闭环总览",
            content=system_summary,
        )
        system_evidence = self._evidence_for_file(
            path=path,
            evidence_id="EV-SYSTEM-001",
            subtask_id=self._subtask_id(manifest, 4),
            description="双端系统整合与安全边界",
        )
        return {
            "deliverables": visual["deliverables"] + jobseeker["deliverables"] + recruiter["deliverables"] + [system_deliverable],
            "evidence": visual["evidence"] + jobseeker["evidence"] + recruiter["evidence"] + [system_evidence],
        }

    @staticmethod
    def _subtask_id(manifest: TaskManifest, preferred_index: int) -> str:
        index = min(max(preferred_index - 1, 0), len(manifest.subtasks) - 1)
        return manifest.subtasks[index].subtask_id

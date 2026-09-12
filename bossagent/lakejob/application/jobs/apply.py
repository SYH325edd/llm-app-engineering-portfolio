"""JobRadar real-mode job application flow for BOSS."""

from __future__ import annotations

import argparse
import json
from typing import Any

from lakejob.infrastructure.platforms.boss import BossAdapter
from lakejob.safety.audit import record_audit
from lakejob.application.jobs.ai_message import generate_apply_message
from lakejob.infrastructure.database.jobs import (
    add_message,
    bootstrap_boss_account,
    create_application,
    create_conversation,
    get_job,
    log_event,
    set_application_status,
    set_message_status,
)
from lakejob.domain.platform_targets import platform_target_from_record
from lakejob.domain.schemas import ActionState
from lakejob.shared.logging import redact
from lakejob.safety.quota import consume_quota, current_context
from lakejob.safety.guard import guard_real_apply


STATUS_MAP = {
    "投递成功": ("submitted", "Applied"),
    "已投递过": ("submitted", "Applied"),
    "已沟通过": ("submitted", "Applied"),
    "application message sent": ("applied", "Applied"),
    "dry_run": ("draft", "DryRun"),
    "面试": ("responded", "Interview"),
    "拒绝": ("rejected", "Rejected"),
}


def _status_pair(result: dict[str, Any]) -> tuple[str, str]:
    if result.get("dry_run"):
        return "draft", "DryRun"
    if not result.get("success"):
        if result.get("state") == ActionState.pending_confirmation.value:
            return ActionState.pending_confirmation.value, "PendingConfirmation"
        if result.get("state") == ActionState.blocked_by_safety.value:
            return ActionState.blocked_by_safety.value, "BlockedBySafetyGuard"
        if result.get("state") == ActionState.blocked_by_quota.value:
            return ActionState.blocked_by_quota.value, "BlockedByQuotaPolicy"
        return ActionState.failed.value, "Failed"
    message = result.get("message", "")
    for key, value in STATUS_MAP.items():
        if key in message:
            return value
    return ActionState.applied.value, "Applied"


def apply_one_job(
    *,
    job_id: str | None = None,
    job_url: str | None = None,
    profile: dict[str, Any] | None = None,
    account_name: str = "default-jobseeker",
    dry_run: bool = False,
    confirm_phrase: str = "",
) -> dict[str, Any]:
    platform_id, account_id = bootstrap_boss_account(account_name)
    job = get_job(job_id=job_id, source_url=job_url)
    application_id = create_application(platform_id, account_id, str(job["id"]))
    message = generate_apply_message(job, profile or {})
    conversation_id = create_conversation(
        platform_id=platform_id,
        account_id=account_id,
        application_id=application_id,
        job_id=str(job["id"]),
        subject_type="application",
        subject_id=application_id,
        counterparty_name=job.get("company_name") or "",
        counterparty_role="hr",
    )
    message_status = ActionState.draft.value if dry_run else ActionState.pending_confirmation.value
    message_id = add_message(
        conversation_id=conversation_id,
        platform_id=platform_id,
        account_id=account_id,
        content=message,
        status=message_status,
        metadata={"source": "jobradar_apply_message", "job_id": str(job["id"]), "dry_run": dry_run},
    )

    adapter = None
    try:
        if dry_run:
            result = {"success": True, "dry_run": True, "state": "draft", "message": "dry_run"}
        else:
            if confirm_phrase != "APPLY_ONE_REAL_JOB":
                result = {"success": False, "blocked": True, "state": "pending_confirmation",
                          "message": "real apply confirmation phrase mismatch"}
            else:
                target = platform_target_from_record(job)
                try:
                    target.require("apply")
                except PermissionError as exc:
                    result = {"success": False, "blocked": True, "state": "blocked_by_safety",
                              "message": str(exc), "platform_target": target.model_dump(mode="json")}
            if 'result' in locals():
                pass
            else:
                result = None
        if not dry_run and result is None:
            quota_context = current_context(account_id=account_id)
            guard = guard_real_apply(platform_id=platform_id, account_id=account_id, job=job)
            if not guard.get("allowed"):
                result = {
                    "success": False,
                    "blocked": True,
                    "state": ActionState.blocked_by_safety.value,
                    "message": f"Safety Guard blocked real apply: {guard.get('reason')}",
                    "safety_guard": guard,
                }
            else:
                consumed = consume_quota(
                    "real_apply", context=quota_context,
                    idempotency_key=f"real_apply:{application_id}",
                    metadata={"job_id": str(job["id"]), "application_id": application_id},
                )
                if not consumed.get("allowed"):
                    result = {
                        "success": False, "blocked": True,
                        "state": ActionState.blocked_by_quota.value,
                        "message": consumed.get("error") or f"Quota blocked real apply: {consumed.get('reason')}",
                        "quota_policy": consumed,
                    }
                else:
                    adapter = BossAdapter(headless=False, allow_mock=False)
                    adapter.set_safety_context(account_id=account_id, source="jobradar_apply")
                    adapter.start()
                    set_application_status(application_id, ActionState.applying.value)
                    result = adapter.apply_to_job(job, message, dry_run=False)
                    result["state"] = ActionState.applied.value if result.get("success") else ActionState.failed.value
        core_status, jobradar_status = _status_pair(result)
        set_application_status(application_id, core_status)
        set_message_status(message_id, ActionState.sent.value if core_status == ActionState.applied.value else core_status)
        log_event(
            "JobRadar application attempted",
            level="info" if result.get("success") else "warning",
            platform_id=platform_id,
            account_id=account_id,
            conversation_id=conversation_id,
            entity_type="application",
            entity_id=application_id,
            payload={
                "job_id": str(job["id"]),
                "message_id": message_id,
                "message_preview": redact(message, max_length=80),
                "result": result,
                "jobradar_status": jobradar_status,
                "core_status": core_status,
                "dry_run": dry_run,
            },
        )
        if not result.get("success"):
            record_audit(
                "task.failed", target_type="application", target_id=application_id,
                outcome="blocked" if result.get("blocked") else "failure",
                metadata={"job_id": str(job["id"]), "result": result},
            )
        return {
            "job_id": str(job["id"]),
            "application_id": application_id,
            "conversation_id": conversation_id,
            "message_id": message_id,
            "status": jobradar_status,
            "dry_run": dry_run,
            "result": result,
        }
    finally:
        if adapter is not None:
            adapter.close()


def apply_jobs(
    *,
    job_ids: list[str] | None = None,
    job_urls: list[str] | None = None,
    profile: dict[str, Any] | None = None,
    account_name: str = "default-jobseeker",
    dry_run: bool = False,
    apply_limit: int = 1,
    confirm_phrase: str = "",
) -> list[dict[str, Any]]:
    targets: list[tuple[str, str]] = []
    targets.extend(("job_id", item) for item in (job_ids or []) if item)
    targets.extend(("job_url", item) for item in (job_urls or []) if item)
    results = []
    for kind, value in targets[: max(0, apply_limit)]:
        kwargs = {"job_id": value} if kind == "job_id" else {"job_url": value}
        results.append(
            apply_one_job(
                **kwargs,
                profile=profile,
                account_name=account_name,
                dry_run=dry_run,
                confirm_phrase=confirm_phrase,
            )
        )
    return results


def _profile_from_args(args) -> dict[str, Any]:
    return {
        "skills": [s.strip() for s in args.skills.split(",") if s.strip()],
        "experience": args.experience,
        "regions": args.regions,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="JobRadar BOSS real-mode apply")
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--job-id", action="append")
    target.add_argument("--job-url", action="append")
    parser.add_argument("--skills", default="")
    parser.add_argument("--experience", default="")
    parser.add_argument("--regions", default="")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--real", action="store_true")
    parser.add_argument("--confirm-apply", default="")
    parser.add_argument("--apply-limit", type=int, default=1)
    args = parser.parse_args()
    results = apply_jobs(
        job_ids=args.job_id,
        job_urls=args.job_url,
        profile=_profile_from_args(args),
        dry_run=args.dry_run or not args.real,
        apply_limit=args.apply_limit,
        confirm_phrase=args.confirm_apply,
    )
    print(json.dumps({"ok": True, "data": results}, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()

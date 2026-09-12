from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from jobradar_ai_msg import generate_apply_message, generate_message_smoke_message
from jobradar_log import (
    _one,
    add_match_score,
    add_message,
    bootstrap_boss_account,
    create_application,
    create_conversation,
    db_conn,
    log_event,
    set_application_status,
    upsert_job,
)
from quota_policy import consume_quota, current_context
from safety_guard import guard_real_apply, guard_real_message


TABLES = ("jobs", "candidates", "match_scores", "applications", "conversations", "messages", "logs")
CONFIRM_SEND_PHRASE = "I UNDERSTAND REAL BOSS MESSAGES WILL BE SENT"
MESSAGE_SMOKE_CONFIRM_PHRASE = "SEND_ONE_REAL_MESSAGE"
APPLY_SMOKE_CONFIRM_PHRASE = "APPLY_ONE_REAL_JOB"
DEBUG_HTML_PATH = Path("runtime") / "debug_job_search.html"
DEBUG_SCREENSHOT_PATH = Path("runtime") / "debug_job_search.png"
RUN_META: dict[str, Any] = {}


def _require_quota(action: str, account_id: str, **metadata: Any) -> dict[str, Any]:
    decision = consume_quota(
        action,
        context=current_context(account_id=account_id),
        metadata={"source": "run_real_mode_smoke_test", **metadata},
    )
    if not decision.get("allowed"):
        raise RuntimeError(decision.get("error") or f"Quota blocked {action}: {decision.get('reason')}")
    return decision


def _count_table(table: str) -> int:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(f"SELECT COUNT(*) AS count FROM {table}")
        row = _one(cur)
    return int(row["count"])


def _counts() -> dict[str, int]:
    return {table: _count_table(table) for table in TABLES}


def _delta(before: dict[str, int], after: dict[str, int], table: str) -> int:
    return after.get(table, 0) - before.get(table, 0)


def _positive_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be >= 0")
    return parsed


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Safe low-frequency Real Mode smoke test")
    parser.add_argument("--mode", choices=("jobradar", "recruitradar"), required=True)
    parser.add_argument("--keyword", required=True)
    parser.add_argument("--city", default="全国")
    parser.add_argument("--skills", default="")
    parser.add_argument("--real", action="store_true", help="Required to run against real BOSS mode")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--limit", type=_positive_int, default=1)
    parser.add_argument("--auto-apply", action="store_true", help="JobRadar only; defaults off")
    parser.add_argument("--auto-message", action="store_true", help="RecruitRadar only; defaults off")
    parser.add_argument("--apply-limit", type=_positive_int, default=1)
    parser.add_argument("--message-limit", type=_positive_int, default=0)
    parser.add_argument("--send-real", action="store_true", help="Allow real outbound BOSS message sending")
    parser.add_argument(
        "--confirm-send",
        default="",
        help=f"Must equal '{CONFIRM_SEND_PHRASE}', or '{MESSAGE_SMOKE_CONFIRM_PHRASE}' for --message-smoke",
    )
    parser.add_argument("--confirm-apply", default="", help=f"Must equal '{APPLY_SMOKE_CONFIRM_PHRASE}' for --apply-smoke")
    parser.add_argument("--reset-auth", action="store_true", help="Delete runtime/boss_auth_state.json before running")
    parser.add_argument(
        "--auth-only",
        action="store_true",
        help="Deprecated; use: python boss_auth_login.py --browser-type chromium",
    )
    parser.add_argument("--write-db-only", action="store_true", help="JobRadar only: search and write jobs/match_scores/logs")
    parser.add_argument("--dry-apply", action="store_true", help="JobRadar only: search and write full dry apply Core chain")
    parser.add_argument("--message-smoke", action="store_true", help="JobRadar only: send exactly one real BOSS job message")
    parser.add_argument("--apply-smoke", action="store_true", help="JobRadar only: apply to exactly one real BOSS job")
    return parser


def _validate_args(args: argparse.Namespace) -> None:
    if not args.real:
        raise SystemExit("Refusing to run: pass --real to confirm this is a real BOSS smoke test.")
    if args.limit > 1:
        raise SystemExit("Refusing to run: smoke test limit must be 0 or 1.")
    if args.apply_limit > 1:
        raise SystemExit("Refusing to run: smoke test apply-limit must be 0 or 1.")
    if args.message_limit > 1:
        raise SystemExit("Refusing to run: smoke test message-limit must be 0 or 1.")
    if args.apply_smoke:
        if args.mode != "jobradar":
            raise SystemExit("Refusing to run: --apply-smoke is JobRadar-only.")
        if not args.send_real:
            raise SystemExit("Refusing to run: --apply-smoke requires --send-real.")
        if args.confirm_apply != APPLY_SMOKE_CONFIRM_PHRASE:
            raise SystemExit(f"Refusing real apply smoke: --confirm-apply must equal '{APPLY_SMOKE_CONFIRM_PHRASE}'.")
        args.limit = 1
        args.apply_limit = 1
        args.message_limit = 0
        args.auto_apply = False
        args.auto_message = False
        args.dry_run = False
    elif args.message_smoke:
        if args.mode != "jobradar":
            raise SystemExit("Refusing to run: --message-smoke is JobRadar-only.")
        if not args.send_real:
            raise SystemExit("Refusing to run: --message-smoke requires --send-real.")
        if args.confirm_send != MESSAGE_SMOKE_CONFIRM_PHRASE:
            raise SystemExit(f"Refusing real message smoke: --confirm-send must equal '{MESSAGE_SMOKE_CONFIRM_PHRASE}'.")
        args.limit = 1
        args.message_limit = 1
        args.apply_limit = 0
        args.auto_apply = False
        args.auto_message = False
        args.dry_run = False
    elif args.send_real:
        if args.confirm_send != CONFIRM_SEND_PHRASE:
            raise SystemExit(f"Refusing real send: --confirm-send must equal '{CONFIRM_SEND_PHRASE}'.")
        args.dry_run = False
    else:
        args.dry_run = True
    if args.mode == "jobradar" and args.auto_message:
        raise SystemExit("Refusing to run: --auto-message is RecruitRadar-only.")
    if args.mode == "recruitradar" and args.auto_apply:
        raise SystemExit("Refusing to run: --auto-apply is JobRadar-only.")
    if args.write_db_only and args.mode != "jobradar":
        raise SystemExit("Refusing to run: --write-db-only is JobRadar-only.")
    if args.dry_apply and args.mode != "jobradar":
        raise SystemExit("Refusing to run: --dry-apply is JobRadar-only.")
    if args.message_smoke and (args.write_db_only or args.dry_apply):
        raise SystemExit("Refusing to run: --message-smoke cannot be combined with --write-db-only or --dry-apply.")
    if args.apply_smoke and (args.write_db_only or args.dry_apply or args.message_smoke):
        raise SystemExit("Refusing to run: --apply-smoke cannot be combined with --write-db-only, --dry-apply, or --message-smoke.")
    if args.write_db_only and args.dry_apply:
        raise SystemExit("Refusing to run: choose either --write-db-only or --dry-apply.")
    if args.write_db_only and args.send_real:
        raise SystemExit("Refusing to run: --write-db-only cannot be combined with --send-real.")
    if args.dry_apply and args.send_real:
        raise SystemExit("Refusing to run: --dry-apply cannot be combined with --send-real.")
    if args.write_db_only:
        args.limit = 1
        args.apply_limit = 0
        args.auto_apply = False
        args.dry_run = True
    if args.dry_apply:
        args.limit = 1
        args.apply_limit = 1
        args.auto_apply = False
        args.message_limit = 0
        args.dry_run = True
    if args.mode == "recruitradar" and args.auto_message and args.dry_run:
        print("RecruitRadar dry_run: suppressing real auto-message send; search and scoring only.", file=sys.stderr)
        args.message_limit = 0


def _jobradar_profile(args: argparse.Namespace) -> dict[str, Any]:
    return {
        "skills": [item.strip() for item in args.skills.split(",") if item.strip()],
        "regions": args.city,
    }


def _run_jobradar(args: argparse.Namespace) -> list[dict[str, Any]]:
    if args.apply_smoke:
        from adapters.boss import BossAdapter

        platform_id, account_id = bootstrap_boss_account("real-apply-smoke-test")
        adapter = BossAdapter(headless=False, allow_mock=False)
        adapter.set_safety_context(account_id=account_id, source="real_apply_smoke")
        parsed_jobs: list[dict[str, Any]] = []
        real_apply_sent = False
        apply_error = ""
        application_id = ""
        saved_job: dict[str, Any] | None = None
        result: dict[str, Any] = {}
        modal_handled = False
        boss_auto_sent_modal = False
        try:
            _require_quota("search", account_id, mode="apply_smoke", keyword=args.keyword)
            adapter.start()
            parsed_jobs = adapter.search_jobs(args.keyword, city=args.city, limit=1, allow_mock=False)
            if not parsed_jobs:
                raise RuntimeError("BOSS real search returned no jobs for apply smoke.")
            job = parsed_jobs[0]
            saved_job = upsert_job(platform_id, account_id, job)
            add_match_score(
                str(saved_job["id"]),
                100.0,
                score_type="rule",
                summary="Real apply smoke validation score",
                details={
                    "source": "run_real_mode_smoke_test.py",
                    "apply_smoke": True,
                    "keyword": args.keyword,
                    "city": args.city,
                },
            )
            guard = guard_real_apply(
                platform_id=platform_id,
                account_id=account_id,
                job=saved_job,
                smoke=True,
            )
            if not guard.get("allowed"):
                raise RuntimeError(f"Safety Guard blocked real apply: {guard.get('reason')}")
            _require_quota("real_apply", account_id, mode="apply_smoke", job_id=str(saved_job["id"]))
            application_id = create_application(platform_id, account_id, str(saved_job["id"]))
            apply_message = generate_apply_message(saved_job, _jobradar_profile(args))
            print("即将真实投递1个岗位")
            result = adapter.apply_to_job(saved_job, apply_message, dry_run=False)
            real_apply_sent = bool(result.get("success"))
            modal_handled = bool(result.get("modal_handled"))
            boss_auto_sent_modal = bool(result.get("real_message_sent") and result.get("reason") == "boss_auto_sent_message_modal")
            set_application_status(application_id, "submitted" if real_apply_sent else "pending")
            if not real_apply_sent:
                apply_error = result.get("message") or "real apply failed"
        except Exception as exc:
            apply_error = str(exc)
            if application_id:
                set_application_status(application_id, "pending")
        finally:
            adapter.close()

        first = parsed_jobs[0] if parsed_jobs else {}
        raw_data = first.get("raw_data") if isinstance(first.get("raw_data"), dict) else {}
        log_id = log_event(
            "JobRadar real apply smoke completed",
            level="info" if real_apply_sent else "warning",
            platform_id=platform_id,
            account_id=account_id,
            entity_type="application" if application_id else "job",
            entity_id=application_id or (str(saved_job["id"]) if saved_job else None),
            payload={
                "keyword": args.keyword,
                "city": args.city,
                "apply_smoke": True,
                "real_apply": True,
                "real_send": True,
                "real_apply_sent": real_apply_sent,
                "real_message_sent": bool(result.get("real_message_sent")),
                "boss_auto_sent_modal": boss_auto_sent_modal,
                "modal_handled": modal_handled,
                "limit": 1,
                "apply_limit": 1,
                "message_limit": 0,
                "job_id": str(saved_job["id"]) if saved_job else "",
                "application_id": application_id,
                "result": result,
                "error": apply_error,
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "debug_apply_html": str(Path("runtime") / "debug_apply.html"),
                "debug_apply_screenshot": str(Path("runtime") / "debug_apply.png"),
            },
        )
        print(f"[APPLY_SMOKE] apply_smoke=true")
        print(f"[APPLY_SMOKE] real_apply_sent={str(real_apply_sent).lower()}")
        print(f"[APPLY_SMOKE] boss_auto_sent_modal={str(boss_auto_sent_modal).lower()}")
        print(f"[APPLY_SMOKE] modal_handled={str(modal_handled).lower()}")
        print(f"[APPLY_SMOKE] job_id={str(saved_job['id']) if saved_job else ''}")
        print(f"[APPLY_SMOKE] application_id={application_id}")
        print(f"[APPLY_SMOKE] applications_written={1 if application_id else 0}")
        print(f"[APPLY_SMOKE] logs_written={1 if log_id else 0}")
        print(f"[APPLY_SMOKE] apply_smoke_error={apply_error}")

        RUN_META.clear()
        RUN_META.update(
            {
                "adapter_jobs_count": len(parsed_jobs),
                "jobs_parsed_count": len(parsed_jobs),
                "jobs_to_write": 1 if saved_job else 0,
                "first_job_title": first.get("title") or "",
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "jobs_written": 1 if saved_job else 0,
                "match_scores_written": 1 if saved_job else 0,
                "applications_written": 1 if application_id else 0,
                "conversations_written": 0,
                "messages_written": 0,
                "logs_written": 1 if log_id else 0,
                "real_messages_sent": bool(result.get("real_message_sent")),
                "apply_smoke": True,
                "real_send": True,
                "real_apply_sent": real_apply_sent,
                "boss_auto_sent_modal": boss_auto_sent_modal,
                "modal_handled": modal_handled,
                "job_id": str(saved_job["id"]) if saved_job else "",
                "application_id": application_id,
                "apply_smoke_error": apply_error,
            }
        )
        return [saved_job] if saved_job else []

    if args.message_smoke:
        from adapters.boss import BossAdapter

        platform_id, account_id = bootstrap_boss_account("real-message-smoke-test")
        adapter = BossAdapter(headless=False, allow_mock=False)
        adapter.set_safety_context(account_id=account_id, source="real_message_smoke")
        parsed_jobs: list[dict[str, Any]] = []
        sent = False
        send_error = ""
        message_id = ""
        conversation_id = ""
        saved_job: dict[str, Any] | None = None
        message = ""
        open_result: dict[str, Any] = {}
        boss_auto_sent_modal = False
        modal_handled = False
        try:
            _require_quota("search", account_id, mode="message_smoke", keyword=args.keyword)
            adapter.start()
            parsed_jobs = adapter.search_jobs(args.keyword, city=args.city, limit=1, allow_mock=False)
            if not parsed_jobs:
                raise RuntimeError("BOSS real search returned no jobs for message smoke.")
            job = parsed_jobs[0]
            saved_job = upsert_job(platform_id, account_id, job)
            add_match_score(
                str(saved_job["id"]),
                100.0,
                score_type="rule",
                summary="Real message smoke validation score",
                details={
                    "source": "run_real_mode_smoke_test.py",
                    "message_smoke": True,
                    "keyword": args.keyword,
                    "city": args.city,
                },
            )
            guard = guard_real_message(
                platform_id=platform_id,
                account_id=account_id,
                job=saved_job,
                smoke=True,
            )
            if not guard.get("allowed"):
                raise RuntimeError(f"Safety Guard blocked real message: {guard.get('reason')}")
            _require_quota("real_message", account_id, mode="message_smoke", job_id=str(saved_job["id"]))
            message = generate_message_smoke_message(saved_job, _jobradar_profile(args))
            conversation_id = create_conversation(
                platform_id=platform_id,
                account_id=account_id,
                application_id=None,
                job_id=str(saved_job["id"]),
                subject_type="job",
                subject_id=str(saved_job["id"]),
                counterparty_name=saved_job.get("company_name") or job.get("company") or "",
                counterparty_role="hr",
            )
            open_ok = False
            automation = getattr(adapter, "_automation", None)
            if automation is not None and hasattr(automation, "open_job_conversation"):
                open_result = automation.open_job_conversation({**job, "source_url": saved_job.get("source_url") or job.get("source_url")})
                open_ok = bool(open_result.get("opened"))
                modal_handled = bool(open_result.get("modal_handled"))
                boss_auto_sent_modal = bool(
                    open_result.get("real_message_sent") and open_result.get("reason") == "boss_auto_sent_message_modal"
                )
            if not open_ok:
                raise RuntimeError("failed to open BOSS job conversation")
            if open_result.get("real_message_sent"):
                sent = True
            else:
                print("即将真实发送1条消息")
                sent = bool(adapter.send_message({}, message))
        except Exception as exc:
            send_error = str(exc)
        finally:
            adapter.close()

        if saved_job is not None and conversation_id:
            message_id = add_message(
                conversation_id=conversation_id,
                platform_id=platform_id,
                account_id=account_id,
                content=message or generate_message_smoke_message(saved_job, _jobradar_profile(args)),
                sender_type="ai",
                sender_name="JobRadar AI",
                direction="outbound",
                status="sent" if sent else "failed",
                metadata={
                    "source": "run_real_mode_smoke_test.py",
                    "message_smoke": True,
                    "job_id": str(saved_job["id"]),
                    "real_send": sent,
                    "real_message_sent": sent,
                    "boss_auto_sent_modal": boss_auto_sent_modal,
                    "modal_handled": modal_handled,
                    "error": send_error,
                },
            )

        first = parsed_jobs[0] if parsed_jobs else {}
        raw_data = first.get("raw_data") if isinstance(first.get("raw_data"), dict) else {}
        log_id = log_event(
            "JobRadar real message smoke completed",
            level="info" if sent else "warning",
            platform_id=platform_id,
            account_id=account_id,
            conversation_id=conversation_id or None,
            entity_type="job",
            entity_id=str(saved_job["id"]) if saved_job else None,
            payload={
                "keyword": args.keyword,
                "city": args.city,
                "message_smoke": True,
                "limit": 1,
                "message_limit": 1,
                "real_send": sent,
                "real_message_sent": sent,
                "boss_auto_sent_modal": boss_auto_sent_modal,
                "modal_handled": modal_handled,
                "job_id": str(saved_job["id"]) if saved_job else "",
                "conversation_id": conversation_id,
                "message_id": message_id,
                "error": send_error,
                "applications_written": 0,
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "debug_html_path": str(DEBUG_HTML_PATH),
                "debug_screenshot_path": str(DEBUG_SCREENSHOT_PATH),
            },
        )
        print(f"[MESSAGE_SMOKE] jobs_parsed_count: {len(parsed_jobs)}")
        print(f"[MESSAGE_SMOKE] real_messages_sent: {str(sent).lower()}")
        print(f"[MESSAGE_SMOKE] boss_auto_sent_modal: {str(boss_auto_sent_modal).lower()}")
        print(f"[MESSAGE_SMOKE] modal_handled: {str(modal_handled).lower()}")
        print(f"[MESSAGE_SMOKE] job_id: {str(saved_job['id']) if saved_job else ''}")
        print(f"[MESSAGE_SMOKE] conversation_id: {conversation_id}")
        print(f"[MESSAGE_SMOKE] message_id: {message_id}")
        if send_error:
            print(f"[MESSAGE_SMOKE] error: {send_error}", file=sys.stderr)

        RUN_META.clear()
        RUN_META.update(
            {
                "adapter_jobs_count": len(parsed_jobs),
                "jobs_parsed_count": len(parsed_jobs),
                "jobs_to_write": 1 if saved_job else 0,
                "first_job_title": first.get("title") or "",
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "jobs_written": 1 if saved_job else 0,
                "match_scores_written": 1 if saved_job else 0,
                "applications_written": 0,
                "conversations_written": 1 if conversation_id else 0,
                "messages_written": 1 if message_id else 0,
                "logs_written": 1 if log_id else 0,
                "real_messages_sent": sent,
                "boss_auto_sent_modal": boss_auto_sent_modal,
                "modal_handled": modal_handled,
                "job_id": str(saved_job["id"]) if saved_job else "",
                "conversation_id": conversation_id,
                "message_id": message_id,
                "message_smoke_error": send_error,
            }
        )
        return [saved_job] if saved_job else []

    if args.dry_apply:
        from adapters.boss import BossAdapter

        platform_id, account_id = bootstrap_boss_account("real-mode-dry-apply-validation")
        adapter = BossAdapter(headless=False, allow_mock=False)
        adapter.set_safety_context(account_id=account_id, source="real_dry_apply")
        try:
            _require_quota("search", account_id, mode="dry_apply", keyword=args.keyword)
            adapter.start()
            parsed_jobs = adapter.search_jobs(args.keyword, city=args.city, limit=1000, allow_mock=False)
        finally:
            adapter.close()

        adapter_jobs_count = len(parsed_jobs)
        jobs_parsed_count = adapter_jobs_count
        if adapter_jobs_count == 0:
            print("Adapter returned empty jobs even though page parser parsed jobs.", file=sys.stderr)

        jobs_to_apply = parsed_jobs[:1]
        first_job_title = (jobs_to_apply[0].get("title") or "") if jobs_to_apply else ""
        print(f"[DRY_APPLY] adapter_jobs_count: {adapter_jobs_count}")
        print(f"[DRY_APPLY] jobs_parsed_count: {jobs_parsed_count}")
        print(f"[DRY_APPLY] jobs_to_apply: {len(jobs_to_apply)}")
        print(f"[DRY_APPLY] first_job_title: {first_job_title}")

        saved_jobs = []
        applications_written = 0
        conversations_written = 0
        messages_written = 0
        match_scores_written = 0
        dry_apply_records = []

        for job in jobs_to_apply:
            saved_job = upsert_job(platform_id, account_id, job)
            score = add_match_score(
                str(saved_job["id"]),
                100.0,
                score_type="rule",
                summary="Real mode dry apply validation score",
                details={
                    "source": "run_real_mode_smoke_test.py",
                    "dry_apply": True,
                    "keyword": args.keyword,
                    "city": args.city,
                },
            )
            match_scores_written += 1
            application_id = create_application(platform_id, account_id, str(saved_job["id"]))
            set_application_status(application_id, "draft")
            applications_written += 1
            conversation_id = create_conversation(
                platform_id=platform_id,
                account_id=account_id,
                application_id=application_id,
                job_id=str(saved_job["id"]),
                subject_type="application",
                subject_id=application_id,
                counterparty_name=saved_job.get("company_name") or job.get("company") or "",
                counterparty_role="hr",
            )
            conversations_written += 1
            apply_message = generate_apply_message(saved_job, _jobradar_profile(args))
            message_id = add_message(
                conversation_id=conversation_id,
                platform_id=platform_id,
                account_id=account_id,
                content=apply_message,
                sender_type="ai",
                sender_name="JobRadar AI",
                direction="outbound",
                status="draft",
                metadata={
                    "source": "run_real_mode_smoke_test.py",
                    "dry_apply": True,
                    "job_id": str(saved_job["id"]),
                    "application_id": application_id,
                    "real_send": False,
                },
            )
            messages_written += 1
            saved_jobs.append(saved_job)
            dry_apply_records.append(
                {
                    "job_id": str(saved_job["id"]),
                    "match_score_id": str(score["id"]),
                    "application_id": application_id,
                    "conversation_id": conversation_id,
                    "message_id": message_id,
                    "message": apply_message,
                }
            )

        first = parsed_jobs[0] if parsed_jobs else {}
        raw_data = first.get("raw_data") if isinstance(first.get("raw_data"), dict) else {}
        log_id = log_event(
            "JobRadar dry apply validation completed",
            platform_id=platform_id,
            account_id=account_id,
            conversation_id=dry_apply_records[0]["conversation_id"] if dry_apply_records else None,
            entity_type="application" if dry_apply_records else "job",
            entity_id=dry_apply_records[0]["application_id"] if dry_apply_records else None,
            payload={
                "keyword": args.keyword,
                "city": args.city,
                "dry_run": True,
                "dry_apply": True,
                "real_send": False,
                "adapter_jobs_count": adapter_jobs_count,
                "jobs_parsed_count": jobs_parsed_count,
                "jobs_to_apply": len(jobs_to_apply),
                "jobs_written": len(saved_jobs),
                "match_scores_written": match_scores_written,
                "applications_written": applications_written,
                "conversations_written": conversations_written,
                "messages_written": messages_written,
                "records": dry_apply_records,
                "first_job_title": first_job_title,
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "debug_html_path": str(DEBUG_HTML_PATH),
                "debug_screenshot_path": str(DEBUG_SCREENSHOT_PATH),
            },
        )
        RUN_META.clear()
        RUN_META.update(
            {
                "adapter_jobs_count": adapter_jobs_count,
                "jobs_parsed_count": jobs_parsed_count,
                "jobs_to_write": len(jobs_to_apply),
                "first_job_title": first_job_title,
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "jobs_written": len(saved_jobs),
                "match_scores_written": match_scores_written,
                "applications_written": applications_written,
                "conversations_written": conversations_written,
                "messages_written": messages_written,
                "logs_written": 1 if log_id else 0,
            }
        )
        return saved_jobs

    if args.write_db_only:
        from adapters.boss import BossAdapter

        platform_id, account_id = bootstrap_boss_account("real-mode-db-write-validation")
        adapter = BossAdapter(headless=False, allow_mock=False)
        adapter.set_safety_context(account_id=account_id, source="real_write_db")
        try:
            _require_quota("search", account_id, mode="write_db_only", keyword=args.keyword)
            adapter.start()
            parsed_jobs = adapter.search_jobs(args.keyword, city=args.city, limit=1000, allow_mock=False)
        finally:
            adapter.close()

        adapter_jobs_count = len(parsed_jobs)
        jobs_parsed_count = adapter_jobs_count
        if adapter_jobs_count == 0:
            print("Adapter returned empty jobs even though page parser parsed jobs.", file=sys.stderr)

        jobs_to_write = parsed_jobs[: args.limit]
        first_job_title = (jobs_to_write[0].get("title") or "") if jobs_to_write else ""
        print(f"[WRITE_DB_ONLY] adapter_jobs_count: {adapter_jobs_count}")
        print(f"[WRITE_DB_ONLY] jobs_parsed_count: {jobs_parsed_count}")
        print(f"[WRITE_DB_ONLY] jobs_to_write: {len(jobs_to_write)}")
        print(f"[WRITE_DB_ONLY] first_job_title: {first_job_title}")

        saved_jobs = []
        for job in jobs_to_write:
            saved_job = upsert_job(platform_id, account_id, job)
            add_match_score(
                str(saved_job["id"]),
                100.0,
                score_type="rule",
                summary="Real mode DB write validation score",
                details={
                    "source": "run_real_mode_smoke_test.py",
                    "write_db_only": True,
                    "keyword": args.keyword,
                    "city": args.city,
                },
            )
            saved_jobs.append(saved_job)

        first = parsed_jobs[0] if parsed_jobs else {}
        raw_data = first.get("raw_data") if isinstance(first.get("raw_data"), dict) else {}
        log_event(
            "JobRadar write-db-only validation completed",
            platform_id=platform_id,
            account_id=account_id,
            entity_type="job",
            payload={
                "keyword": args.keyword,
                "city": args.city,
                "dry_run": True,
                "write_db_only": True,
                "adapter_jobs_count": adapter_jobs_count,
                "jobs_parsed_count": jobs_parsed_count,
                "jobs_to_write": len(jobs_to_write),
                "jobs_written": len(saved_jobs),
                "match_scores_written": len(saved_jobs),
                "first_job_title": first_job_title,
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
                "debug_html_path": str(DEBUG_HTML_PATH),
                "debug_screenshot_path": str(DEBUG_SCREENSHOT_PATH),
            },
        )
        RUN_META.clear()
        RUN_META.update(
            {
                "adapter_jobs_count": adapter_jobs_count,
                "jobs_parsed_count": jobs_parsed_count,
                "jobs_to_write": len(jobs_to_write),
                "first_job_title": first_job_title,
                "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
            }
        )
        return saved_jobs

    if args.dry_run:
        from adapters.boss import BossAdapter

        _, account_id = bootstrap_boss_account("real-mode-dry-run-search")
        adapter = BossAdapter(headless=False, allow_mock=False)
        adapter.set_safety_context(account_id=account_id, source="real_search_dry_run")
        try:
            _require_quota("search", account_id, mode="dry_run", keyword=args.keyword)
            adapter.start()
            return adapter.search_jobs(args.keyword, city=args.city, limit=args.limit, allow_mock=False)
        finally:
            adapter.close()

    import jobradar_search

    return jobradar_search.search_jobs(
        args.keyword,
        city=args.city,
        skills=args.skills,
        regions=args.city,
        limit=args.limit,
        allow_mock=False,
        auto_apply=args.auto_apply,
        apply_limit=args.apply_limit,
        dry_run=args.dry_run,
    )


def _run_recruitradar(args: argparse.Namespace) -> list[dict[str, Any]]:
    import recruitradar_search

    return recruitradar_search.search_candidates(
        args.keyword,
        job_title=args.keyword,
        skills=args.skills,
        regions=args.city,
        limit=args.limit,
        auto_message=args.auto_message and not args.dry_run,
        message_limit=args.message_limit,
    )


def _summarize(args: argparse.Namespace, results: list[dict[str, Any]], before: dict[str, int], after: dict[str, int]) -> dict[str, Any]:
    first = results[0] if results else {}
    raw_data = first.get("raw_data") if isinstance(first.get("raw_data"), dict) else {}
    jobs_parsed_count = int(RUN_META.get("jobs_parsed_count", len(results) if args.mode == "jobradar" else 0))
    return {
        "mode": args.mode,
        "keyword": args.keyword,
        "city": args.city,
        "limit": args.limit,
        "dry_run": args.dry_run,
        "write_db_only": args.write_db_only,
        "dry_apply": args.dry_apply,
        "message_smoke": args.message_smoke,
        "apply_smoke": args.apply_smoke,
        "real_messages_sent": RUN_META.get("real_messages_sent", bool(args.send_real and not args.dry_run)),
        "real_apply_sent": RUN_META.get("real_apply_sent", False),
        "boss_auto_sent_modal": RUN_META.get("boss_auto_sent_modal", False),
        "modal_handled": RUN_META.get("modal_handled", False),
        "search_results": len(results),
        "jobs_parsed_count": jobs_parsed_count,
        "adapter_jobs_count": RUN_META.get("adapter_jobs_count", len(results) if args.mode == "jobradar" else 0),
        "jobs_to_write": RUN_META.get("jobs_to_write", len(results) if args.write_db_only else 0),
        "first_job_title": RUN_META.get("first_job_title", first.get("title") or ""),
        "jobs_written": RUN_META.get("jobs_written", len(results) if args.write_db_only else _delta(before, after, "jobs")),
        "candidates_written": _delta(before, after, "candidates"),
        "match_scores_written": RUN_META.get("match_scores_written", _delta(before, after, "match_scores")),
        "applications_written": RUN_META.get("applications_written", _delta(before, after, "applications")),
        "conversations_written": RUN_META.get("conversations_written", _delta(before, after, "conversations")),
        "messages_written": RUN_META.get("messages_written", _delta(before, after, "messages")),
        "logs_written": RUN_META.get("logs_written", _delta(before, after, "logs")),
        "job_id": RUN_META.get("job_id", str(first.get("id") or "")),
        "application_id": RUN_META.get("application_id", ""),
        "conversation_id": RUN_META.get("conversation_id", ""),
        "message_id": RUN_META.get("message_id", ""),
        "message_smoke_error": RUN_META.get("message_smoke_error", ""),
        "apply_smoke_error": RUN_META.get("apply_smoke_error", ""),
        "search_debug_url": RUN_META.get("search_debug_url") or first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
        "debug_html_path": str(DEBUG_HTML_PATH),
        "debug_screenshot_path": str(DEBUG_SCREENSHOT_PATH),
    }


def _print_search_parse_count(args: argparse.Namespace, results: list[dict[str, Any]]) -> None:
    if args.mode != "jobradar":
        return
    jobs_parsed_count = int(RUN_META.get("jobs_parsed_count", len(results)))
    prefix = "[APPLY_SMOKE]" if args.apply_smoke else ("[MESSAGE_SMOKE]" if args.message_smoke else ("[DRY_APPLY]" if args.dry_apply else ("[WRITE_DB_ONLY]" if args.write_db_only else ("[DRY_RUN]" if args.dry_run else "[REAL]"))))
    print(f"{prefix} jobs_parsed_count: {jobs_parsed_count}")


def _log_smoke_result(args: argparse.Namespace, results: list[dict[str, Any]]) -> None:
    if args.mode != "jobradar" or args.write_db_only or args.dry_apply or args.apply_smoke:
        return
    first = results[0] if results else {}
    raw_data = first.get("raw_data") if isinstance(first.get("raw_data"), dict) else {}
    platform_id, account_id = bootstrap_boss_account("real-mode-smoke-test")
    log_event(
        "JobRadar smoke test parsed jobs",
        platform_id=platform_id,
        account_id=account_id,
        entity_type="job",
        payload={
            "keyword": args.keyword,
            "city": args.city,
            "dry_run": args.dry_run,
            "jobs_parsed_count": len(results),
            "search_debug_url": first.get("search_debug_url") or raw_data.get("search_debug_url") or "",
            "debug_html_path": str(DEBUG_HTML_PATH),
            "debug_screenshot_path": str(DEBUG_SCREENSHOT_PATH),
        },
    )


def main() -> int:
    if "--auth-only" in sys.argv[1:]:
        print(
            "DEPRECATED: --auth-only has moved to the standalone auth script.\n"
            "Use: python boss_auth_login.py --browser-type chromium",
            file=sys.stderr,
        )
        return 2
    parser = _build_parser()
    args = parser.parse_args()
    _validate_args(args)

    if args.reset_auth:
        from adapters.boss import BossAdapter

        adapter = BossAdapter(headless=False, allow_mock=False)
        try:
            adapter.reset_auth_state()
        finally:
            adapter.close()

    before = _counts()
    if args.mode == "jobradar":
        results = _run_jobradar(args)
    else:
        results = _run_recruitradar(args)
    _print_search_parse_count(args, results)
    _log_smoke_result(args, results)
    after = _counts()

    summary = _summarize(args, results, before, after)
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""RecruitRadar MVP candidate search and filtering."""

from __future__ import annotations

import argparse
import json
from typing import Any

from lakejob.infrastructure.platforms.boss import BossAdapter
from lakejob.safety.audit import record_audit
from lakejob.application.messaging.draft import create_recruiter_message_draft
from lakejob.safety.quota import consume_quota, current_context
from lakejob.infrastructure.database.recruiting import bootstrap_boss_recruiter, log_event, upsert_candidate
from lakejob.application.recruiting.score import score_and_save
from lakejob.safety.guard import clamp_run_limit, guard_real_search


def _tokens(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip().lower() for item in value.replace("，", ",").split(",") if item.strip()]


def _candidate_text(candidate: dict[str, Any]) -> str:
    fields = (
        "name",
        "headline",
        "current_company",
        "current_title",
        "city",
        "location",
        "experience_text",
        "education_text",
        "resume_text",
    )
    values = [str(candidate.get(field) or "") for field in fields]
    values.extend(str(item) for item in candidate.get("skills") or [])
    return " ".join(values).lower()


def filter_candidates(
    candidates: list[dict[str, Any]],
    *,
    skills: str | None = None,
    regions: str | None = None,
    experience: str | None = None,
) -> list[dict[str, Any]]:
    skill_tokens = _tokens(skills)
    region_tokens = _tokens(regions)
    exp = (experience or "").strip().lower()
    filtered = []
    for candidate in candidates:
        text = _candidate_text(candidate)
        skill_ok = not skill_tokens or any(skill in text for skill in skill_tokens)
        region_ok = not region_tokens or any(region in text for region in region_tokens)
        exp_ok = not exp or exp in text
        if skill_ok and region_ok and exp_ok:
            filtered.append(candidate)
    return filtered


def search_candidates(
    keyword: str,
    *,
    job_title: str | None = None,
    skills: str | None = None,
    regions: str | None = None,
    experience: str | None = None,
    limit: int = 20,
    account_name: str = "default-recruiter",
    job_id: str | None = None,
    auto_message: bool = False,
    message_limit: int = 1,
    daily_limit: int | None = None,
    per_run_limit: int | None = None,
    real: bool = False,
    dry_run: bool = True,
    adapter_factory=BossAdapter,
) -> list[dict[str, Any]]:
    if not real:
        record_audit(
            "search.run", target_type="candidate", outcome="success",
            metadata={"query": keyword, "mode": "mock", "dry_run": True, "found": 0},
        )
        return []
    platform_id, account_id = bootstrap_boss_recruiter(account_name)
    limit = clamp_run_limit(limit)
    message_limit = clamp_run_limit(message_limit)
    query = keyword.strip()
    adapter = adapter_factory(headless=False, allow_mock=False)
    adapter.set_safety_context(account_id=account_id, source="recruitradar_search")
    try:
        quota_context = current_context(account_id=account_id)
        guard = guard_real_search(
            platform_id=platform_id, account_id=account_id, query=query, skip_delay=True
        )
        if not guard.get("allowed"):
            raise PermissionError(f"Safety Guard blocked real search: {guard.get('reason')}")
        consumed = consume_quota(
            "search", context=quota_context,
            metadata={"query": query, "source": "recruitradar_search"},
        )
        if not consumed.get("allowed"):
            raise PermissionError(consumed.get("error") or f"Quota blocked real search: {consumed.get('reason')}")
        adapter.start()
        raw_candidates = adapter.search_candidates(
            query,
            city=regions or "",
            limit=limit,
            daily_limit=daily_limit,
            per_run_limit=per_run_limit,
            dry_run=dry_run,
        )
        detailed_candidates = [adapter.get_candidate_detail(item) for item in raw_candidates]
        candidates = filter_candidates(
            detailed_candidates,
            skills=skills,
            regions=regions,
            experience=experience,
        )[:limit]
        saved = [upsert_candidate(platform_id, account_id, item) for item in candidates]
        requirements = {
            "keyword": keyword,
            "job_title": job_title,
            "skills": skills,
            "regions": regions,
            "experience": experience,
        }
        scored = score_and_save(saved, requirements, job_id=job_id)
        messages = []
        if auto_message:
            for item in scored[: max(0, message_limit)]:
                candidate_id = str(item["candidate"]["id"])
                messages.append(create_recruiter_message_draft(candidate_id, requirements))
        log_event(
            "RecruitRadar candidate search completed",
            level="info" if raw_candidates else "warning",
            platform_id=platform_id,
            account_id=account_id,
            entity_type="candidate",
            payload={
                "query": query,
                "found": len(raw_candidates),
                "saved": len(saved),
                "scored": len(scored),
                "drafts_generated": len(messages),
                "messages_attempted": 0,
                "adapter_capability": "search_candidates",
                "mode": "real",
                "vision_search": adapter.last_search_result is not None,
                "screenshot_path": ((adapter.last_search_result or {}).get("page_state") or {}).get(
                    "screenshot_path"
                ),
                "stored_candidate_ids": [str(item.get("id") or "") for item in saved],
            },
        )
        record_audit(
            "search.run", target_type="candidate", outcome="success",
            metadata={
                "query": query,
                "found": len(raw_candidates),
                "saved": len(saved),
                "stored_candidate_ids": [str(item.get("id") or "") for item in saved],
            },
        )
        message_by_candidate_id = {
            str(result.get("candidate_id") or result.get("target_id") or ""): result
            for result in messages if result.get("candidate_id") or result.get("target_id")
        }
        return [
            item["candidate"]
            | {
                "score": item["score"],
                "summary": item["summary"],
                "message_result": message_by_candidate_id.get(str(item["candidate"]["id"])),
            }
            for item in scored
        ]
    except Exception as exc:
        record_audit(
            "task.failed", target_type="search", outcome="failure",
            metadata={"query": query, "task": "recruitradar_search", "error": str(exc)[:500]},
        )
        raise
    finally:
        adapter.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="RecruitRadar MVP BOSS candidate search")
    parser.add_argument("keyword", nargs="?")
    parser.add_argument("--keyword", dest="keyword_option")
    parser.add_argument("--job-title", default="")
    parser.add_argument("--skills", default="")
    parser.add_argument("--regions", default="")
    parser.add_argument("--experience", default="")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--job-id")
    parser.add_argument("--auto-message", action="store_true")
    parser.add_argument("--message-limit", type=int, default=1)
    parser.add_argument("--daily-limit", type=int)
    parser.add_argument("--per-run-limit", type=int)
    parser.add_argument("--real", action="store_true", help="open the real platform in search-only mode")
    parser.add_argument("--dry-run", action="store_true", default=True)
    parser.add_argument("--allow-mock", action="store_true", help=argparse.SUPPRESS)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    keyword = args.keyword_option or args.keyword
    if not keyword:
        parser.error("keyword is required")
    candidates = search_candidates(
        keyword,
        job_title=args.job_title,
        skills=args.skills,
        regions=args.regions,
        experience=args.experience,
        limit=args.limit,
        job_id=args.job_id,
        auto_message=args.auto_message,
        message_limit=args.message_limit,
        daily_limit=args.daily_limit,
        per_run_limit=args.per_run_limit,
        real=args.real,
        dry_run=args.dry_run,
    )
    print(json.dumps({"ok": True, "candidates": candidates}, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()

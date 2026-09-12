"""JobRadar real-mode search, scoring, and optional apply flow for BOSS."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request
from typing import Any

from lakejob.infrastructure.platforms.boss import BossAdapter
from lakejob.application.jobs.apply import apply_jobs
from lakejob.infrastructure.database.jobs import add_match_score, bootstrap_boss_account, log_event, upsert_job
from lakejob.safety.audit import record_audit
from lakejob.safety.quota import consume_quota, current_context
from lakejob.safety.guard import clamp_run_limit, guard_real_search


def _tokens(value: str | None) -> list[str]:
    if not value:
        return []
    return [v.strip().lower() for v in value.replace("，", ",").split(",") if v.strip()]


def _job_text(job: dict[str, Any]) -> str:
    fields = (
        "title",
        "company",
        "company_name",
        "city",
        "salary",
        "salary_text",
        "experience",
        "experience_text",
        "education",
        "education_text",
        "description",
    )
    return " ".join(str(job.get(field) or "") for field in fields).lower()


def _match_region(job: dict[str, Any], regions: list[str]) -> bool:
    if not regions:
        return True
    text = f"{job.get('city', '')} {job.get('location', '')}".lower()
    return any(region in text for region in regions)


def _match_skills(job: dict[str, Any], skills: list[str]) -> bool:
    if not skills:
        return True
    text = _job_text(job)
    return any(skill in text for skill in skills)


def _match_experience(job: dict[str, Any], experience: str | None) -> bool:
    if not experience:
        return True
    text = _job_text(job)
    exp = experience.lower()
    return exp in text or "经验不限" in text or "不限" in text


def filter_jobs(
    jobs: list[dict[str, Any]],
    *,
    skills: str | None = None,
    experience: str | None = None,
    regions: str | None = None,
) -> list[dict[str, Any]]:
    skill_tokens = _tokens(skills)
    region_tokens = _tokens(regions)
    return [
        job
        for job in jobs
        if _match_skills(job, skill_tokens)
        and _match_region(job, region_tokens)
        and _match_experience(job, experience)
    ]


def _rule_score_job(job: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    text = _job_text(job)
    skills = _tokens(profile.get("skills"))
    regions = _tokens(profile.get("regions"))
    experience = str(profile.get("experience") or "").strip().lower()
    matched_skills = [skill for skill in skills if skill in text]
    skill_score = 70.0 if not skills else 70.0 * len(matched_skills) / len(skills)
    region_score = 15.0 if not regions or any(region in text for region in regions) else 0.0
    exp_score = 15.0 if not experience or experience in text or "不限" in text else 0.0
    score = round(skill_score + region_score + exp_score, 3)
    return {
        "score": score,
        "score_type": "rule",
        "summary": f"Matched {len(matched_skills)}/{len(skills)} skills",
        "details": {
            "matched_skills": matched_skills,
            "required_skills": skills,
            "region_matched": region_score > 0,
            "experience_matched": exp_score > 0,
        },
    }


def _ai_score_job(job: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any] | None:
    api_key = os.getenv("LAKEJOB_AI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None
    base_url = os.getenv("LAKEJOB_AI_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = os.getenv("LAKEJOB_AI_MODEL", "deepseek-chat")
    prompt = f"""
Score this BOSS job for a job seeker profile.

Return strict JSON only:
{{
  "score": 0-100 number,
  "summary": "one short sentence",
  "details": {{
    "matched_skills": [],
    "risks": [],
    "reason": "short reason"
  }}
}}

Profile:
{json.dumps(profile, ensure_ascii=False, default=str)}

Job:
{json.dumps(job, ensure_ascii=False, default=str)[:4500]}
""".strip()
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a strict job matching scorer for job seekers."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.2,
        "stream": False,
    }
    req = urllib.request.Request(
        f"{base_url}/chat/completions",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        content = body["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.strip("`")
            if content.lower().startswith("json"):
                content = content[4:].strip()
        data = json.loads(content)
        score = max(0.0, min(100.0, float(data.get("score", 0))))
        details = data.get("details") if isinstance(data.get("details"), dict) else {}
        details["ai_model"] = model
        return {
            "score": round(score, 3),
            "score_type": "ai",
            "summary": str(data.get("summary") or "AI job match score"),
            "details": details,
        }
    except (urllib.error.HTTPError, urllib.error.URLError, KeyError, ValueError, json.JSONDecodeError):
        return None


def score_job_ai_first(job: dict[str, Any], profile: dict[str, Any]) -> dict[str, Any]:
    return _ai_score_job(job, profile) or _rule_score_job(job, profile)


def _with_detail(adapter: BossAdapter, job: dict[str, Any], *, allow_mock: bool) -> dict[str, Any]:
    source_url = job.get("source_url") or job.get("url") or ""
    if not source_url or source_url.startswith(("mock://", "vision://")):
        return job
    try:
        detail = adapter.get_job_detail(source_url=source_url)
        return {**job, **detail, "source_url": source_url}
    except Exception:
        if not allow_mock:
            raise
        return job


def search_jobs(
    keyword: str,
    *,
    category: str | None = None,
    city: str = "全国",
    skills: str | None = None,
    experience: str | None = None,
    regions: str | None = None,
    limit: int = 20,
    account_name: str = "default-jobseeker",
    allow_mock: bool = False,
    auto_apply: bool = False,
    apply_limit: int = 1,
    dry_run: bool = False,
    daily_limit: int | None = None,
    per_run_limit: int | None = None,
) -> list[dict[str, Any]]:
    platform_id, account_id = bootstrap_boss_account(account_name)
    limit = clamp_run_limit(limit)
    apply_limit = clamp_run_limit(apply_limit)
    query = keyword.strip()
    profile = {
        "skills": skills or "",
        "experience": experience or "",
        "regions": regions or city or "",
    }
    adapter = BossAdapter(headless=False, allow_mock=allow_mock)
    adapter.set_safety_context(account_id=account_id, source="jobradar_search")
    try:
        quota_context = current_context(account_id=account_id)
        guard = guard_real_search(
            platform_id=platform_id, account_id=account_id, query=query, skip_delay=True
        )
        if not guard.get("allowed"):
            raise PermissionError(f"Safety Guard blocked real search: {guard.get('reason')}")
        consumed = consume_quota(
            "search", context=quota_context,
            metadata={"query": query, "source": "jobradar_search"},
        )
        if not consumed.get("allowed"):
            raise PermissionError(consumed.get("error") or f"Quota blocked real search: {consumed.get('reason')}")
        adapter.start()
        raw_jobs = adapter.search_jobs(
            query,
            city=city,
            limit=limit,
            allow_mock=allow_mock,
            daily_limit=daily_limit,
            per_run_limit=per_run_limit,
            dry_run=dry_run,
        )
        detailed_jobs = [_with_detail(adapter, job, allow_mock=allow_mock) for job in raw_jobs]
        jobs = filter_jobs(detailed_jobs, skills=skills, experience=experience, regions=regions)[:limit]
        saved = [upsert_job(platform_id, account_id, job) for job in jobs if job.get("source_url")]
        scored = []
        for saved_job in saved:
            score = score_job_ai_first(saved_job, profile)
            score_row = add_match_score(
                str(saved_job["id"]),
                score["score"],
                score_type=score["score_type"],
                summary=score["summary"],
                details=score["details"],
            )
            scored.append({**saved_job, "score": score["score"], "summary": score["summary"], "match_score": score_row})

        apply_results = []
        if auto_apply and scored:
            apply_results = apply_jobs(
                job_ids=[str(item["id"]) for item in scored],
                profile={"skills": _tokens(skills), "experience": experience or "", "regions": regions or city or ""},
                account_name=account_name,
                dry_run=dry_run,
                apply_limit=apply_limit,
            )

        apply_by_job_id = {str(result.get("job_id")): result for result in apply_results}
        log_event(
            "JobRadar real-mode search completed",
            platform_id=platform_id,
            account_id=account_id,
            entity_type="job",
            payload={
                "query": query,
                "city": city,
                "found": len(raw_jobs),
                "saved": len(saved),
                "scored": len(scored),
                "auto_apply": auto_apply,
                "apply_attempted": len(apply_results),
                "dry_run": dry_run,
                "allow_mock": allow_mock,
                "mode": "real" if not allow_mock else "real_or_mock",
                "vision_search": adapter.last_search_result is not None,
                "screenshot_path": ((adapter.last_search_result or {}).get("page_state") or {}).get(
                    "screenshot_path"
                ),
                "stored_job_ids": [str(item.get("id") or "") for item in saved],
            },
        )
        record_audit(
            "search.run", target_type="job", outcome="success",
            metadata={
                "query": query,
                "found": len(raw_jobs),
                "saved": len(saved),
                "stored_job_ids": [str(item.get("id") or "") for item in saved],
            },
        )
        return [
            item
            | {
                "apply_result": apply_by_job_id.get(str(item["id"])),
            }
            for item in scored
        ]
    except Exception as exc:
        record_audit(
            "task.failed", target_type="search", outcome="failure",
            metadata={"query": query, "task": "jobradar_search", "error": str(exc)[:500]},
        )
        raise
    finally:
        adapter.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="JobRadar BOSS real-mode job search")
    parser.add_argument("keyword")
    parser.add_argument("--category", default="")
    parser.add_argument("--city", default="全国")
    parser.add_argument("--skills", default="")
    parser.add_argument("--experience", default="")
    parser.add_argument("--regions", default="")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--auto-apply", action="store_true")
    parser.add_argument("--apply-limit", type=int, default=1)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-mock", action="store_true")
    parser.add_argument("--daily-limit", type=int)
    parser.add_argument("--per-run-limit", type=int)
    args = parser.parse_args()
    jobs = search_jobs(
        args.keyword,
        category=args.category,
        city=args.city,
        skills=args.skills,
        experience=args.experience,
        regions=args.regions,
        limit=args.limit,
        allow_mock=args.allow_mock,
        auto_apply=args.auto_apply,
        apply_limit=args.apply_limit,
        dry_run=args.dry_run,
        daily_limit=args.daily_limit,
        per_run_limit=args.per_run_limit,
    )
    print(json.dumps({"ok": True, "jobs": jobs}, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()

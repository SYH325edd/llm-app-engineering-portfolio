"""Job Flow orchestration for Web Console.

The flow is search-only. It never sends messages and never applies to jobs.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any
from uuid import uuid4

from profile_center import load_jobseeker_profile, profile_to_candidate_context


MAX_LIMIT = 5


def clamp_limit(value: Any) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 1
    return max(1, min(MAX_LIMIT, parsed))


def split_tokens(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return [item.strip() for item in str(value or "").replace("，", ",").split(",") if item.strip()]


def load_jobseeker_profile_for_flow() -> dict[str, Any]:
    return load_jobseeker_profile()


def build_user_profile(profile: dict[str, Any]) -> dict[str, Any]:
    context = profile_to_candidate_context(profile)
    return {
        "profile_name": context.get("profile_name", ""),
        "name": context.get("name", ""),
        "target_job_title": context.get("target_job_title", ""),
        "target_city": context.get("target_city", ""),
        "expected_salary": context.get("expected_salary", ""),
        "education": context.get("education", ""),
        "skills": ",".join(context.get("skills") or []),
        "project_experience": context.get("project_experience", ""),
        "work_experience": context.get("work_experience", ""),
        "regions": context.get("target_city", ""),
        "experience": context.get("work_experience", ""),
    }


def grade_job(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    return "C"


def mock_jobs(keyword: str, *, city: str = "", skills: str = "", limit: int = 1, run_id: str | None = None) -> list[dict[str, Any]]:
    safe_limit = clamp_limit(limit)
    skill_items = split_tokens(skills) or split_tokens(keyword) or ["Python", "FastAPI"]
    city_name = city or "杭州"
    run_key = run_id or uuid4().hex[:12]
    jobs = []
    for index in range(safe_limit):
        digest = hashlib.sha1(f"{keyword}-{city_name}-{skills}-{run_key}-{index}".encode("utf-8")).hexdigest()[:12]
        title = keyword or "AI应用开发工程师"
        company = ["LakeJob Mock Studio", "AI Video Lab", "Local Ops Tech", "PromptWorks", "FastAPI Cloud"][index % 5]
        jobs.append(
            {
                "external_job_id": f"job-flow-mock-{digest}",
                "platform_job_id": f"job-flow-mock-{digest}",
                "source_url": f"mock://job-flow/{digest}",
                "url": f"mock://job-flow/{digest}",
                "title": title,
                "company": company,
                "company_name": company,
                "city": city_name,
                "salary": "10-20K",
                "salary_text": "10-20K",
                "experience": "1-3年",
                "experience_text": "1-3年",
                "education": "本科",
                "education_text": "本科",
                "description": f"{title} 岗位，要求熟悉 {', '.join(skill_items)}，参与产品和内容流程建设。",
                "raw_payload": {
                    "source": "job_flow_mock",
                    "job_flow": True,
                    "run_id": run_key,
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                },
            }
        )
    return jobs


def bootstrap_job_account(account_name: str = "job-flow-web") -> tuple[str, str]:
    from jobradar_log import bootstrap_boss_account

    return bootstrap_boss_account(account_name)


def save_job(platform_id: str, account_id: str, job: dict[str, Any]) -> dict[str, Any]:
    from jobradar_log import upsert_job

    payload = dict(job)
    raw_payload = payload.get("raw_payload") if isinstance(payload.get("raw_payload"), dict) else {}
    payload["source"] = raw_payload.get("source") or payload.get("source") or "job_flow"
    payload["raw_payload"] = {**raw_payload, "source": payload["source"], "job_flow": True}
    return upsert_job(platform_id, account_id, payload)


def score_job_for_flow(job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
    from match_analysis import analyze_job_match

    return analyze_job_match(job, user_profile)


def save_match_score(job_id: str, score: dict[str, Any]) -> dict[str, Any]:
    from jobradar_log import add_match_score

    score_type = str(score.get("score_type") or "rule")
    if score_type not in {"manual", "rule", "ai", "hybrid"}:
        score_type = "rule"
    return add_match_score(
        job_id,
        score["score"],
        score_type=score_type,
        summary="; ".join(score.get("reasons") or []) or score.get("summary", ""),
        details=score.get("details") or {},
    )


def log_job_flow(payload: dict[str, Any], *, success: bool = True, error: str = "") -> None:
    try:
        from jobradar_log import log_event

        log_event(
            "Job Flow job search",
            level="info" if success else "warning",
            log_type="task",
            entity_type="job",
            payload={
                "job_flow": True,
                "action": "run_job_search",
                "success": success,
                "error": error,
                **payload,
            },
        )
    except Exception as exc:
        print(f"WARN: failed to write job flow log: {exc}")


def log_job_analysis(job_id: str, analysis: dict[str, Any]) -> str | None:
    from match_analysis import log_match_analysis

    return log_match_analysis("job", job_id, analysis)


def _search_real_jobs(keyword: str, *, city: str, skills: str, limit: int) -> list[dict[str, Any]]:
    from jobradar_search import search_jobs

    return search_jobs(
        keyword,
        city=city,
        skills=skills,
        regions=city,
        limit=limit,
        allow_mock=False,
        auto_apply=False,
        apply_limit=0,
        dry_run=True,
        account_name="job-flow-web",
    )


def _rows_from_saved_jobs(jobs: list[dict[str, Any]], user_profile: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for job in jobs:
        score_value = float(job.get("score") or 0)
        analysis = score_job_for_flow(job, user_profile)
        if not analysis.get("score"):
            analysis["score"] = score_value
        grade = str(analysis.get("level") or grade_job(score_value))
        analysis_log_id = log_job_analysis(str(job.get("id") or ""), analysis) if job.get("id") else None
        rows.append(
            {
                "job": job,
                "score": float(analysis.get("score") or score_value),
                "grade": grade,
                "analysis": analysis,
                "analysis_log_id": analysis_log_id,
                "source": (job.get("raw_data") or {}).get("source") or job.get("source") or "jobradar",
                "match_score": job.get("match_score"),
            }
        )
    return rows


def run_job_flow(
    *,
    keyword: str,
    city: str = "",
    skills: str = "",
    limit: int = 1,
    mode: str = "mock",
    dry_run: bool = True,
) -> dict[str, Any]:
    safe_limit = clamp_limit(limit)
    safe_mode = "real" if mode == "real" else "mock"
    profile = load_jobseeker_profile_for_flow()
    user_profile = build_user_profile(profile)
    query = (keyword or user_profile.get("target_job_title") or "Python").strip()
    search_city = city or str(user_profile.get("target_city") or "")
    search_skills = skills or str(user_profile.get("skills") or "")
    safe_dry_run = True

    payload_base = {
        "profile_name": profile.get("profile_name", ""),
        "keyword": query,
        "city": search_city,
        "skills": search_skills,
        "limit": safe_limit,
        "mode": safe_mode,
        "dry_run": safe_dry_run,
        "real_apply": False,
        "real_message": False,
    }
    try:
        if safe_mode == "real":
            real_jobs = _search_real_jobs(query, city=search_city, skills=search_skills, limit=safe_limit)
            rows = _rows_from_saved_jobs(real_jobs[:safe_limit], user_profile)
            jobs_found = len(real_jobs)
            jobs_saved = len(rows)
        else:
            jobs = mock_jobs(query, city=search_city, skills=search_skills, limit=safe_limit)
            platform_id, account_id = bootstrap_job_account()
            rows = []
            for job in jobs[:safe_limit]:
                saved = save_job(platform_id, account_id, job)
                analysis = score_job_for_flow(saved, user_profile)
                match_score = save_match_score(str(saved["id"]), analysis)
                analysis_log_id = log_job_analysis(str(saved["id"]), analysis)
                score_value = float(analysis["score"])
                rows.append(
                    {
                        "job": saved,
                        "score": score_value,
                        "grade": str(analysis.get("level") or grade_job(score_value)),
                        "analysis": analysis,
                        "analysis_log_id": analysis_log_id,
                        "source": (job.get("raw_payload") or {}).get("source") or "job_flow_mock",
                        "match_score": match_score,
                    }
                )
            jobs_found = len(jobs)
            jobs_saved = len(rows)

        grade_counts = {"A": 0, "B": 0, "C": 0}
        for row in rows:
            grade_counts[row["grade"]] += 1
        summary = {
            **payload_base,
            "jobs_found": jobs_found,
            "jobs_saved": jobs_saved,
            "grade_counts": grade_counts,
        }
        log_job_flow(summary, success=True)
        return {"ok": True, "summary": summary, "jobs": rows, "profile": profile, "user_profile": user_profile}
    except Exception as exc:
        log_job_flow({**payload_base, "jobs_found": 0, "jobs_saved": 0}, success=False, error=str(exc))
        raise

"""Recruit Flow orchestration for Web Console.

The flow is intentionally search-only. It never sends real messages or applies
to jobs.
"""

from __future__ import annotations

import hashlib
from datetime import datetime
from typing import Any
from uuid import uuid4

from lakejob.application.profiles.center import load_recruiter_profile, profile_to_job_context


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


def load_recruit_profile() -> dict[str, Any]:
    return load_recruiter_profile()


def build_job_profile(profile: dict[str, Any]) -> dict[str, Any]:
    return profile_to_job_context(profile)


def grade_candidate(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    return "C"


def mock_candidates(
    keyword: str,
    *,
    city: str = "",
    skills: str = "",
    limit: int = 1,
    run_id: str | None = None,
) -> list[dict[str, Any]]:
    limit = clamp_limit(limit)
    skill_items = split_tokens(skills) or split_tokens(keyword) or ["Python", "FastAPI"]
    city_name = city or "杭州"
    run_key = run_id or uuid4().hex[:12]
    result = []
    for index in range(limit):
        digest = hashlib.sha1(f"{keyword}-{city_name}-{skills}-{run_key}-{index}".encode("utf-8")).hexdigest()[:12]
        name = ["张三", "李四", "王五", "赵六", "陈七"][index % 5]
        result.append(
            {
                "external_candidate_id": f"recruit-flow-mock-{digest}",
                "source_url": f"mock://recruit-flow/{digest}",
                "name": name,
                "headline": f"{keyword or '候选人'} 方向候选人",
                "current_company": "Mock Talent Studio",
                "current_title": keyword or "后端开发工程师",
                "city": city_name,
                "location": city_name,
                "experience_text": "3年",
                "education_text": "本科",
                "skills": skill_items,
                "resume_text": f"{name} 熟悉 {', '.join(skill_items)}，有招聘流程 mock 验证数据经验。",
                "raw_payload": {
                    "source": "recruit_flow_mock",
                    "recruit_flow": True,
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                },
            }
        )
    return result


def score_candidate_for_flow(candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
    from lakejob.application.matching.analysis import analyze_candidate_match

    return analyze_candidate_match(candidate, job_profile)


def bootstrap_recruit_account(account_name: str = "recruit-flow-web") -> tuple[str, str]:
    from lakejob.infrastructure.database.recruiting import bootstrap_boss_recruiter

    return bootstrap_boss_recruiter(account_name)


def save_candidate(platform_id: str, account_id: str, candidate: dict[str, Any]) -> dict[str, Any]:
    from lakejob.infrastructure.database.recruiting import upsert_candidate

    payload = dict(candidate)
    raw_payload = payload.get("raw_payload") if isinstance(payload.get("raw_payload"), dict) else {}
    source = raw_payload.get("source") or payload.get("source") or "recruit_flow"
    payload["source"] = source
    payload["raw_payload"] = {**raw_payload, "source": source, "recruit_flow": True}
    return upsert_candidate(platform_id, account_id, payload)


def save_match_score(candidate_id: str, score: dict[str, Any]) -> dict[str, Any]:
    from lakejob.infrastructure.database.recruiting import add_match_score

    score_type = str(score.get("score_type") or "rule")
    if score_type not in {"manual", "rule", "ai", "hybrid"}:
        score_type = "rule"
    return add_match_score(
        candidate_id,
        score["score"],
        score_type=score_type,
        summary="; ".join(score.get("reasons") or []) or score.get("summary", ""),
        details=score.get("details") or {},
    )


def set_talent_status(candidate_id: str, status: str = "matched") -> None:
    from lakejob.application.recruiting.talent_pool import update_candidate_status

    update_candidate_status(candidate_id, status)


def log_candidate_analysis(candidate_id: str, analysis: dict[str, Any]) -> str | None:
    from lakejob.application.matching.analysis import log_match_analysis

    return log_match_analysis("candidate", candidate_id, analysis)


def log_recruit_flow(payload: dict[str, Any], *, success: bool = True, error: str = "") -> None:
    try:
        from lakejob.infrastructure.database.recruiting import log_event

        log_event(
            "Recruit Flow candidate search",
            level="info" if success else "warning",
            log_type="task",
            entity_type="candidate",
            payload={
                "recruit_flow": True,
                "action": "run_candidate_search",
                "success": success,
                "error": error,
                **payload,
            },
        )
    except Exception as exc:
        print(f"WARN: failed to write recruit flow log: {exc}")


def _search_real_candidates(keyword: str, *, city: str, skills: str, limit: int) -> list[dict[str, Any]]:
    from lakejob.application.recruiting.search import search_candidates

    return search_candidates(
        keyword,
        skills=skills,
        regions=city,
        limit=limit,
        auto_message=False,
        message_limit=0,
        account_name="recruit-flow-web",
    )


def run_recruit_flow(
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
    profile = load_recruit_profile()
    job_profile = build_job_profile(profile)
    query = (keyword or job_profile.get("title") or "Python").strip()
    search_city = city or str(job_profile.get("city") or "")
    search_skills = skills or ",".join(job_profile.get("skills") or [])

    payload_base = {
        "profile_name": profile.get("profile_name", ""),
        "keyword": query,
        "city": search_city,
        "skills": search_skills,
        "limit": safe_limit,
        "mode": safe_mode,
        "dry_run": bool(dry_run),
        "real_message": False,
        "real_apply": False,
    }
    try:
        if safe_mode == "real":
            candidates = _search_real_candidates(query, city=search_city, skills=search_skills, limit=safe_limit)
        else:
            candidates = mock_candidates(query, city=search_city, skills=search_skills, limit=safe_limit)

        platform_id, account_id = bootstrap_recruit_account()
        rows = []
        grade_counts = {"A": 0, "B": 0, "C": 0}
        for candidate in candidates[:safe_limit]:
            saved = save_candidate(platform_id, account_id, candidate)
            analysis = score_candidate_for_flow(saved, job_profile)
            match_score = save_match_score(str(saved["id"]), analysis)
            analysis_log_id = log_candidate_analysis(str(saved["id"]), analysis)
            set_talent_status(str(saved["id"]), "matched")
            score_value = float(analysis["score"])
            grade = str(analysis.get("level") or grade_candidate(score_value))
            grade_counts[grade] += 1
            rows.append(
                {
                    "candidate": saved,
                    "score": score_value,
                    "grade": grade,
                    "analysis": analysis,
                    "analysis_log_id": analysis_log_id,
                    "source": (candidate.get("raw_payload") or {}).get("source") or candidate.get("source") or "recruit_flow",
                    "status": "matched",
                    "match_score": match_score,
                }
            )

        summary = {
            **payload_base,
            "candidates_found": len(candidates),
            "candidates_saved": len(rows),
            "grade_counts": grade_counts,
        }
        log_recruit_flow(summary, success=True)
        return {"ok": True, "summary": summary, "candidates": rows, "profile": profile, "job_profile": job_profile}
    except Exception as exc:
        log_recruit_flow({**payload_base, "candidates_found": 0, "candidates_saved": 0}, success=False, error=str(exc))
        raise

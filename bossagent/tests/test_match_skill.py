"""Offline tests for explainable resume/JD matching."""

from __future__ import annotations

from skills.match.ats_score import calculate_ats_score
from skills.match.keyword_gap import keyword_gap
from skills.match.resume_jd_matcher import match_resume_to_jd
from skills.match.match_skill import MatchSkill


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def fixtures():
    resume = {
        "current_title": "Python Backend Engineer",
        "city": "Shanghai",
        "skills": ["Python", "FastAPI", "PostgreSQL"],
        "experience_text": "4 years",
        "education_text": "Bachelor",
        "resume_text": "Built Python FastAPI services with PostgreSQL and Docker.",
    }
    job = {
        "title": "Python Backend Engineer",
        "city": "Shanghai",
        "skills": ["Python", "FastAPI", "Redis", "Docker"],
        "experience_requirement": "3 years",
        "education_requirement": "Bachelor",
        "description": "Python FastAPI Redis Docker",
    }
    return resume, job


def test_keyword_gap_uses_resume_evidence() -> None:
    resume, job = fixtures()
    result = keyword_gap(job, resume)
    assert_true(result["coverage"] == 75.0, "keyword coverage should be explainable")
    assert_true(result["matched_keywords"] == ["python", "fastapi", "docker"], "matched keywords invalid")
    assert_true(result["missing_keywords"] == ["redis"], "missing keyword invalid")
    assert_true("redis" not in result["resume_keywords"], "missing skill must not be invented")


def test_ats_score_has_weighted_subscores() -> None:
    resume, job = fixtures()
    result = calculate_ats_score(resume, job)
    expected = {
        "keyword_coverage",
        "title_alignment",
        "experience_fit",
        "education_fit",
        "location_fit",
        "resume_completeness",
    }
    assert_true(set(result["subscores"]) == expected, "ATS subscores incomplete")
    assert_true(len(result["explain"]) == len(expected), "each subscore should be explained")


def test_matcher_changes_perspective_not_evidence() -> None:
    resume, job = fixtures()
    recruiter = match_resume_to_jd(resume, job, perspective="recruiter")
    jobseeker = match_resume_to_jd(resume, job, perspective="jobseeker")
    assert_true(recruiter["score"] == jobseeker["score"], "evidence score should be consistent")
    assert_true("candidate" in recruiter["suggested_action"], "HR action should target candidate")
    assert_true("job" in jobseeker["suggested_action"], "jobseeker action should target job")
    assert_true("redis" in recruiter["missing_keywords"], "missing evidence should remain visible")


def test_unknown_candidate_is_neutral_and_low_confidence() -> None:
    candidate = {
        "name": "Unknown Candidate",
        "skills": None,
        "resume_text": None,
        "experience_text": "unknown",
        "education_text": None,
    }
    job = {
        "title": "Python Engineer",
        "skills": ["Python", "FastAPI", "Redis"],
        "experience_requirement": "5 years",
        "education_requirement": "Bachelor",
    }
    result = match_resume_to_jd(candidate, job, perspective="recruiter")
    assert_true(result["confidence"] == "low", "unknown candidate must have low confidence")
    assert_true(result["score"] >= 50, "unknown evidence must not receive a severe negative score")
    assert_true(result["strengths"] == [], "unknown evidence must not create strengths")
    assert_true("候选人详情不足，评分置信度较低" in result["risks"], "low confidence risk missing")

    ai_result = MatchSkill().analyze(
        resume=candidate,
        job=job,
        perspective="recruiter",
        ai_provider="deepseek",
        provider_call=lambda: {
            "score": 5,
            "strengths": ["invented advantage"],
            "risks": [],
        },
    )
    assert_true(ai_result["score"] >= 50, "low-evidence AI score must fallback to neutral rules")
    assert_true(ai_result["fallback_used"] is True, "low-evidence AI result must be marked fallback")
    assert_true(ai_result["strengths"] == [], "low-evidence AI strengths must be discarded")


def test_ai_result_is_used() -> None:
    resume, job = fixtures()
    ai_result = {
        "score": 91,
        "level": "A",
        "reasons": ["AI used supplied evidence"],
        "strengths": ["Python evidence"],
        "risks": ["Redis needs verification"],
        "suggested_action": "manual review",
        "tags": ["python"],
    }
    result = MatchSkill().analyze(
        resume=resume,
        job=job,
        perspective="recruiter",
        ai_provider="deepseek",
        provider_call=lambda: ai_result,
    )
    assert_true(result["score"] == 91, "AI score must be used")
    assert_true(result["explain"] == ["AI used supplied evidence"], "AI reasons must be used")
    assert_true(result["fallback_used"] is False, "valid AI result must not fallback")
    assert_true(result["score_type"] == "ai", "valid AI result must be marked ai")


def test_unreliable_ai_falls_back() -> None:
    resume, job = fixtures()
    result = MatchSkill().analyze(
        resume=resume,
        job=job,
        perspective="recruiter",
        ai_provider="deepseek",
        provider_call=lambda: {"strengths": ["invented"]},
    )
    assert_true(result["fallback_used"] is True, "invalid AI result must fallback")
    assert_true(result["score_type"] == "rule", "fallback must use rule score")
    assert_true("missing score" in result["error"], "fallback reason missing")


def main() -> int:
    test_keyword_gap_uses_resume_evidence()
    test_ats_score_has_weighted_subscores()
    test_matcher_changes_perspective_not_evidence()
    test_unknown_candidate_is_neutral_and_low_confidence()
    test_ai_result_is_used()
    test_unreliable_ai_falls_back()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

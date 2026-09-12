"""Offline tests for unified match analysis."""

from __future__ import annotations

from typing import Any

import lakejob.application.matching.analysis as match_analysis


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class FailingProvider:
    def analyze_candidate_match(self, candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("DeepSeek temporary failure")

    def analyze_job_match(self, job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
        raise RuntimeError("DeepSeek temporary failure")


class Patch:
    def __init__(self, **values: Any):
        self.values = values
        self.originals: dict[str, Any] = {}

    def __enter__(self):
        for name, value in self.values.items():
            self.originals[name] = getattr(match_analysis, name)
            setattr(match_analysis, name, value)

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(match_analysis, name, value)


def test_mock_candidate_match() -> None:
    candidate = {"name": "张三", "city": "杭州", "skills": ["Python", "FastAPI"], "resume_text": "Python FastAPI"}
    profile = {"city": "杭州", "skills": ["Python", "FastAPI", "PostgreSQL"]}
    result = match_analysis.analyze_candidate_match(candidate, profile)
    assert_true(0 <= result["score"] <= 100, "candidate score out of range")
    assert_true(result["level"] in {"A", "B", "C"}, "candidate level invalid")
    assert_true(isinstance(result["reasons"], list), "candidate reasons invalid")
    assert_true(isinstance(result["strengths"], list), "candidate strengths invalid")
    assert_true(isinstance(result["risks"], list), "candidate risks invalid")
    assert_true(isinstance(result["tags"], list), "candidate tags invalid")
    assert_true(result["confidence"] in {"high", "medium", "low"}, "candidate confidence invalid")


class FixedProvider:
    def analyze_candidate_match(self, candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
        return {
            "score": 93,
            "level": "A",
            "reasons": ["provider result"],
            "strengths": ["Python"],
            "risks": [],
            "suggested_action": "review",
            "tags": ["python"],
        }

    def analyze_job_match(self, job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
        return self.analyze_candidate_match(user_profile, job)


def test_provider_result_not_discarded() -> None:
    with Patch(get_ai_provider=lambda: FixedProvider(), _provider_name=lambda: "deepseek"):
        candidate = {"skills": ["Python"], "resume_text": "Python", "current_title": "Engineer"}
        profile = {"skills": ["Python"], "title": "Engineer"}
        result = match_analysis.analyze_candidate_match(candidate, profile)
        assert_true(result["score"] == 93, "provider score was discarded")
        assert_true(result["reasons"] == ["provider result"], "provider reasons were discarded")
        assert_true(result["fallback_used"] is False, "valid provider result marked fallback")
        assert_true(result["score_type"] == "ai", "valid provider result not marked ai")


def test_mock_job_match() -> None:
    job = {"title": "AI视频设计师", "city": "杭州", "description": "AI视频 剪辑 Prompt"}
    profile = {"target_city": "杭州", "skills": "AI视频,剪辑,Prompt"}
    result = match_analysis.analyze_job_match(job, profile)
    assert_true(0 <= result["score"] <= 100, "job score out of range")
    assert_true(result["level"] in {"A", "B", "C"}, "job level invalid")
    assert_true(isinstance(result["suggested_action"], str), "job suggested action invalid")


def test_level_boundaries() -> None:
    assert_true(match_analysis.level_from_score(85) == "A", "A boundary failed")
    assert_true(match_analysis.level_from_score(70) == "B", "B boundary failed")
    assert_true(match_analysis.level_from_score(69.9) == "C", "C boundary failed")


def test_deepseek_exception_fallback() -> None:
    with Patch(
        get_ai_provider=lambda: FailingProvider(),
        _provider_name=lambda: "deepseek",
    ):
        candidate = {"name": "李四", "city": "杭州", "skills": ["AI视频"], "resume_text": "AI视频 剪辑"}
        profile = {"city": "杭州", "skills": "AI视频,剪辑,Prompt"}
        result = match_analysis.analyze_candidate_match(candidate, profile)
        assert_true(result["fallback_used"] is True, "candidate fallback not marked")
        assert_true(result["ai_provider"] == "deepseek", "fallback provider missing")
        assert_true("DeepSeek" in result["error"], "fallback error missing")

        job = {"title": "AI视频运营", "city": "杭州", "description": "AI视频 剪辑"}
        user_profile = {"target_city": "杭州", "skills": "AI视频,剪辑,Prompt"}
        job_result = match_analysis.analyze_job_match(job, user_profile)
        assert_true(job_result["fallback_used"] is True, "job fallback not marked")


def test_payload_structure() -> None:
    analysis = {
        "score": 88,
        "level": "A",
        "reasons": ["reason"],
        "strengths": ["strength"],
        "risks": ["risk"],
        "suggested_action": "review",
        "tags": ["tag"],
        "ai_provider": "mock",
        "fallback_used": False,
    }
    payload = match_analysis.match_analysis_payload("candidate", "candidate-1", analysis)
    assert_true(payload["match_analysis"] is True, "payload flag missing")
    assert_true(payload["target_type"] == "candidate", "payload target type missing")
    assert_true(payload["target_id"] == "candidate-1", "payload target id missing")
    assert_true(payload["score"] == 88, "payload score missing")
    assert_true(payload["level"] == "A", "payload level missing")
    assert_true(payload["reasons"] == ["reason"], "payload reasons missing")


def main() -> int:
    test_mock_candidate_match()
    test_provider_result_not_discarded()
    test_mock_job_match()
    test_level_boundaries()
    test_deepseek_exception_fallback()
    test_payload_structure()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Offline tests for Recruit Flow.

The test does not open BOSS, send messages, or apply to jobs.
"""

from __future__ import annotations

from typing import Any

import recruit_flow


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Patch:
    def __init__(self, **values: Any):
        self.values = values
        self.originals: dict[str, Any] = {}

    def __enter__(self):
        for name, value in self.values.items():
            self.originals[name] = getattr(recruit_flow, name)
            setattr(recruit_flow, name, value)

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(recruit_flow, name, value)


def sample_profile() -> dict[str, Any]:
    return {
        "profile_name": "测试招聘画像",
        "company_name": "LakeJob",
        "job_title": "AI应用开发工程师",
        "city": "杭州",
        "salary_range": "20-30K",
        "education_requirement": "本科",
        "experience_requirement": "3年",
        "core_skills": "Python,FastAPI,PostgreSQL",
        "bonus_skills": "AI视频",
        "reject_rules": "",
        "job_description": "负责 AI 应用开发。",
        "communication_style": "礼貌直接",
        "daily_contact_limit": "1",
        "notes": "",
    }


def test_profile_and_context() -> None:
    profile = sample_profile()
    context = recruit_flow.build_job_profile(profile)
    assert_true(context["profile_name"] == "测试招聘画像", "profile_name missing")
    assert_true("Python" in context["skills"], "skills not parsed")
    assert_true(context["title"] == "AI应用开发工程师", "title missing")


def test_mock_candidates_and_grades() -> None:
    candidates = recruit_flow.mock_candidates("Python", city="杭州", skills="Python,FastAPI", limit=3)
    assert_true(len(candidates) == 3, "mock candidate count wrong")
    assert_true(candidates[0]["city"] == "杭州", "mock candidate city wrong")
    assert_true(recruit_flow.grade_candidate(90) == "A", "A grade failed")
    assert_true(recruit_flow.grade_candidate(70) == "B", "B grade failed")
    assert_true(recruit_flow.grade_candidate(69.9) == "C", "C grade failed")


def test_limit_clamp() -> None:
    assert_true(recruit_flow.clamp_limit(99) == 5, "limit max should be 5")
    assert_true(recruit_flow.clamp_limit(0) == 1, "limit min should be 1")
    assert_true(recruit_flow.clamp_limit("bad") == 1, "invalid limit should default to 1")


def test_run_mock_flow_offline() -> None:
    saved_statuses: list[tuple[str, str]] = []
    logs: list[dict[str, Any]] = []

    def fake_save_candidate(platform_id: str, account_id: str, candidate: dict[str, Any]) -> dict[str, Any]:
        index = len(saved_statuses) + 1
        return {
            "id": f"candidate-{index}",
            "name": candidate["name"],
            "city": candidate["city"],
            "skills": candidate["skills"],
            "raw_data": {"source": "recruit_flow_mock"},
        }

    def fake_score(candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
        score = 90 if candidate["id"] == "candidate-1" else 74
        return {"candidate": candidate, "score": score, "score_type": "rule", "summary": "ok", "details": {}}

    def fake_status(candidate_id: str, status: str = "matched") -> None:
        saved_statuses.append((candidate_id, status))

    def fake_log(payload: dict[str, Any], *, success: bool = True, error: str = "") -> None:
        logs.append({"payload": payload, "success": success, "error": error})

    with Patch(
        load_recruit_profile=sample_profile,
        bootstrap_recruit_account=lambda: ("platform-1", "account-1"),
        save_candidate=fake_save_candidate,
        score_candidate_for_flow=fake_score,
        save_match_score=lambda candidate_id, score: {"id": f"score-{candidate_id}", "score": score["score"]},
        log_candidate_analysis=lambda candidate_id, analysis: f"log-{candidate_id}",
        set_talent_status=fake_status,
        log_recruit_flow=fake_log,
    ):
        result = recruit_flow.run_recruit_flow(
            keyword="Python",
            city="杭州",
            skills="Python,FastAPI",
            limit=9,
            mode="mock",
            dry_run=True,
        )

    assert_true(result["ok"] is True, "run result not ok")
    assert_true(result["summary"]["limit"] == 5, "run limit should be clamped to 5")
    assert_true(result["summary"]["real_message"] is False, "real message field must be false")
    assert_true(result["summary"]["real_apply"] is False, "real apply field must be false")
    assert_true(result["summary"]["candidates_saved"] == 5, "saved count wrong")
    assert_true(result["summary"]["grade_counts"]["A"] == 1, "A grade count wrong")
    assert_true(result["summary"]["grade_counts"]["B"] == 4, "B grade count wrong")
    assert_true(all(status == "matched" for _, status in saved_statuses), "talent status not matched")
    assert_true(logs and logs[-1]["payload"]["candidates_saved"] == 5, "log payload missing")


def test_log_failure_does_not_crash() -> None:
    recruit_flow.log_recruit_flow({"profile_name": "x"}, success=True)


def main() -> int:
    test_profile_and_context()
    test_mock_candidates_and_grades()
    test_limit_clamp()
    test_run_mock_flow_offline()
    test_log_failure_does_not_crash()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

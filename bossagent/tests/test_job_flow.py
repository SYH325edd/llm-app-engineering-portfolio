"""Offline tests for Job Flow.

The test does not open BOSS, send messages, or apply to jobs.
"""

from __future__ import annotations

from typing import Any

import job_flow


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class Patch:
    def __init__(self, **values: Any):
        self.values = values
        self.originals: dict[str, Any] = {}

    def __enter__(self):
        for name, value in self.values.items():
            self.originals[name] = getattr(job_flow, name)
            setattr(job_flow, name, value)

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(job_flow, name, value)


def sample_profile() -> dict[str, Any]:
    return {
        "profile_name": "测试求职画像",
        "name": "张三",
        "target_job_title": "AI视频运营",
        "target_city": "杭州",
        "expected_salary": "10-20K",
        "education": "本科",
        "skills": "AI视频,剪辑,Prompt",
        "project_experience": "参与 AI 视频生成平台。",
        "work_experience": "2年内容运营经验。",
        "avoid_companies": "",
        "avoid_industries": "",
        "communication_style": "自然礼貌",
        "notes": "",
    }


def test_profile_and_context() -> None:
    profile = sample_profile()
    context = job_flow.build_user_profile(profile)
    assert_true(context["profile_name"] == "测试求职画像", "profile_name missing")
    assert_true(context["target_job_title"] == "AI视频运营", "target title missing")
    assert_true("AI视频" in context["skills"], "skills missing")


def test_mock_jobs_and_grades() -> None:
    jobs = job_flow.mock_jobs("AI视频运营", city="杭州", skills="AI视频,剪辑,Prompt", limit=3)
    assert_true(len(jobs) == 3, "mock job count wrong")
    assert_true(jobs[0]["city"] == "杭州", "mock job city wrong")
    assert_true(job_flow.grade_job(90) == "A", "A grade failed")
    assert_true(job_flow.grade_job(70) == "B", "B grade failed")
    assert_true(job_flow.grade_job(69.9) == "C", "C grade failed")


def test_limit_clamp() -> None:
    assert_true(job_flow.clamp_limit(99) == 5, "limit max should be 5")
    assert_true(job_flow.clamp_limit(0) == 1, "limit min should be 1")
    assert_true(job_flow.clamp_limit("bad") == 1, "invalid limit should default to 1")


def test_run_mock_flow_offline() -> None:
    logs: list[dict[str, Any]] = []
    saved_jobs: list[str] = []

    def fake_save_job(platform_id: str, account_id: str, job: dict[str, Any]) -> dict[str, Any]:
        index = len(saved_jobs) + 1
        saved_jobs.append(f"job-{index}")
        return {
            "id": f"job-{index}",
            "title": job["title"],
            "company_name": job["company_name"],
            "city": job["city"],
            "salary_text": job["salary_text"],
            "raw_data": {"source": "job_flow_mock"},
        }

    def fake_score(job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
        score = 90 if job["id"] == "job-1" else 74
        return {"score": score, "score_type": "rule", "summary": "ok", "details": {}}

    def fake_log(payload: dict[str, Any], *, success: bool = True, error: str = "") -> None:
        logs.append({"payload": payload, "success": success, "error": error})

    with Patch(
        load_jobseeker_profile_for_flow=sample_profile,
        bootstrap_job_account=lambda: ("platform-1", "account-1"),
        save_job=fake_save_job,
        score_job_for_flow=fake_score,
        save_match_score=lambda job_id, score: {"id": f"score-{job_id}", "score": score["score"]},
        log_job_analysis=lambda job_id, analysis: f"log-{job_id}",
        log_job_flow=fake_log,
    ):
        result = job_flow.run_job_flow(
            keyword="AI视频运营",
            city="杭州",
            skills="AI视频,剪辑,Prompt",
            limit=9,
            mode="mock",
            dry_run=True,
        )

    assert_true(result["ok"] is True, "run result not ok")
    assert_true(result["summary"]["limit"] == 5, "run limit should be clamped to 5")
    assert_true(result["summary"]["real_apply"] is False, "real apply field must be false")
    assert_true(result["summary"]["real_message"] is False, "real message field must be false")
    assert_true(result["summary"]["jobs_saved"] == 5, "saved count wrong")
    assert_true(result["summary"]["grade_counts"]["A"] == 1, "A grade count wrong")
    assert_true(result["summary"]["grade_counts"]["B"] == 4, "B grade count wrong")
    assert_true(logs and logs[-1]["payload"]["jobs_saved"] == 5, "log payload missing")


def test_log_failure_does_not_crash() -> None:
    job_flow.log_job_flow({"profile_name": "x"}, success=True)


def main() -> int:
    test_profile_and_context()
    test_mock_jobs_and_grades()
    test_limit_clamp()
    test_run_mock_flow_offline()
    test_log_failure_does_not_crash()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Offline tests for LakeJob Profile Center."""

from __future__ import annotations

from profile_center import (
    load_jobseeker_profile,
    load_recruiter_profile,
    profile_to_candidate_context,
    profile_to_job_context,
    save_jobseeker_profile,
    save_recruiter_profile,
)


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    recruiter = {
        "profile_name": "AI视频招聘画像",
        "company_name": "示例科技",
        "job_title": "AI视频设计师",
        "city": "杭州",
        "salary_range": "15k-25k",
        "education_requirement": "本科",
        "experience_requirement": "2年",
        "core_skills": "AI视频, 剪辑, 提示词",
        "bonus_skills": "Python, FastAPI",
        "reject_rules": "无作品集, 频繁跳槽",
        "job_description": "负责AI视频内容生产流程。",
        "communication_style": "自然、简短、礼貌",
        "daily_contact_limit": "3",
        "notes": "优先内容科技背景。",
    }
    save_recruiter_profile(recruiter)
    loaded_recruiter = load_recruiter_profile()
    assert_true(loaded_recruiter["profile_name"] == recruiter["profile_name"], "recruiter profile load failed")
    job_context = profile_to_job_context(loaded_recruiter)
    assert_true(job_context["title"] == "AI视频设计师", "job context title failed")
    assert_true("AI视频" in job_context["skills"], "job context skills failed")

    jobseeker = {
        "profile_name": "个人求职画像",
        "name": "张三",
        "target_job_title": "AI应用开发工程师",
        "target_city": "杭州",
        "expected_salary": "20k-30k",
        "education": "本科",
        "skills": "Python, FastAPI, PostgreSQL",
        "project_experience": "AI视频生成平台",
        "work_experience": "后端开发3年",
        "avoid_companies": "外包公司",
        "avoid_industries": "博彩",
        "communication_style": "专业、简洁",
        "notes": "偏好AI应用方向。",
    }
    save_jobseeker_profile(jobseeker)
    loaded_jobseeker = load_jobseeker_profile()
    assert_true(loaded_jobseeker["profile_name"] == jobseeker["profile_name"], "jobseeker profile load failed")
    candidate_context = profile_to_candidate_context(loaded_jobseeker)
    assert_true(candidate_context["target_job_title"] == "AI应用开发工程师", "candidate context title failed")
    assert_true("Python" in candidate_context["skills"], "candidate context skills failed")

    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Database validation for Job Flow.

This test runs only mock/dry_run Job Flow. It does not open BOSS, send
messages, or apply to jobs.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from jobradar_log import db_conn
from profile_center import load_jobseeker_profile, save_jobseeker_profile


TEST_PROFILE = {
    "profile_name": "测试求职画像",
    "name": "测试用户",
    "target_job_title": "AI视频设计师",
    "target_city": "杭州",
    "expected_salary": "8-15K",
    "education": "本科",
    "skills": "AI视频,剪辑,Prompt,内容运营",
    "project_experience": "AI视频生成平台、提示词优化、短视频内容自动化",
    "work_experience": "",
    "avoid_companies": "",
    "avoid_industries": "",
    "communication_style": "自然礼貌",
    "notes": "Job Flow DB validation profile",
}


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def scalar(sql: str, params: tuple[Any, ...] = ()) -> int:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return int(cur.fetchone()[0])


def latest_job_flow_jobs(limit: int = 3) -> list[dict[str, Any]]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, title, company_name, city, salary_text, raw_data, created_at
            FROM jobs
            WHERE raw_data->>'source' = 'job_flow_mock'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        cols = [getattr(item, "name", item[0]) for item in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def ensure_profile() -> None:
    profile = load_jobseeker_profile()
    if not profile.get("profile_name") and not profile.get("target_job_title"):
        save_jobseeker_profile(TEST_PROFILE)


def main() -> int:
    if not os.getenv("LAKEJOB_DATABASE_URL") and not os.getenv("DATABASE_URL"):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return 0

    from fastapi.testclient import TestClient
    from web_console import app

    ensure_profile()
    before_jobs = scalar("SELECT COUNT(*) FROM jobs")
    before_scores = scalar("SELECT COUNT(*) FROM match_scores")
    before_job_logs = scalar("SELECT COUNT(*) FROM logs WHERE payload->>'job_flow' = 'true'")

    client = TestClient(app)
    response = client.post(
        "/job/run",
        data={
            "keyword": "AI视频",
            "city": "杭州",
            "skills": "AI视频,剪辑,Prompt",
            "limit": "3",
            "mode": "mock",
            "dry_run": "true",
        },
        follow_redirects=False,
    )
    assert_true(response.status_code == 200, f"/job/run returned {response.status_code}: {response.headers.get('location') or response.text[:300]}")
    assert_true("岗位" in response.text or "Job" in response.text, "result page did not render job content")
    assert_true(bool(re.search(r">\s*[ABC]", response.text)), "result page missing A/B/C grades")

    job_pool = client.get("/jobs")
    assert_true(job_pool.status_code == 200, f"/jobs returned {job_pool.status_code}")

    after_jobs = scalar("SELECT COUNT(*) FROM jobs")
    after_scores = scalar("SELECT COUNT(*) FROM match_scores")
    after_job_logs = scalar("SELECT COUNT(*) FROM logs WHERE payload->>'job_flow' = 'true'")

    job_delta = after_jobs - before_jobs
    score_delta = after_scores - before_scores
    log_delta = after_job_logs - before_job_logs

    assert_true(job_delta >= 1, f"expected jobs delta >= 1, got {job_delta}")
    assert_true(score_delta >= 1, f"expected match_scores delta >= 1, got {score_delta}")
    assert_true(log_delta >= 1, f"expected job_flow logs delta >= 1, got {log_delta}")

    jobs = latest_job_flow_jobs(3)
    assert_true(bool(jobs), "no job_flow_mock jobs found")

    output = {
        "status": "PASSED",
        "job_delta": job_delta,
        "match_score_delta": score_delta,
        "job_flow_log_delta": log_delta,
        "latest_job_ids": [str(item["id"]) for item in jobs],
        "job_pool_status": job_pool.status_code,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

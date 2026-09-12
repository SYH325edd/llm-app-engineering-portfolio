"""Database validation for Recruit Flow.

This test runs only mock/dry_run Recruit Flow. It does not open BOSS, send
messages, or apply to jobs.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

from lakejob.application.profiles.center import load_recruiter_profile, save_recruiter_profile
from lakejob.application.recruiting.talent_pool import db_conn, get_candidate_status


TEST_PROFILE = {
    "profile_name": "测试招聘画像",
    "company_name": "LakeJob测试公司",
    "job_title": "AI视频运营",
    "city": "杭州",
    "salary_range": "8-15K",
    "education_requirement": "本科",
    "experience_requirement": "1-3年",
    "core_skills": "AI视频,剪辑,Prompt,内容运营",
    "bonus_skills": "",
    "reject_rules": "",
    "job_description": "负责 AI 视频内容运营和素材管理。",
    "communication_style": "礼貌直接",
    "daily_contact_limit": "1",
    "notes": "Recruit Flow DB validation profile",
}


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def one(cur) -> dict[str, Any]:
    row = cur.fetchone()
    cols = [getattr(item, "name", item[0]) for item in cur.description]
    return dict(zip(cols, row)) if row else {}


def scalar(sql: str, params: tuple[Any, ...] = ()) -> int:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        return int(cur.fetchone()[0])


def latest_recruit_flow_candidates(limit: int = 3) -> list[dict[str, Any]]:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, city, skills, raw_data, created_at
            FROM candidates
            WHERE raw_data->>'source' = 'recruit_flow_mock'
            ORDER BY created_at DESC
            LIMIT %s
            """,
            (limit,),
        )
        cols = [getattr(item, "name", item[0]) for item in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def ensure_profile() -> None:
    profile = load_recruiter_profile()
    if not profile.get("profile_name") and not profile.get("job_title"):
        save_recruiter_profile(TEST_PROFILE)


def main() -> int:
    if not os.getenv("LAKEJOB_DATABASE_URL") and not os.getenv("DATABASE_URL"):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return 0

    from fastapi.testclient import TestClient
    from lakejob.app.console import app

    ensure_profile()
    before_candidates = scalar("SELECT COUNT(*) FROM candidates")
    before_scores = scalar("SELECT COUNT(*) FROM match_scores")
    before_recruit_logs = scalar("SELECT COUNT(*) FROM logs WHERE payload->>'recruit_flow' = 'true'")

    client = TestClient(app)
    response = client.post(
        "/recruit/run",
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
    assert_true(response.status_code == 200, f"/recruit/run returned {response.status_code}: {response.text[:300]}")
    assert_true("Talent Pool" in response.text or "人才库" in response.text, "result page did not render Talent Pool link")
    assert_true(bool(re.search(r">\s*[ABC]", response.text)), "result page missing A/B/C grades")

    after_candidates = scalar("SELECT COUNT(*) FROM candidates")
    after_scores = scalar("SELECT COUNT(*) FROM match_scores")
    after_recruit_logs = scalar("SELECT COUNT(*) FROM logs WHERE payload->>'recruit_flow' = 'true'")

    candidate_delta = after_candidates - before_candidates
    score_delta = after_scores - before_scores
    log_delta = after_recruit_logs - before_recruit_logs

    assert_true(candidate_delta >= 1, f"expected candidates delta >= 1, got {candidate_delta}")
    assert_true(score_delta >= 1, f"expected match_scores delta >= 1, got {score_delta}")
    assert_true(log_delta >= 1, f"expected recruit_flow logs delta >= 1, got {log_delta}")

    candidates = latest_recruit_flow_candidates(3)
    assert_true(bool(candidates), "no recruit_flow_mock candidates found")
    matched_count = 0
    for candidate in candidates:
        candidate_id = str(candidate["id"])
        status = get_candidate_status(candidate_id)
        if status == "matched":
            matched_count += 1
    matched_log_count = scalar(
        """
        SELECT COUNT(*)
        FROM logs
        WHERE payload->>'talent_pool' = 'true'
          AND payload->>'action' = 'update_status'
          AND payload->>'new_status' = 'matched'
        """
    )
    assert_true(matched_count >= 1 or matched_log_count >= 1, "Talent Pool matched status not found")

    output = {
        "status": "PASSED",
        "candidate_delta": candidate_delta,
        "match_score_delta": score_delta,
        "recruit_flow_log_delta": log_delta,
        "latest_candidate_ids": [str(item["id"]) for item in candidates],
        "matched_count": matched_count,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

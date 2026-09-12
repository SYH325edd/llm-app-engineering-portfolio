from __future__ import annotations

import os
import sys
import time


def main() -> int:
    if not os.getenv("LAKEJOB_DATABASE_URL") and not os.getenv("DATABASE_URL"):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return 0

    from fastapi.testclient import TestClient

    from candidate360 import get_candidate360
    from jobradar_log import log_event
    from recruitradar_log import add_match_score, bootstrap_boss_recruiter, upsert_candidate
    from talent_pool import update_candidate_status
    from web_console import app

    platform_id, account_id = bootstrap_boss_recruiter("candidate360-test")
    suffix = int(time.time())
    candidate = upsert_candidate(
        platform_id,
        account_id,
        {
            "external_candidate_id": f"candidate360-{suffix}",
            "source_url": "https://example.com/candidate360",
            "name": "Candidate360测试候选人",
            "city": "杭州",
            "current_title": "AI视频运营",
            "education_text": "本科",
            "experience_text": "3年内容运营经验",
            "skills": ["AI视频", "剪辑", "Prompt"],
            "resume_text": "参与AI视频生成平台运营。",
            "source": "test",
            "project_experience": "AI视频生成平台",
            "resume_center": {"score": 86, "summary": {"profile": "AI视频方向候选人"}},
        },
    )
    candidate_id = str(candidate["id"])
    add_match_score(candidate_id, 88, score_type="rule", summary="Candidate360 test score")
    log_event(
        "candidate360 match analysis",
        entity_type="candidate",
        entity_id=candidate_id,
        payload={
            "match_analysis": True,
            "target_type": "candidate",
            "target_id": candidate_id,
            "score": 88,
            "level": "A",
            "strengths": ["AI视频经验"],
            "risks": ["需要确认作品质量"],
            "suggested_action": "建议安排面试",
            "tags": ["AI视频", "内容运营"],
        },
    )
    log_event(
        "candidate360 message draft",
        entity_type="candidate",
        entity_id=candidate_id,
        payload={
            "message_draft": True,
            "draft_type": "recruiter",
            "target_id": candidate_id,
            "content": "您好，想和您进一步沟通AI视频岗位。",
            "status": "draft",
        },
    )
    update_candidate_status(candidate_id, "matched")

    detail = get_candidate360(candidate_id)
    assert detail is not None
    assert detail["candidate"]["name"] == "Candidate360测试候选人"
    assert detail["match_analysis"]["level"] == "A"
    assert detail["drafts"]["count"] >= 1
    assert detail["ai_next_action"]

    client = TestClient(app)
    response = client.get(f"/candidate360/{candidate_id}")
    assert response.status_code == 200
    assert "Candidate 360" in response.text
    print(f"PASSED candidate360 candidate_id={candidate_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())


from __future__ import annotations

import os
import sys
import time


def main() -> int:
    if not os.getenv("LAKEJOB_DATABASE_URL") and not os.getenv("DATABASE_URL"):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return 0

    from fastapi.testclient import TestClient

    from lakejob.application.jobs.job360 import get_job360
    from lakejob.infrastructure.database.jobs import add_match_score, bootstrap_boss_account, log_event, upsert_job
    from lakejob.app.console import app

    platform_id, account_id = bootstrap_boss_account("job360-test")
    suffix = int(time.time())
    job = upsert_job(
        platform_id,
        account_id,
        {
            "external_job_id": f"job360-{suffix}",
            "source_url": "https://example.com/job360",
            "title": "Job360测试岗位",
            "company": "LakeJob测试公司",
            "city": "杭州",
            "salary": "10-18K",
            "experience": "1-3年",
            "education": "本科",
            "description": "负责AI视频产品和内容运营。",
            "source": "test",
        },
    )
    job_id = str(job["id"])
    add_match_score(job_id, 87, score_type="rule", summary="Job360 test score")
    log_event(
        "job360 match analysis",
        entity_type="job",
        entity_id=job_id,
        payload={
            "match_analysis": True,
            "target_type": "job",
            "target_id": job_id,
            "score": 87,
            "level": "A",
            "summary": "岗位与求职画像匹配较高",
            "tags": ["AI视频", "运营"],
            "suggested_action": "继续搜索",
        },
    )

    detail = get_job360(job_id)
    assert detail is not None
    assert detail["job"]["title"] == "Job360测试岗位"
    assert detail["analysis"]["level"] == "A"
    assert detail["ai_next_action"]

    client = TestClient(app)
    response = client.get(f"/job360/{job_id}")
    assert response.status_code == 200
    assert "Job 360" in response.text
    print(f"PASSED job360 job_id={job_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

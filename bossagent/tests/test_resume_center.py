"""Offline validation for LakeJob Resume Center.

This test does not open a browser, call AI, trigger Boss automation, send
messages, or apply to jobs. It validates the local upload/parse/Core-write
chain against PostgreSQL.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

from lakejob.application.resumes.center import ROOT, db_conn, process_resume_upload
from lakejob.application.resumes.parser import extract_text_from_file, generate_resume_summary, parse_resume_text, score_resume


RUNTIME_DIR = ROOT / "runtime"
TEST_RESUME_PATH = RUNTIME_DIR / "test_resume.txt"


def write_test_resume() -> str:
    validation_id = str(int(time.time()))
    content = f"""姓名：张三
电话：13800138000
邮箱：zhangsan@example.com
城市：杭州
学历：本科
学校：浙江大学
专业：计算机科学
技能：Python, FastAPI, PostgreSQL, Docker, AI视频
工作年限：3年
目标岗位：AI应用开发工程师
项目经历：参与AI视频生成平台开发，负责提示词优化和后端接口。
工作经历：曾在互联网公司担任后端开发工程师。
验证批次：{validation_id}
"""
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    TEST_RESUME_PATH.write_text(content, encoding="utf-8")
    return content


def fetch_candidate(candidate_id: str) -> dict[str, Any] | None:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT id, name, city, current_title, education_text, skills, resume_text, raw_data
            FROM candidates
            WHERE id = %s
            LIMIT 1
            """,
            (candidate_id,),
        )
        row = cur.fetchone()
        if not row:
            return None
        cols = [getattr(item, "name", item[0]) for item in cur.description]
        return dict(zip(cols, row))


def fetch_resume_log_count(candidate_id: str) -> int:
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT COUNT(*)
            FROM logs
            WHERE entity_id = %s
              AND COALESCE((payload->>'resume_center')::boolean, false) = true
              AND payload->>'action' = 'upload_resume'
              AND payload->>'source' = 'resume'
            """,
            (candidate_id,),
        )
        return int(cur.fetchone()[0])


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    results: dict[str, Any] = {"checks": {}, "status": "FAILED"}
    try:
        content = write_test_resume()
        results["checks"]["runtime_test_resume_exists"] = TEST_RESUME_PATH.exists()

        extracted_text = extract_text_from_file(TEST_RESUME_PATH)
        results["checks"]["text_read"] = bool(extracted_text.strip())
        assert_true("张三" in extracted_text, "text extraction did not read candidate name")

        parsed = parse_resume_text(extracted_text)
        required_fields = ["name", "phone", "email", "city", "education", "skills"]
        for field in required_fields:
            assert_true(parsed.get(field) not in (None, "", "unknown", ["unknown"]), f"missing parsed field: {field}")
        results["checks"]["parsed_required_fields"] = {field: parsed.get(field) for field in required_fields}

        score = score_resume(parsed)
        assert_true(0 <= score <= 100, "score outside 0-100")
        results["checks"]["score"] = score

        summary = generate_resume_summary(parsed, score)
        assert_true(bool(summary.get("candidate_profile")), "mock summary is empty")
        assert_true(bool(summary.get("strengths")), "mock strengths are empty")
        assert_true(bool(summary.get("recommended_directions")), "mock recommendations are empty")
        results["checks"]["mock_summary"] = {
            "candidate_profile": summary.get("candidate_profile"),
            "match_tags": summary.get("match_tags"),
        }

        upload_result = process_resume_upload(TEST_RESUME_PATH.name, content.encode("utf-8"))
        candidate_id = str(upload_result["candidate"]["id"])
        saved_file = ROOT / "uploads" / "resumes" / upload_result["file_name"]
        assert_true(saved_file.exists(), "uploaded file was not saved")
        results["checks"]["saved_file"] = str(saved_file.relative_to(ROOT)).replace("\\", "/")

        candidate = fetch_candidate(candidate_id)
        assert_true(candidate is not None, "candidate was not written")
        raw_data = candidate.get("raw_data") or {}
        assert_true(raw_data.get("source") == "resume", "candidate raw_data.source is not resume")
        assert_true((raw_data.get("resume_center") or {}).get("score") == upload_result["score"], "candidate resume score mismatch")
        results["checks"]["candidate"] = {
            "id": candidate_id,
            "name": candidate.get("name"),
            "city": candidate.get("city"),
            "source": raw_data.get("source"),
        }

        log_count = fetch_resume_log_count(candidate_id)
        assert_true(log_count >= 1, "resume_center log was not written")
        results["checks"]["resume_center_logs"] = log_count

        results["status"] = "PASSED"
        print(json.dumps(results, ensure_ascii=False, indent=2, default=str))
        print("PASSED")
        return 0
    except Exception as exc:
        results["error"] = str(exc)
        print(json.dumps(results, ensure_ascii=False, indent=2, default=str))
        print("FAILED")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

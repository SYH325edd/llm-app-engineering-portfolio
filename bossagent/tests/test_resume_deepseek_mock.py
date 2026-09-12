"""Resume Center DeepSeek integration tests with fake providers.

No real DeepSeek call is made. No Boss automation, real message, or real apply
is triggered. The test validates that Resume Center writes candidates/logs for
success and fallback paths.
"""

from __future__ import annotations

import os
import time
from typing import Any

import lakejob.application.resumes.center as resume_center


TEST_TEXT = """姓名：李四
电话：13900139000
邮箱：lisi@example.com
城市：上海
学历：硕士
学校：复旦大学
专业：人工智能
技能：Python, FastAPI, PostgreSQL, Docker, AI视频
工作年限：5年
目标岗位：AI应用架构师
项目经历：负责智能内容平台和AI视频生成平台。
工作经历：曾担任高级后端开发工程师。
"""


class FakeDeepSeekSuccess:
    name = "deepseek"

    def parse_resume(self, text: str) -> dict[str, Any]:
        return {
            "name": "李四",
            "phone": "13900139000",
            "email": "lisi@example.com",
            "city": "上海",
            "education": "硕士",
            "school": "复旦大学",
            "major": "人工智能",
            "skills": ["Python", "FastAPI", "PostgreSQL", "Docker", "AI视频"],
            "work_years": "5年",
            "projects": "负责智能内容平台和AI视频生成平台。",
            "work_experience": "曾担任高级后端开发工程师。",
            "target_role": "AI应用架构师",
            "expected_salary": "unknown",
        }

    def summarize_resume(self, parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
        return {
            "candidate_profile": "李四，AI应用架构方向候选人。",
            "strengths": ["项目和工作经历完整。"],
            "risks": ["需进一步确认团队管理经验。"],
            "recommended_directions": ["AI应用架构师"],
            "match_tags": ["Python", "AI视频", "架构"],
        }


class FakeDeepSeekNonJson:
    name = "deepseek"

    def parse_resume(self, text: str) -> dict[str, Any]:
        raise RuntimeError("DeepSeek response was not valid JSON")

    def summarize_resume(self, parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
        raise RuntimeError("should not be called")


class FakeDeepSeekException:
    name = "deepseek"

    def parse_resume(self, text: str) -> dict[str, Any]:
        raise RuntimeError("DeepSeek request failed: simulated timeout")

    def summarize_resume(self, parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
        raise RuntimeError("should not be called")


def _ensure_db_env() -> None:
    os.environ.setdefault("LAKEJOB_DATABASE_URL", "postgresql://lakejob_user:lakejob_pass@localhost:5432/lakejob_db")


def _latest_log(candidate_id: str) -> dict[str, Any]:
    with resume_center.db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT payload
            FROM logs
            WHERE entity_id = %s
              AND COALESCE((payload->>'resume_center')::boolean, false) = true
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (candidate_id,),
        )
        row = cur.fetchone()
        if not row:
            raise AssertionError("resume_center log not found")
        return row[0]


def _run_case(label: str, provider: Any, expected_provider: str, expected_status: str, expected_fallback: bool) -> dict[str, Any]:
    original_get_ai_provider = resume_center.get_ai_provider
    try:
        resume_center.get_ai_provider = lambda: provider  # type: ignore[assignment]
        content = TEST_TEXT + f"\n测试场景：{label}\n时间戳：{time.time()}\n"
        result = resume_center.process_resume_upload(f"deepseek_{label}.txt", content.encode("utf-8"))
    finally:
        resume_center.get_ai_provider = original_get_ai_provider  # type: ignore[assignment]

    candidate_id = str(result["candidate"]["id"])
    detail = resume_center.get_resume_detail(candidate_id)
    if not detail:
        raise AssertionError(f"{label}: resume detail not found")
    if detail["ai_provider"] != expected_provider:
        raise AssertionError(f"{label}: ai_provider {detail['ai_provider']} != {expected_provider}")
    if detail["ai_parse_status"] != expected_status:
        raise AssertionError(f"{label}: ai_parse_status {detail['ai_parse_status']} != {expected_status}")
    if bool(detail["fallback_used"]) is not expected_fallback:
        raise AssertionError(f"{label}: fallback_used {detail['fallback_used']} != {expected_fallback}")

    payload = _latest_log(candidate_id)
    if payload.get("ai_provider") != expected_provider:
        raise AssertionError(f"{label}: log ai_provider mismatch")
    if payload.get("ai_parse_status") != expected_status:
        raise AssertionError(f"{label}: log ai_parse_status mismatch")
    if bool(payload.get("fallback_used")) is not expected_fallback:
        raise AssertionError(f"{label}: log fallback_used mismatch")
    if payload.get("candidate_id") != candidate_id:
        raise AssertionError(f"{label}: log candidate_id mismatch")
    return {"candidate_id": candidate_id, "score": result["score"], "payload": payload}


def main() -> int:
    _ensure_db_env()
    results = {
        "success": _run_case("success", FakeDeepSeekSuccess(), "deepseek", "success", False),
        "fallback_non_json": _run_case("fallback_non_json", FakeDeepSeekNonJson(), "fallback_rule", "fallback", True),
        "fallback_exception": _run_case("fallback_exception", FakeDeepSeekException(), "fallback_rule", "fallback", True),
    }
    print(results)
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

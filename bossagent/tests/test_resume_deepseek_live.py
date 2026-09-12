"""Live DeepSeek validation for Resume Center.

This script does not trigger Boss automation, JobRadar, RecruitRadar, real
messages, or real applies. It only forces Resume Center to use DeepSeekProvider
for one resume upload when DEEPSEEK_API_KEY is configured.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from ai.deepseek_provider import DeepSeekProvider
import resume_center


ROOT = Path(__file__).resolve().parent
TEST_FILE = ROOT / "runtime" / "test_resume_deepseek_live.txt"
TEST_CONTENT = """姓名：李明
电话：13900139000
邮箱：liming@example.com
城市：杭州
学历：本科
学校：浙江工业大学
专业：数字媒体技术
技能：Python, FastAPI, AI视频, 剪辑, Prompt Engineering
工作年限：2年
目标岗位：AI视频产品运营
项目经历：参与AI视频生成平台搭建，负责提示词优化、视频生成流程设计和素材管理。
工作经历：曾在内容科技公司负责短视频自动化生产流程。
"""


def _print_json(data: dict[str, Any]) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2, default=str))


def _latest_resume_log(candidate_id: str) -> dict[str, Any]:
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


def _validate_detail(detail: dict[str, Any], payload: dict[str, Any]) -> None:
    status = detail.get("ai_parse_status")
    if detail.get("ai_provider") not in {"deepseek", "fallback_rule"}:
        raise AssertionError(f"unexpected ai_provider: {detail.get('ai_provider')}")
    if status not in {"success", "fallback"}:
        raise AssertionError(f"unexpected ai_parse_status: {status}")
    if status == "success":
        parsed = detail.get("parsed") or {}
        for key in ["name", "phone", "email", "city", "education", "skills"]:
            if parsed.get(key) in (None, "", "unknown", ["unknown"]):
                raise AssertionError(f"missing structured field on success: {key}")
    if status == "fallback" and not detail.get("ai_parse_error"):
        raise AssertionError("fallback requires ai_parse_error")
    if payload.get("candidate_id") != str(detail.get("id")):
        raise AssertionError("log candidate_id mismatch")


def main() -> int:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        print("SKIPPED: DEEPSEEK_API_KEY not configured")
        return 0

    TEST_FILE.parent.mkdir(parents=True, exist_ok=True)
    TEST_FILE.write_text(TEST_CONTENT, encoding="utf-8")

    provider = DeepSeekProvider(
        api_key=api_key,
        base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        model=os.getenv("DEEPSEEK_MODEL", "deepseek-chat"),
        timeout_seconds=30.0,
    )

    original_get_ai_provider = resume_center.get_ai_provider
    try:
        resume_center.get_ai_provider = lambda: provider  # type: ignore[assignment]
        result = resume_center.process_resume_upload(TEST_FILE.name, TEST_CONTENT.encode("utf-8"))
        candidate_id = str(result["candidate"]["id"])
        detail = resume_center.get_resume_detail(candidate_id)
        if not detail:
            raise AssertionError("candidate detail not found after upload")
        payload = _latest_resume_log(candidate_id)
        _validate_detail(detail, payload)
        output = {
            "status": "PASSED",
            "ai_provider": detail.get("ai_provider"),
            "ai_parse_status": detail.get("ai_parse_status"),
            "fallback_used": detail.get("fallback_used"),
            "candidate_id": candidate_id,
            "score": detail.get("score"),
            "error": detail.get("ai_parse_error") or "",
        }
        _print_json(output)
        return 0
    except Exception as exc:
        output = {
            "status": "FAILED",
            "ai_provider": "",
            "ai_parse_status": "",
            "fallback_used": "",
            "candidate_id": "",
            "score": "",
            "error": str(exc),
        }
        _print_json(output)
        return 1
    finally:
        resume_center.get_ai_provider = original_get_ai_provider  # type: ignore[assignment]


if __name__ == "__main__":
    raise SystemExit(main())

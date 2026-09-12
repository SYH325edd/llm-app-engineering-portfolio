"""Tests for AI Message Draft Center.

Core provider and payload tests do not require DB. DB draft creation is skipped
when LAKEJOB_DATABASE_URL is not configured.
"""

from __future__ import annotations

import json
import os
from typing import Any

import message_draft
from ai.mock_provider import MockAIProvider


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


class FailingProvider:
    name = "deepseek"

    def generate_recruiter_message(self, candidate: dict[str, Any], recruiter_profile: dict[str, Any], match_analysis=None) -> str:
        raise RuntimeError("DeepSeek draft failure")

    def generate_jobseeker_message(self, job: dict[str, Any], jobseeker_profile: dict[str, Any], match_analysis=None) -> str:
        raise RuntimeError("DeepSeek draft failure")


class Patch:
    def __init__(self, **values: Any):
        self.values = values
        self.originals: dict[str, Any] = {}

    def __enter__(self):
        for name, value in self.values.items():
            self.originals[name] = getattr(message_draft, name)
            setattr(message_draft, name, value)

    def __exit__(self, exc_type, exc, tb):
        for name, value in self.originals.items():
            setattr(message_draft, name, value)


def test_mock_provider_drafts() -> None:
    provider = MockAIProvider()
    recruiter = provider.generate_recruiter_message(
        {"name": "张三", "skills": ["AI视频"]},
        {"job_title": "AI视频运营"},
        {"tags": ["AI视频"]},
    )
    jobseeker = provider.generate_jobseeker_message(
        {"title": "AI视频设计师"},
        {"skills": "AI视频,剪辑"},
        {"tags": ["AI视频"]},
    )
    assert_true(0 < len(recruiter) <= 100, "recruiter draft length invalid")
    assert_true(0 < len(jobseeker) <= 100, "jobseeker draft length invalid")
    assert_true("发送" not in recruiter, "draft should not imply sending action")


def test_payload_structure() -> None:
    payload = message_draft.build_draft_payload(
        draft_type="recruiter",
        target_id="candidate-1",
        target_name="张三",
        content="张三您好，我们想和您简单沟通一下岗位机会。",
        ai_provider="mock",
        fallback_used=False,
        match_analysis={"score": 88, "level": "A"},
    )
    assert_true(payload["message_draft"] is True, "message_draft flag missing")
    assert_true(payload["real_send"] is False, "real_send must be false")
    assert_true(payload["draft_only"] is True, "draft_only must be true")
    assert_true(payload["status"] == "draft", "status must be draft")
    assert_true(payload["draft_type"] == "recruiter", "draft_type missing")


def test_fallback_without_db() -> None:
    with Patch(
        get_ai_provider=lambda: FailingProvider(),
        _get_candidate=lambda candidate_id: {"id": candidate_id, "name": "李四", "skills": ["Prompt"]},
        _get_job=lambda job_id: {"id": job_id, "title": "AI视频设计师"},
        _latest_match_analysis=lambda target_type, target_id: {"score": 72, "level": "B"},
        _save_draft=lambda **kwargs: {"draft_id": "draft-1", **message_draft.build_draft_payload(**kwargs)},
        _provider_name=lambda: "deepseek",
        consume_quota=lambda *args, **kwargs: {"allowed": True, "consumed": True, "reason": "test_quota"},
    ):
        recruiter = message_draft.create_recruiter_message_draft("candidate-1", {"job_title": "AI视频运营"})
        assert_true(recruiter["fallback_used"] is True, "recruiter fallback not marked")
        assert_true(recruiter["real_send"] is False and recruiter["draft_only"] is True, "recruiter safety flags missing")
        assert_true(len(recruiter["content"]) <= 100, "recruiter fallback too long")

        jobseeker = message_draft.create_jobseeker_message_draft("job-1", {"skills": "AI视频"})
        assert_true(jobseeker["fallback_used"] is True, "jobseeker fallback not marked")
        assert_true(jobseeker["real_send"] is False and jobseeker["draft_only"] is True, "jobseeker safety flags missing")
        assert_true(len(jobseeker["content"]) <= 100, "jobseeker fallback too long")


def test_db_path_if_available() -> None:
    if not os.getenv("LAKEJOB_DATABASE_URL") and not os.getenv("DATABASE_URL"):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return
    if not os.getenv("LAKEJOB_USER_ID") or not os.getenv("LAKEJOB_ORGANIZATION_ID"):
        print("SKIPPED: quota identity not configured")
        return
    from jobradar_log import bootstrap_boss_account, upsert_job
    from recruitradar_log import bootstrap_boss_recruiter, upsert_candidate

    platform_id, account_id = bootstrap_boss_recruiter("message-draft-test")
    candidate = upsert_candidate(
        platform_id,
        account_id,
        {
            "external_candidate_id": "message-draft-candidate-test",
            "name": "消息草稿候选人",
            "city": "杭州",
            "skills": ["AI视频"],
            "resume_text": "AI视频 剪辑 Prompt",
            "raw_payload": {"source": "message_draft_test"},
        },
    )
    recruiter_draft = message_draft.create_recruiter_message_draft(str(candidate["id"]), {"job_title": "AI视频运营"})
    assert_true(recruiter_draft["draft_type"] == "recruiter", "DB recruiter draft type invalid")

    platform_id, account_id = bootstrap_boss_account("message-draft-test")
    job = upsert_job(
        platform_id,
        account_id,
        {
            "external_job_id": "message-draft-job-test",
            "source_url": "mock://message-draft-job-test",
            "title": "AI视频设计师",
            "company": "LakeJob测试公司",
            "city": "杭州",
            "salary": "8-15K",
            "description": "AI视频 剪辑 Prompt",
        },
    )
    jobseeker_draft = message_draft.create_jobseeker_message_draft(str(job["id"]), {"skills": "AI视频,剪辑"})
    assert_true(jobseeker_draft["draft_type"] == "jobseeker", "DB jobseeker draft type invalid")
    drafts = message_draft.list_message_drafts()
    assert_true(any(item["draft_id"] == recruiter_draft["draft_id"] for item in drafts), "draft list missing recruiter draft")
    assert_true(message_draft.get_message_draft(recruiter_draft["draft_id"]) is not None, "draft detail missing")
    print(json.dumps({"db_draft_status": "PASSED", "drafts_created": [recruiter_draft["draft_id"], jobseeker_draft["draft_id"]]}, ensure_ascii=False))


def main() -> int:
    test_mock_provider_drafts()
    test_payload_structure()
    test_fallback_without_db()
    test_db_path_if_available()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

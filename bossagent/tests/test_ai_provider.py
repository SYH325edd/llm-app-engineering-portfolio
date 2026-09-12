"""Offline tests for LakeJob AI providers."""

from __future__ import annotations

import os

from lakejob.infrastructure.ai.deepseek_provider import DeepSeekProvider
from lakejob.infrastructure.ai.mock_provider import MockAIProvider
from lakejob.infrastructure.ai.provider import get_ai_provider


SAMPLE_RESUME = """
姓名：张三
电话：13800138000
邮箱：zhangsan@example.com
城市：杭州
学历：本科
技能：Python, FastAPI, PostgreSQL
工作年限：3年
项目经历：AI视频生成平台
工作经历：后端开发
目标岗位：AI应用开发工程师
"""


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def test_mock_provider() -> None:
    provider = MockAIProvider()
    parsed = provider.parse_resume(SAMPLE_RESUME)
    assert_true(parsed["name"] == "张三", "mock parse_resume failed")
    assert_true("Python" in parsed["skills"], "mock parse_resume skills failed")

    summary = provider.summarize_resume(parsed, SAMPLE_RESUME)
    assert_true(bool(summary.get("candidate_profile")), "mock summarize_resume failed")
    assert_true(bool(summary.get("match_tags")), "mock summarize_resume tags failed")

    candidate_score = provider.score_candidate(parsed, {"skills": "Python,FastAPI", "regions": "杭州"})
    assert_true(0 <= candidate_score["score"] <= 100, "mock score_candidate range failed")
    assert_true(candidate_score["score_type"] == "mock", "mock score_candidate type failed")

    job_score = provider.score_job({"title": "Python开发", "description": "FastAPI PostgreSQL"}, {"skills": ["Python", "PostgreSQL"]})
    assert_true(0 <= job_score["score"] <= 100, "mock score_job range failed")

    message = provider.generate_message({"job": {"title": "Python开发"}, "profile": {"skills": ["Python"]}})
    assert_true(bool(message), "mock generate_message failed")

    health = provider.health_check()
    assert_true(health["ok"] is True, "mock health_check failed")


def test_get_ai_provider_mock() -> None:
    provider = get_ai_provider({"provider": "mock"})
    assert_true(isinstance(provider, MockAIProvider), "get_ai_provider mock failed")


def test_deepseek_no_key_health_check() -> None:
    os.environ.pop("DEEPSEEK_API_KEY", None)
    provider = DeepSeekProvider(api_key=None)
    health = provider.health_check()
    assert_true(health["ok"] is False, "deepseek no-key health should fail")
    assert_true("DEEPSEEK_API_KEY" in health["error"], "deepseek health error should mention missing key")
    assert_true("your_deepseek_key_here" not in str(health), "health_check leaked key-like placeholder")


def main() -> int:
    test_mock_provider()
    test_get_ai_provider_mock()
    test_deepseek_no_key_health_check()
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Application message generation for JobRadar."""

from __future__ import annotations

from typing import Any

from lakejob.infrastructure.ai.provider import get_ai_provider


def _skills_text(profile: dict[str, Any]) -> str:
    skills = profile.get("skills") or []
    if isinstance(skills, str):
        return skills
    return ", ".join(str(item) for item in skills if str(item).strip())


def _fallback_message(job: dict[str, Any], profile: dict[str, Any]) -> str:
    skills = _skills_text(profile)
    if skills:
        return f"您好，我对这个岗位比较感兴趣，我有相关的{skills}经验，想进一步了解岗位要求。"
    title = job.get("title") or "这个岗位"
    return f"您好，我对{title}比较感兴趣，想进一步了解岗位要求和团队情况。"


def _message_smoke_fallback() -> str:
    return "您好，我对这个岗位比较感兴趣，想进一步了解岗位要求和团队情况，期待与您沟通。"


def generate_apply_message(job: dict[str, Any], profile: dict[str, Any]) -> str:
    try:
        provider = get_ai_provider()
        message = provider.generate_message({"job": job, "profile": profile, "purpose": "jobradar_apply"})
        return message.replace("\n", " ").strip()[:160] or _fallback_message(job, profile)
    except Exception:
        return _fallback_message(job, profile)


def generate_message_smoke_message(job: dict[str, Any], profile: dict[str, Any]) -> str:
    try:
        provider = get_ai_provider()
        message = provider.generate_message({"job": job, "profile": profile, "purpose": "message_smoke"})
        return message.replace("\n", " ").strip()[:160] or _message_smoke_fallback()
    except Exception:
        return _message_smoke_fallback()


if __name__ == "__main__":
    sample_job = {"title": "AI视频设计师", "company_name": "示例公司", "city": "杭州"}
    sample_profile = {"skills": ["剪辑", "AI视频", "提示词"], "experience": "3年"}
    print(generate_apply_message(sample_job, sample_profile))

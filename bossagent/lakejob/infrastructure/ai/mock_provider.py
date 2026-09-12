"""Stable local AI provider for tests and default MVP behavior."""

from __future__ import annotations

from typing import Any

from .provider import AIProvider


def _tokens(value: Any) -> list[str]:
    if isinstance(value, list):
        values = value
    else:
        values = str(value or "").replace("，", ",").split(",")
    return [str(item).strip().lower() for item in values if str(item).strip()]


def _text(data: dict[str, Any]) -> str:
    parts = []
    for value in data.values():
        if isinstance(value, (dict, list)):
            parts.append(str(value))
        else:
            parts.append(str(value or ""))
    return " ".join(parts).lower()


class MockAIProvider(AIProvider):
    name = "mock"

    def parse_resume(self, text: str) -> dict[str, Any]:
        from lakejob.application.resumes.parser import parse_resume_text

        return parse_resume_text(text)

    def summarize_resume(self, parsed: dict[str, Any], raw_text: str) -> dict[str, Any]:
        from lakejob.application.resumes.parser import generate_resume_summary, score_resume

        return generate_resume_summary(parsed, score_resume(parsed))

    def score_candidate(self, candidate: dict[str, Any], job_profile: dict[str, Any] | None = None) -> dict[str, Any]:
        job_profile = job_profile or {}
        text = _text(candidate)
        skills = _tokens(job_profile.get("skills") or job_profile.get("keyword"))
        matched = [skill for skill in skills if skill in text]
        skill_score = 70.0 if not skills else 70.0 * len(matched) / len(skills)
        city = str(job_profile.get("city") or job_profile.get("regions") or "").strip().lower()
        city_score = 15.0 if not city or city in text else 0.0
        experience = str(job_profile.get("experience") or "").strip().lower()
        exp_score = 15.0 if not experience or experience in text else 0.0
        score = round(max(0.0, min(100.0, skill_score + city_score + exp_score)), 3)
        return {
            "score": score,
            "score_type": "mock",
            "summary": f"Mock matched {len(matched)}/{len(skills)} skills",
            "details": {"matched_skills": matched, "required_skills": skills, "provider": "mock"},
        }

    def score_job(self, job: dict[str, Any], user_profile: dict[str, Any] | None = None) -> dict[str, Any]:
        user_profile = user_profile or {}
        text = _text(job)
        skills = _tokens(user_profile.get("skills"))
        matched = [skill for skill in skills if skill in text]
        skill_score = 80.0 if not skills else 80.0 * len(matched) / len(skills)
        city = str(user_profile.get("city") or user_profile.get("regions") or "").strip().lower()
        city_score = 20.0 if not city or city in text else 0.0
        score = round(max(0.0, min(100.0, skill_score + city_score)), 3)
        return {
            "score": score,
            "score_type": "mock",
            "summary": f"Mock job matched {len(matched)}/{len(skills)} skills",
            "details": {"matched_skills": matched, "required_skills": skills, "provider": "mock"},
        }

    def analyze_candidate_match(self, candidate: dict[str, Any], job_profile: dict[str, Any]) -> dict[str, Any]:
        score = self.score_candidate(candidate, job_profile)
        matched = score.get("details", {}).get("matched_skills", [])
        missing = [skill for skill in score.get("details", {}).get("required_skills", []) if skill not in matched]
        return {
            "score": score["score"],
            "level": _level(score["score"]),
            "reasons": [score["summary"]],
            "strengths": [f"匹配技能：{', '.join(matched)}"] if matched else ["基础背景与岗位画像有一定相关性"],
            "risks": [f"待确认技能：{', '.join(missing)}"] if missing else [],
            "suggested_action": "进入人才库并人工复核后再沟通",
            "tags": matched[:5] or ["mock-analysis"],
            "ai_provider": "mock",
            "fallback_used": False,
        }

    def analyze_job_match(self, job: dict[str, Any], user_profile: dict[str, Any]) -> dict[str, Any]:
        score = self.score_job(job, user_profile)
        matched = score.get("details", {}).get("matched_skills", [])
        missing = [skill for skill in score.get("details", {}).get("required_skills", []) if skill not in matched]
        return {
            "score": score["score"],
            "level": _level(score["score"]),
            "reasons": [score["summary"]],
            "strengths": [f"岗位匹配技能：{', '.join(matched)}"] if matched else ["岗位与求职画像有基础相关性"],
            "risks": [f"需确认岗位是否覆盖：{', '.join(missing)}"] if missing else [],
            "suggested_action": "加入岗位池并人工查看岗位详情",
            "tags": matched[:5] or ["mock-analysis"],
            "ai_provider": "mock",
            "fallback_used": False,
        }

    def generate_message(self, context: dict[str, Any]) -> str:
        job = context.get("job") or {}
        profile = context.get("profile") or context.get("candidate") or {}
        skills = _tokens(profile.get("skills"))
        title = job.get("title") or context.get("title") or "这个岗位"
        if skills:
            return f"您好，我对{title}比较感兴趣，我有{skills[0]}相关经验，想进一步了解岗位要求。"
        return f"您好，我对{title}比较感兴趣，想进一步了解岗位要求和团队情况。"

    def generate_recruiter_message(
        self,
        candidate: dict[str, Any],
        recruiter_profile: dict[str, Any],
        match_analysis: dict[str, Any] | None = None,
    ) -> str:
        name = candidate.get("name") or "您好"
        title = recruiter_profile.get("job_title") or recruiter_profile.get("title") or "这个岗位"
        tags = (match_analysis or {}).get("tags") or _tokens(candidate.get("skills"))
        skill = tags[0] if tags else "相关经验"
        return _trim_100(f"{name}您好，我们在招聘{title}，看到您有{skill}相关背景，想和您简单沟通一下机会。")

    def generate_jobseeker_message(
        self,
        job: dict[str, Any],
        jobseeker_profile: dict[str, Any],
        match_analysis: dict[str, Any] | None = None,
    ) -> str:
        title = job.get("title") or "这个岗位"
        skills = _tokens(jobseeker_profile.get("skills"))
        skill = skills[0] if skills else "相关经验"
        return _trim_100(f"您好，我对{title}比较感兴趣，我有{skill}相关经验，想进一步了解岗位要求和团队情况。")

    def health_check(self) -> dict[str, Any]:
        return {"ok": True, "provider": "mock"}


def _level(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    return "C"


def _trim_100(message: str) -> str:
    return message.replace("\n", " ").strip()[:100]

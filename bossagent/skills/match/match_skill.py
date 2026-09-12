"""Application-facing match skill with provider-aware fallback metadata."""

from __future__ import annotations

from typing import Any, Callable

from .resume_jd_matcher import match_resume_to_jd


ProviderCall = Callable[[], dict[str, Any]]


class MatchSkill:
    """Use validated AI analysis, with an explicit evidence-based fallback."""

    def analyze(
        self,
        *,
        resume: dict[str, Any],
        job: dict[str, Any],
        perspective: str,
        ai_provider: str = "mock",
        provider_call: ProviderCall | None = None,
    ) -> dict[str, Any]:
        rule_result = match_resume_to_jd(resume, job, perspective=perspective)
        confidence = rule_result["confidence"]
        fallback_used = provider_call is not None
        error = ""
        if provider_call is not None:
            try:
                result = _parse_provider_result(provider_call(), rule_result)
                if confidence == "low":
                    fallback_used = True
                    error = "AI match result not used because candidate evidence is insufficient"
                    result = rule_result
                else:
                    fallback_used = False
            except Exception as exc:
                error = str(exc)
                result = rule_result
        else:
            result = rule_result

        if confidence == "low":
            result["strengths"] = []
            risks = _list_text(result.get("risks"))
            warning = "候选人详情不足，评分置信度较低"
            if warning not in risks:
                risks.append(warning)
            result["risks"] = risks
        result.update(
            {
                "ai_provider": ai_provider,
                "fallback_used": fallback_used,
                "error": error,
                "confidence": confidence,
                "score_type": "rule" if fallback_used or provider_call is None else "ai",
            }
        )
        return result

    def analyze_candidate_match(
        self,
        candidate: dict[str, Any],
        job_profile: dict[str, Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        return self.analyze(
            resume=candidate,
            job=job_profile,
            perspective="recruiter",
            **kwargs,
        )

    def analyze_job_match(
        self,
        job: dict[str, Any],
        user_profile: dict[str, Any],
        **kwargs: Any,
    ) -> dict[str, Any]:
        return self.analyze(
            resume=user_profile,
            job=job,
            perspective="jobseeker",
            **kwargs,
        )


def _parse_provider_result(data: Any, rule_result: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("AI match result must be an object")
    if "score" not in data:
        raise ValueError("AI match result missing score")
    try:
        score = float(data["score"])
    except (TypeError, ValueError) as exc:
        raise ValueError("AI match result has invalid score") from exc
    if not 0 <= score <= 100:
        raise ValueError("AI match score must be between 0 and 100")
    reasons = _list_text(data.get("explain") or data.get("reasons"))
    if not reasons:
        raise ValueError("AI match result missing reasons")
    if "strengths" not in data or "risks" not in data:
        raise ValueError("AI match result missing strengths or risks")

    level = str(data.get("level") or "").upper()
    if level not in {"A", "B", "C"}:
        level = "A" if score >= 85 else "B" if score >= 70 else "C"
    result = dict(rule_result)
    result.update(
        {
            "score": round(score, 3),
            "level": level,
            "explain": reasons,
            "strengths": _list_text(data.get("strengths")),
            "risks": _list_text(data.get("risks")),
            "suggested_action": str(data.get("suggested_action") or rule_result.get("suggested_action") or "").strip(),
            "matched_keywords": _list_text(data.get("matched_keywords") or data.get("tags")),
        }
    )
    return result


def _list_text(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").strip()
    return [text] if text else []

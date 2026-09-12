"""Compatible entry points for explainable candidate and job matching."""

from __future__ import annotations

from typing import Any

from ai.provider import get_ai_provider, load_ai_config
from skills.match.match_skill import MatchSkill
from skills.match.resume_jd_matcher import level_from_score


def normalize_analysis(data: dict[str, Any], *, provider: str = "mock", fallback_used: bool = False) -> dict[str, Any]:
    try:
        score = max(0.0, min(100.0, float(data.get("score", 0))))
    except (TypeError, ValueError):
        score = 0.0
    level = str(data.get("level") or "").upper()
    if level not in {"A", "B", "C"}:
        level = level_from_score(score)

    explain = _list_text(data.get("explain") or data.get("reasons"))
    matched = _list_text(data.get("matched_keywords") or data.get("tags"))
    result = {
        "score": round(score, 3),
        "level": level,
        "subscores": _dict_number(data.get("subscores")),
        "matched_keywords": matched,
        "missing_keywords": _list_text(data.get("missing_keywords")),
        "strengths": _list_text(data.get("strengths")),
        "risks": _list_text(data.get("risks")),
        "suggested_action": str(data.get("suggested_action") or "").strip(),
        "explain": explain,
        "ai_provider": str(data.get("ai_provider") or provider),
        "fallback_used": bool(data.get("fallback_used", fallback_used)),
        "confidence": _confidence(data.get("confidence")),
        "error": _safe_error(str(data.get("error") or "")),
    }
    # Compatibility for existing flows and stored match-score records.
    result["reasons"] = explain
    result["tags"] = matched
    score_type = str(data.get("score_type") or "").lower()
    result["score_type"] = score_type if score_type in {"rule", "ai", "hybrid"} else ("rule" if result["fallback_used"] else "ai")
    result["details"] = {
        "subscores": result["subscores"],
        "matched_keywords": matched,
        "missing_keywords": result["missing_keywords"],
        "explain": explain,
        "confidence": result["confidence"],
    }
    return result


def analyze_candidate_match(candidate: dict[str, Any], recruiter_profile: dict[str, Any]) -> dict[str, Any]:
    """HR direction: job profile/JD -> candidate resume."""
    provider_name = _provider_name()
    provider_call = _provider_method("analyze_candidate_match", candidate, recruiter_profile)
    data = MatchSkill().analyze(
        resume=candidate,
        job=recruiter_profile,
        perspective="recruiter",
        ai_provider=provider_name,
        provider_call=provider_call,
    )
    return normalize_analysis(data, provider=provider_name)


def analyze_job_match(job: dict[str, Any], jobseeker_profile: dict[str, Any]) -> dict[str, Any]:
    """Jobseeker direction: resume/user profile -> job JD."""
    provider_name = _provider_name()
    provider_call = _provider_method("analyze_job_match", job, jobseeker_profile)
    data = MatchSkill().analyze(
        resume=jobseeker_profile,
        job=job,
        perspective="jobseeker",
        ai_provider=provider_name,
        provider_call=provider_call,
    )
    return normalize_analysis(data, provider=provider_name)


def log_match_analysis(target_type: str, target_id: str, analysis: dict[str, Any]) -> str | None:
    payload = match_analysis_payload(target_type, target_id, analysis)
    try:
        from jobradar_log import log_event

        return log_event(
            "match analysis completed",
            level="warning" if analysis.get("fallback_used") else "info",
            log_type="audit",
            entity_type=target_type,
            entity_id=target_id,
            payload=payload,
        )
    except Exception as exc:
        print(f"WARN: failed to write match analysis log: {exc}")
        return None


def match_analysis_payload(target_type: str, target_id: str, analysis: dict[str, Any]) -> dict[str, Any]:
    normalized = normalize_analysis(analysis, provider=str(analysis.get("ai_provider") or _provider_name()))
    return {"match_analysis": True, "target_type": target_type, "target_id": target_id, **normalized}


def _provider_method(method_name: str, *args: dict[str, Any]):
    def call() -> dict[str, Any]:
        provider = get_ai_provider()
        method = getattr(provider, method_name)
        return method(*args)

    return call


def _provider_name() -> str:
    try:
        return str(load_ai_config().get("provider") or "mock")
    except Exception:
        return "mock"


def _list_text(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value or "").strip()
    return [text] if text else []


def _dict_number(value: Any) -> dict[str, float]:
    if not isinstance(value, dict):
        return {}
    result: dict[str, float] = {}
    for key, item in value.items():
        try:
            result[str(key)] = round(max(0.0, min(100.0, float(item))), 3)
        except (TypeError, ValueError):
            continue
    return result


def _safe_error(error: str) -> str:
    for token in ("DEEPSEEK_API_KEY", "Bearer "):
        error = error.replace(token, "[redacted]")
    return error[:300]


def _confidence(value: Any) -> str:
    confidence = str(value or "").lower()
    return confidence if confidence in {"high", "medium", "low"} else "low"

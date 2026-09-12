"""Unified matching for candidate-to-job and profile-to-job flows."""

from __future__ import annotations

from typing import Any

from .ats_score import calculate_ats_score


def level_from_score(score: float) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    return "C"


def match_resume_to_jd(
    resume: dict[str, Any],
    job: dict[str, Any],
    *,
    perspective: str = "jobseeker",
) -> dict[str, Any]:
    ats = calculate_ats_score(resume, job)
    gap = ats["keyword_gap"]
    score = ats["score"]
    matched = gap["matched_keywords"]
    missing = gap["missing_keywords"]
    strong = gap["strong_matches"]
    confidence = _confidence(resume)
    details_insufficient = confidence == "low"

    strengths: list[str] = []
    if strong:
        strengths.append(f"Strong keyword evidence: {', '.join(strong[:8])}.")
    elif matched:
        strengths.append(f"Matched JD keywords: {', '.join(matched[:8])}.")
    if ats["subscores"]["title_alignment"] >= 80:
        strengths.append("The supplied role/title evidence aligns with the JD.")
    if ats["subscores"]["location_fit"] == 100 and any(
        _known(resume.get(field)) for field in ("target_city", "city", "location", "regions")
    ) and any(_known(job.get(field)) for field in ("city", "location", "regions")):
        strengths.append("The supplied location preference matches the JD location.")

    risks: list[str] = []
    if missing and not details_insufficient:
        risks.append(f"No resume evidence found for JD keywords: {', '.join(missing[:10])}.")
    if ats["subscores"]["experience_fit"] < 60:
        risks.append("The stated experience is below the JD minimum.")
    elif ats["subscores"]["experience_fit"] == 60:
        risks.append("Experience evidence is incomplete and needs manual verification.")
    if ats["subscores"]["education_fit"] < 60:
        risks.append("The stated education is below the JD requirement.")
    elif ats["subscores"]["education_fit"] == 60:
        risks.append("Education evidence is incomplete and needs manual verification.")
    if ats["subscores"]["location_fit"] < 60:
        risks.append("The supplied location does not match the JD location.")
    if details_insufficient:
        risks.append("候选人详情不足，评分置信度较低")

    return {
        "score": score,
        "level": level_from_score(score),
        "subscores": ats["subscores"],
        "matched_keywords": matched,
        "missing_keywords": missing,
        "strengths": strengths,
        "risks": risks,
        "suggested_action": _suggested_action(score, perspective, bool(risks)),
        "explain": ats["explain"],
        "evidence": gap["evidence"],
        "perspective": perspective,
        "confidence": confidence,
    }


def _confidence(resume: dict[str, Any]) -> str:
    if not any(_known(resume.get(field)) for field in ("skills", "resume_text")):
        return "low"
    groups = (
        ("skills", "resume_text"),
        ("work_experience", "experience_text", "experience"),
        ("education", "education_text"),
        ("target_role", "target_job_title", "current_title", "title", "headline"),
        ("target_city", "city", "location", "regions"),
    )
    known = sum(1 for fields in groups if any(_known(resume.get(field)) for field in fields))
    if known >= 4:
        return "high"
    if known >= 2:
        return "medium"
    return "low"


def _known(value: Any) -> bool:
    return value not in (None, "", [], {}, "unknown", "Unknown", "UNKNOWN", "null", "N/A", "n/a")


def _suggested_action(score: float, perspective: str, has_risks: bool) -> str:
    subject = "candidate" if perspective == "recruiter" else "job"
    if score >= 85 and not has_risks:
        return f"Prioritize this {subject}, then verify the original resume and JD before action."
    if score >= 70:
        return f"Review the missing evidence for this {subject} before moving forward."
    return f"Do not auto-advance this {subject}; perform a manual evidence review first."


match_resume_jd = match_resume_to_jd

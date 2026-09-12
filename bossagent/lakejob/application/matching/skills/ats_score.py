"""ATS-style, explainable scoring built only from supplied evidence."""

from __future__ import annotations

import json
import re
from typing import Any

from .keyword_gap import keyword_gap


EDUCATION_LEVELS = {
    "高中": 1, "中专": 1, "大专": 2, "专科": 2, "本科": 3,
    "学士": 3, "硕士": 4, "研究生": 4, "博士": 5,
    "high school": 1, "associate": 2, "bachelor": 3, "master": 4, "phd": 5,
}


def calculate_ats_score(resume: dict[str, Any], job: dict[str, Any]) -> dict[str, Any]:
    gap = keyword_gap(job, resume)
    resume_has_skill_evidence = bool(gap["resume_keywords"])
    subscores = {
        "keyword_coverage": gap["coverage"] if resume_has_skill_evidence else 60.0,
        "title_alignment": _title_score(resume, job),
        "experience_fit": _experience_score(resume, job),
        "education_fit": _education_score(resume, job),
        "location_fit": _location_score(resume, job),
        "resume_completeness": _completeness_score(resume),
    }
    weights = {
        "keyword_coverage": 0.45,
        "title_alignment": 0.15,
        "experience_fit": 0.15,
        "education_fit": 0.10,
        "location_fit": 0.10,
        "resume_completeness": 0.05,
    }
    score = sum(subscores[name] * weight for name, weight in weights.items())
    explain = [
        (
            f"Keyword coverage: {len(gap['matched_keywords'])}/{len(gap['required_keywords'])} ({gap['coverage']:.1f}%)."
            if resume_has_skill_evidence
            else "Keyword coverage: candidate skill evidence is unknown; a neutral score is used."
        ),
        f"Title alignment: {subscores['title_alignment']:.1f}/100.",
        f"Experience fit: {subscores['experience_fit']:.1f}/100; unknown evidence receives a neutral score.",
        f"Education fit: {subscores['education_fit']:.1f}/100; unknown evidence receives a neutral score.",
        f"Location fit: {subscores['location_fit']:.1f}/100.",
        f"Resume completeness: {subscores['resume_completeness']:.1f}/100.",
    ]
    return {
        "score": round(max(0.0, min(100.0, score)), 3),
        "subscores": {key: round(value, 3) for key, value in subscores.items()},
        "weights": weights,
        "keyword_gap": gap,
        "explain": explain,
    }


def _title_score(resume: dict[str, Any], job: dict[str, Any]) -> float:
    candidate = _first(resume, "target_role", "target_job_title", "current_title", "title", "headline")
    target = _first(job, "job_title", "title", "target_role")
    if not target or not candidate:
        return 60.0
    left, right = _tokens(candidate), _tokens(target)
    if candidate.lower() in target.lower() or target.lower() in candidate.lower():
        return 100.0
    return 100.0 * len(left & right) / max(1, len(right))


def _experience_score(resume: dict[str, Any], job: dict[str, Any]) -> float:
    candidate = _years(_first(resume, "work_years", "experience_text", "experience", "work_experience"), requirement=False)
    required = _years(_first(job, "experience_requirement", "experience", "experience_text"), requirement=True)
    if required is None:
        return 100.0
    if candidate is None:
        return 60.0
    return 100.0 if candidate >= required else max(0.0, 100.0 * candidate / max(required, 1))


def _education_score(resume: dict[str, Any], job: dict[str, Any]) -> float:
    candidate = _education_level(_first(resume, "education", "education_text"))
    required = _education_level(_first(job, "education_requirement", "education", "education_text"))
    if required is None:
        return 100.0
    if candidate is None:
        return 60.0
    return 100.0 if candidate >= required else max(20.0, 100.0 * candidate / required)


def _location_score(resume: dict[str, Any], job: dict[str, Any]) -> float:
    candidate = _first(resume, "target_city", "city", "location", "regions")
    required = _first(job, "city", "location", "regions")
    if not required:
        return 100.0
    if not candidate:
        return 60.0
    left, right = candidate.lower(), required.lower()
    return 100.0 if left in right or right in left else 20.0


def _completeness_score(resume: dict[str, Any]) -> float:
    groups = (
        ("skills", "resume_text"),
        ("work_experience", "experience_text", "experience"),
        ("projects", "project_experience"),
        ("education", "education_text"),
        ("target_role", "target_job_title", "current_title", "title"),
    )
    present = sum(1 for fields in groups if _first(resume, *fields))
    return 100.0 * present / len(groups)


def _first(data: dict[str, Any], *fields: str) -> str:
    for field in fields:
        value = data.get(field)
        if value not in (None, "", [], {}, "unknown"):
            if isinstance(value, (dict, list)):
                return json.dumps(value, ensure_ascii=False, default=str)
            return str(value).strip()
    return ""


def _years(value: str, *, requirement: bool) -> float | None:
    numbers = [float(item) for item in re.findall(r"\d+(?:\.\d+)?", value or "")]
    if not numbers:
        return None
    return min(numbers) if requirement else max(numbers)


def _education_level(value: str) -> int | None:
    text = (value or "").lower()
    matches = [level for label, level in EDUCATION_LEVELS.items() if label in text]
    return max(matches) if matches else None


def _tokens(value: str) -> set[str]:
    ascii_tokens = re.findall(r"[a-z0-9+#.]+", value.lower())
    chinese_tokens = re.findall(r"[\u4e00-\u9fff]{2,}", value)
    return set(ascii_tokens + chinese_tokens)


score_ats = calculate_ats_score

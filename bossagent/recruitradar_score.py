"""RecruitRadar MVP candidate scoring."""

from __future__ import annotations

import argparse
import json
from typing import Any

from ai.provider import get_ai_provider
from recruitradar_log import add_match_score


def _tokens(value: Any) -> list[str]:
    if isinstance(value, list):
        items = value
    else:
        items = str(value or "").replace("，", ",").split(",")
    return [str(item).strip().lower() for item in items if str(item).strip()]


def _text(candidate: dict[str, Any]) -> str:
    fields = (
        "name",
        "headline",
        "current_company",
        "current_title",
        "city",
        "location",
        "experience_text",
        "education_text",
        "resume_text",
    )
    values = [str(candidate.get(field) or "") for field in fields]
    values.extend(str(item) for item in candidate.get("skills") or [])
    return " ".join(values).lower()


def score_candidate(candidate: dict[str, Any], requirements: dict[str, Any]) -> dict[str, Any]:
    text = _text(candidate)
    skills = _tokens(requirements.get("skills") or requirements.get("keyword"))
    regions = _tokens(requirements.get("regions"))
    experience = str(requirements.get("experience") or "").strip().lower()

    matched_skills = [skill for skill in skills if skill in text]
    skill_score = 70.0 if not skills else 70.0 * len(matched_skills) / len(skills)
    region_score = 15.0 if not regions or any(region in text for region in regions) else 0.0
    exp_score = 15.0 if not experience or experience in text else 0.0
    score = round(skill_score + region_score + exp_score, 3)

    return {
        "candidate": candidate,
        "score": score,
        "score_type": "rule",
        "summary": f"Matched {len(matched_skills)}/{len(skills)} skills",
        "details": {
            "matched_skills": matched_skills,
            "required_skills": skills,
            "region_matched": region_score > 0,
            "experience_matched": exp_score > 0,
        },
    }


def _ai_score_candidate(candidate: dict[str, Any], requirements: dict[str, Any]) -> dict[str, Any] | None:
    try:
        provider = get_ai_provider()
        result = provider.score_candidate(candidate, requirements)
        score = max(0.0, min(100.0, float(result.get("score", 0))))
        details = result.get("details") if isinstance(result.get("details"), dict) else {}
        return {
            "candidate": candidate,
            "score": round(score, 3),
            "score_type": str(result.get("score_type") or "ai"),
            "summary": str(result.get("summary") or "AI candidate match score"),
            "details": details,
        }
    except Exception:
        return None


def score_candidate_ai_first(candidate: dict[str, Any], requirements: dict[str, Any]) -> dict[str, Any]:
    return _ai_score_candidate(candidate, requirements) or score_candidate(candidate, requirements)


def score_and_save(
    candidates: list[dict[str, Any]],
    requirements: dict[str, Any],
    *,
    job_id: str | None = None,
) -> list[dict[str, Any]]:
    scored = [score_candidate_ai_first(candidate, requirements) for candidate in candidates]
    scored.sort(key=lambda item: item["score"], reverse=True)
    for item in scored:
        candidate_id = str(item["candidate"]["id"])
        item["match_score"] = add_match_score(
            candidate_id,
            item["score"],
            job_id=job_id,
            score_type=item["score_type"],
            summary=item["summary"],
            details=item["details"],
        )
    return scored


def main() -> None:
    parser = argparse.ArgumentParser(description="RecruitRadar MVP score candidates")
    parser.add_argument("--candidates-json", required=True)
    parser.add_argument("--skills", default="")
    parser.add_argument("--regions", default="")
    parser.add_argument("--experience", default="")
    parser.add_argument("--job-id")
    args = parser.parse_args()
    candidates = json.loads(args.candidates_json)
    requirements = {
        "skills": args.skills,
        "regions": args.regions,
        "experience": args.experience,
    }
    result = score_and_save(candidates, requirements, job_id=args.job_id)
    print(json.dumps({"ok": True, "candidates": result}, ensure_ascii=False, default=str, indent=2))


if __name__ == "__main__":
    main()

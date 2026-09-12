"""Convert grounded BOSS cards into existing Core-shaped dictionaries."""

from __future__ import annotations

import hashlib
from typing import Any

from lakejob.infrastructure.platforms.boss.mapper import boss_candidate_to_core, boss_job_to_core
from lakejob.infrastructure.vision.ui_grounder import GroundedElement, UIGrounder


class BossPageParser:
    def __init__(self, grounder: UIGrounder | None = None):
        self.grounder = grounder or UIGrounder()

    def parse_jobs(self, visual_result: dict[str, Any] | None, *, keyword: str, city: str) -> list[dict[str, Any]]:
        return [self._job(card, keyword=keyword, city=city) for card in self.grounder.ground(visual_result, "job_card")]

    def parse_candidates(self, visual_result: dict[str, Any] | None, *, keyword: str, city: str) -> list[dict[str, Any]]:
        return [self._candidate(card, keyword=keyword, city=city) for card in self.grounder.ground(visual_result, "candidate_card")]

    @staticmethod
    def _job(card: GroundedElement, *, keyword: str, city: str) -> dict[str, Any]:
        data = card.attributes
        external_id = str(data.get("external_job_id") or _visual_id("job", card, keyword, city))
        source_url = str(data.get("source_url") or f"vision://boss/jobs/{external_id}")
        raw = {
            "external_job_id": external_id,
            "platform_job_id": external_id,
            "source_url": source_url,
            "title": data.get("title") or card.text or "Untitled Job",
            "company": data.get("company") or data.get("company_name") or "",
            "salary": data.get("salary") or data.get("salary_text") or "",
            "city": data.get("city") or city,
            "experience": data.get("experience") or data.get("experience_text") or "",
            "education": data.get("education") or data.get("education_text") or "",
            "description": data.get("description") or card.text,
            "vision_metadata": {"bbox": list(card.bbox), "confidence": card.confidence},
            "raw_payload": {
                "source": "vision",
                "keyword": keyword,
                "bbox": list(card.bbox),
                "confidence": card.confidence,
                "card": data,
                "text": card.text,
            },
        }
        return boss_job_to_core(raw)

    @staticmethod
    def _candidate(card: GroundedElement, *, keyword: str, city: str) -> dict[str, Any]:
        data = card.attributes
        external_id = str(data.get("external_candidate_id") or _visual_id("candidate", card, keyword, city))
        source_url = str(data.get("source_url") or f"vision://boss/candidates/{external_id}")
        raw = {
            "external_candidate_id": external_id,
            "source_url": source_url,
            "name": data.get("name") or card.text or "Unknown Candidate",
            "headline": data.get("headline") or data.get("summary") or card.text,
            "current_company": data.get("current_company") or data.get("company") or "",
            "current_title": data.get("current_title") or data.get("title") or "",
            "city": data.get("city") or city,
            "location": data.get("location") or data.get("city") or city,
            "experience_text": data.get("experience") or data.get("experience_text") or "",
            "education_text": data.get("education") or data.get("education_text") or "",
            "skills": data.get("skills") or [],
            "resume_text": data.get("resume_text") or card.text,
            "vision_metadata": {"bbox": list(card.bbox), "confidence": card.confidence},
            "raw_data": {
                "source": "vision",
                "keyword": keyword,
                "bbox": list(card.bbox),
                "confidence": card.confidence,
                "card": data,
                "text": card.text,
            },
        }
        return boss_candidate_to_core(raw)


def _visual_id(prefix: str, card: GroundedElement, keyword: str, city: str) -> str:
    payload = f"{prefix}|{keyword}|{city}|{card.text}|{card.bbox}|{sorted(card.attributes.items())}"
    return f"vision-{prefix}-{hashlib.sha256(payload.encode('utf-8')).hexdigest()[:20]}"

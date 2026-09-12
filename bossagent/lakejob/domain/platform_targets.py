from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lakejob.domain.schemas import PlatformTarget


def platform_target_from_record(record: dict[str, Any]) -> PlatformTarget:
    metadata = record.get("metadata") if isinstance(record.get("metadata"), dict) else {}
    raw_confirmed = record.get("details_confirmed_at") or metadata.get("details_confirmed_at")
    confirmed_at = None
    if isinstance(raw_confirmed, datetime):
        confirmed_at = raw_confirmed
    elif raw_confirmed:
        confirmed_at = datetime.fromisoformat(str(raw_confirmed).replace("Z", "+00:00"))
    return PlatformTarget(
        platform=str(record.get("platform") or metadata.get("platform") or "boss"),
        source_url=record.get("source_url") or record.get("url"),
        platform_id=record.get("platform_job_id") or record.get("platform_candidate_id"),
        vision_locator=record.get("vision_locator") or metadata.get("vision_locator"),
        details_confirmed_at=confirmed_at,
        confirmation_evidence=record.get("confirmation_evidence") or metadata.get("confirmation_evidence") or {},
        can_real_apply=bool(record.get("can_real_apply") or metadata.get("can_real_apply")),
        can_real_message=bool(record.get("can_real_message") or metadata.get("can_real_message")),
        reason_if_not_actionable=str(
            record.get("reason_if_not_actionable") or metadata.get("reason_if_not_actionable") or ""
        ),
    )


def confirmed_target(*, platform: str, source_url: str, evidence: dict[str, Any], action: str) -> PlatformTarget:
    return PlatformTarget(
        platform=platform,
        source_url=source_url,
        details_confirmed_at=datetime.now(timezone.utc),
        confirmation_evidence=evidence,
        can_real_apply=action == "apply",
        can_real_message=action == "message",
        reason_if_not_actionable="",
    )

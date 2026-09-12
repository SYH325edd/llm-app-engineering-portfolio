from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class DTO(BaseModel):
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class ActionState(str, Enum):
    draft = "draft"
    pending_confirmation = "pending_confirmation"
    queued = "queued"
    blocked_by_safety = "blocked_by_safety"
    blocked_by_quota = "blocked_by_quota"
    sending = "sending"
    sent = "sent"
    applying = "applying"
    applied = "applied"
    failed = "failed"
    cancelled = "cancelled"


class JobRecord(DTO):
    id: str | None = None
    platform: str = "boss"
    platform_job_id: str | None = None
    source_url: str | None = None
    title: str = ""
    company_name: str = ""
    city: str = ""
    description: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class CandidateRecord(DTO):
    id: str | None = None
    platform: str = "boss"
    platform_candidate_id: str | None = None
    source_url: str | None = None
    name: str = ""
    current_title: str = ""
    city: str = ""
    skills: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class SearchQuery(DTO):
    keyword: str = Field(min_length=1)
    job_title: str = ""
    skills: list[str] = Field(default_factory=list)
    regions: list[str] = Field(default_factory=list)
    experience: str = ""
    limit: int = Field(default=20, ge=1, le=100)


class PlatformTarget(DTO):
    platform: str
    source_url: str | None = None
    platform_id: str | None = None
    vision_locator: dict[str, Any] | None = None
    details_confirmed_at: datetime | None = None
    confirmation_evidence: dict[str, Any] = Field(default_factory=dict)
    can_real_apply: bool = False
    can_real_message: bool = False
    reason_if_not_actionable: str = "details_not_confirmed"

    @model_validator(mode="after")
    def fail_closed(self) -> "PlatformTarget":
        visual_only = not self.source_url or self.source_url.startswith("vision://")
        confirmed = self.details_confirmed_at is not None and bool(self.confirmation_evidence)
        if visual_only or not confirmed:
            self.can_real_apply = False
            self.can_real_message = False
            self.reason_if_not_actionable = (
                "vision_result_requires_detail_confirmation" if visual_only else "details_not_confirmed"
            )
        return self

    def require(self, action: Literal["apply", "message"]) -> None:
        allowed = self.can_real_apply if action == "apply" else self.can_real_message
        if not allowed:
            raise PermissionError(self.reason_if_not_actionable or f"target_not_actionable_for_{action}")


class SafetyDecision(DTO):
    allowed: bool
    reason: str = ""
    delay_seconds: float = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class QuotaDecision(DTO):
    allowed: bool
    reason: str = ""
    remaining: int | None = None
    consumed: int = 0
    metadata: dict[str, Any] = Field(default_factory=dict)


class MessageDraft(DTO):
    id: str | None = None
    target_id: str
    content: str = Field(min_length=1, max_length=300)
    state: ActionState = ActionState.draft
    draft_only: bool = True


class ActionResult(DTO):
    success: bool = False
    state: ActionState = ActionState.draft
    dry_run: bool = True
    blocked: bool = False
    reason: str = ""
    error: str = ""
    evidence: dict[str, Any] = Field(default_factory=dict)


class VisionElement(DTO):
    element_type: str
    bbox: tuple[float, float, float, float]
    confidence: float = Field(ge=0, le=1)
    text: str = ""
    locator: dict[str, Any] = Field(default_factory=dict)


class VisionSearchResult(DTO):
    elements: list[VisionElement] = Field(default_factory=list)
    screenshot_path: str | None = None
    viewport_width: int = Field(default=0, ge=0)
    viewport_height: int = Field(default=0, ge=0)
    dry_run: bool = True


class SearchResult(DTO):
    query: SearchQuery
    jobs: list[JobRecord] = Field(default_factory=list)
    candidates: list[CandidateRecord] = Field(default_factory=list)
    vision: VisionSearchResult | None = None

"""Ground OCR/VLM output into screen coordinates."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


ALIASES = {
    "search_box": {"search_box", "keyword_input", "search_input"},
    "city_box": {"city_box", "city_input", "location_input"},
    "city_option": {"city_option", "location_option"},
    "search_button": {"search_button", "submit_search", "search_submit"},
    "job_card": {"job_card", "position_card"},
    "candidate_card": {"candidate_card", "talent_card"},
}


@dataclass(frozen=True)
class GroundedElement:
    kind: str
    center_x: float
    center_y: float
    bbox: tuple[float, float, float, float]
    text: str = ""
    confidence: float = 0.0
    attributes: dict[str, Any] = field(default_factory=dict)


class UIGrounder:
    """Normalize provider-specific element lists into stable UI concepts."""

    def ground(self, visual_result: dict[str, Any] | None, kind: str) -> list[GroundedElement]:
        wanted = ALIASES.get(kind, {kind})
        elements = (visual_result or {}).get("elements") or []
        grounded: list[GroundedElement] = []
        for raw in elements:
            raw_kind = str(raw.get("kind") or raw.get("type") or raw.get("label") or "").lower()
            if raw_kind not in wanted:
                continue
            bbox = _bbox(raw)
            if bbox is None:
                continue
            left, top, right, bottom = bbox
            grounded.append(
                GroundedElement(
                    kind=kind,
                    center_x=(left + right) / 2,
                    center_y=(top + bottom) / 2,
                    bbox=bbox,
                    text=str(raw.get("text") or ""),
                    confidence=float(raw.get("confidence") or 0.0),
                    attributes=dict(raw.get("attributes") or raw.get("data") or {}),
                )
            )
        return sorted(grounded, key=lambda item: item.confidence, reverse=True)

    def first(self, visual_result: dict[str, Any] | None, kind: str) -> GroundedElement | None:
        matches = self.ground(visual_result, kind)
        return matches[0] if matches else None

    @staticmethod
    def validate_click(
        element: GroundedElement,
        *,
        viewport_width: float,
        viewport_height: float,
        minimum_confidence: float = 0.55,
    ) -> None:
        if element.kind not in ALIASES:
            raise ValueError(f"unsupported clickable element type: {element.kind}")
        if element.confidence < minimum_confidence:
            raise ValueError(f"element confidence below threshold: {element.confidence:.3f}")
        left, top, right, bottom = element.bbox
        if left < 0 or top < 0 or right > viewport_width or bottom > viewport_height:
            raise ValueError("element bbox is outside the viewport")


def _bbox(raw: dict[str, Any]) -> tuple[float, float, float, float] | None:
    value = raw.get("bbox") or raw.get("box")
    if isinstance(value, dict):
        left = value.get("left", value.get("x"))
        top = value.get("top", value.get("y"))
        width = value.get("width")
        height = value.get("height")
        right = value.get("right", float(left) + float(width) if left is not None and width is not None else None)
        bottom = value.get("bottom", float(top) + float(height) if top is not None and height is not None else None)
        value = [left, top, right, bottom]
    if not isinstance(value, (list, tuple)) or len(value) != 4 or any(item is None for item in value):
        return None
    left, top, right, bottom = (float(item) for item in value)
    if right <= left or bottom <= top:
        return None
    return left, top, right, bottom

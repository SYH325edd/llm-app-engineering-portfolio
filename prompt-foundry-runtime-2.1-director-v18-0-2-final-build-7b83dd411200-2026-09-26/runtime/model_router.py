from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ModelRouter:
    """Logical model profiles. All profiles may point to the same provider initially."""

    default_model: Any
    extraction_model: Any | None = None
    structure_model: Any | None = None
    direction_model: Any | None = None
    repair_model: Any | None = None

    def for_stage(self, stage: str) -> Any:
        if stage in {"story_bible", "pvb_character", "psb_scene", "style_guide"}:
            return self.extraction_model or self.default_model
        if stage in {"scene_plan", "script_scene", "storyboard_scene", "storyboard_redistribution_fragment"}:
            return self.structure_model or self.default_model
        if stage in {"production_semantics_shot", "director_scene_context", "director_shot"}:
            return self.direction_model or self.default_model
        if stage.endswith("_repair"):
            return self.repair_model or self.default_model
        return self.default_model

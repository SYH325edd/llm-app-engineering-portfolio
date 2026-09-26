from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class ModelStageIOContract:
    """Machine-readable outer I/O contract for one model stage.

    Semantic field validation remains owned by the stage module. This registry
    only enforces the model-response envelope so malformed roots cannot be
    silently discarded before stage validation.
    """

    model_stage: str
    output_root_key: str | None = None


MODEL_STAGE_IO: dict[str, ModelStageIOContract] = {
    "story_bible": ModelStageIOContract("story_bible", None),
    "scene_plan": ModelStageIOContract("scene_plan", None),
    "script_scene": ModelStageIOContract("script_scene", "scene"),
    "storyboard_scene": ModelStageIOContract("storyboard_scene", "scene"),
    "storyboard_redistribution_fragment": ModelStageIOContract("storyboard_redistribution_fragment", "replacement"),
    "pvb_character": ModelStageIOContract("pvb_character", "character"),
    "psb_scene": ModelStageIOContract("psb_scene", "scene"),
    "style_guide": ModelStageIOContract("style_guide", None),
    "production_semantics_shot": ModelStageIOContract("production_semantics_shot", "production_semantics"),
    "director_scene_context": ModelStageIOContract("director_scene_context", "scene_director_context"),
    "director_shot": ModelStageIOContract("director_shot", "director"),
}


def extract_model_stage_output(model_stage: str, raw: Any) -> tuple[Any, list[dict[str, Any]]]:
    contract = MODEL_STAGE_IO.get(model_stage)
    if not isinstance(raw, dict):
        return raw, [{
            "type": "model_output_envelope_mismatch",
            "path": "$",
            "detail": f"{model_stage} model output root must be a JSON object",
            "expected": "JSON object",
            "actual_type": type(raw).__name__,
        }]
    if contract is None or contract.output_root_key is None:
        return raw, []

    expected_key = contract.output_root_key
    actual_keys = set(raw)
    expected_keys = {expected_key}
    errors: list[dict[str, Any]] = []
    if actual_keys != expected_keys:
        missing = sorted(expected_keys - actual_keys)
        extra = sorted(actual_keys - expected_keys)
        errors.append({
            "type": "model_output_envelope_mismatch",
            "path": "$",
            "detail": (
                f"{model_stage} output must contain exactly root key {expected_key!r}; "
                f"missing={missing}, extra={extra}"
            ),
            "expected_keys": sorted(expected_keys),
            "actual_keys": sorted(actual_keys),
        })
    return raw.get(expected_key), errors

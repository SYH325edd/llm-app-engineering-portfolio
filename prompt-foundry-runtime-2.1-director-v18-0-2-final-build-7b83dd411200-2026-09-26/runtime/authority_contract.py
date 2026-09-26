from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True, slots=True)
class FieldAuthority:
    """Machine-readable semantic authority class for model-owned fields.

    hard_verifiable=True means Runtime can deterministically prove the invariant
    without pretending lexical similarity is semantic understanding.
    """

    mode: str
    hard_verifiable: bool
    description: str


EXACT_SOURCE = FieldAuthority(
    "exact_source", True,
    "Value must be an exact substring of the declared source authority.",
)
SOURCE_BOUND_FACT = FieldAuthority(
    "source_bound_fact", True,
    "Fact must be established by its explicit source-evidence window.",
)
SOURCE_DERIVED_FACT = FieldAuthority(
    "source_derived_fact", False,
    "Optional semantic fact summary derived from exact local provenance; weak lexical support is omitted rather than blocking the pipeline.",
)
SOURCE_DERIVED_ATTRIBUTE = FieldAuthority(
    "source_derived_attribute", False,
    "Normalized attribute derived from exact local provenance; lexical overlap is advisory, while provenance binding remains hard.",
)
SEMANTIC_SUMMARY = FieldAuthority(
    "semantic_summary", False,
    "Editorial/structural summary; source refs are authoritative and lexical overlap is advisory only.",
)
SEMANTIC_TRANSFORM = FieldAuthority(
    "semantic_transform", False,
    "Model transforms a validated upstream authority into a new production representation; lexical overlap is advisory, while refs/provenance remain hard.",
)
FROZEN_UPSTREAM = FieldAuthority(
    "frozen_upstream", True,
    "Value must remain inside a previously validated upstream semantic authority.",
)
FROZEN_SOURCE_ALLOCATION = FieldAuthority(
    "frozen_source_allocation", True,
    "Upstream source text is frozen; the model may choose only ordered allocation/segment boundaries while Runtime restores exact source representation.",
)
DESIGN_FILL = FieldAuthority(
    "design_fill", True,
    "Authorized production-design space; structure/nonblank policy is hard, source lexical anchoring is not required.",
)
PROGRAM_OWNED = FieldAuthority(
    "program_owned", True,
    "Derived or injected by Runtime; model output is ignored/overwritten.",
)


STAGE_FIELD_AUTHORITY: dict[str, dict[str, FieldAuthority]] = {
    "story_bible": {
        "*.explicit_facts[]": SOURCE_DERIVED_FACT,
        "*.identity_lock.*": SOURCE_DERIVED_ATTRIBUTE,
        "*.visual_lock.*": SOURCE_BOUND_FACT,
        "*.source_evidence": EXACT_SOURCE,
        "stable_ids": PROGRAM_OWNED,
    },
    "scene_plan": {
        "scenes[].source_refs": EXACT_SOURCE,
        "scenes[].beat_list[].source_refs": EXACT_SOURCE,
        "scenes[].beat_list[].description": SEMANTIC_SUMMARY,
        "scenes[].dramatic_goal": SEMANTIC_SUMMARY,
        "scenes[].conflict": SEMANTIC_SUMMARY,
        "scenes[].turning_point": SEMANTIC_SUMMARY,
        "scene_id/beat_id/resume_context_ref": PROGRAM_OWNED,
    },
    "script_scene": {
        "scene.scene_heading": SEMANTIC_SUMMARY,
        "scene.scene_description": SEMANTIC_SUMMARY,
        "scene.beats[].description": SEMANTIC_SUMMARY,
        "scene.beats[].dialogue[].line": EXACT_SOURCE,
        "scene.beats[].narration[]": EXACT_SOURCE,
        "scene_id/location_ref/context_ref/beat_id": PROGRAM_OWNED,
    },
    "storyboard_scene": {
        "scene.shots[].description": SEMANTIC_TRANSFORM,
        "scene.shots[].dialogue": FROZEN_SOURCE_ALLOCATION,
        "scene.shots[].narration": FROZEN_SOURCE_ALLOCATION,
        "scene.shots[].source_evidence[].quote": EXACT_SOURCE,
        "shot_id/scene_id/location_ref/context_ref": PROGRAM_OWNED,
    },
    "pvb_character": {
        "character.visual_identity.*": DESIGN_FILL,
        "character.wardrobe.*": DESIGN_FILL,
        "metadata": PROGRAM_OWNED,
    },
    "psb_scene": {
        "scene.production_visual.*": DESIGN_FILL,
        "metadata": PROGRAM_OWNED,
    },
    "style_guide": {
        "*": DESIGN_FILL,
    },
    "production_semantics_shot": {
        "production_semantics.visual_events[].action": SEMANTIC_TRANSFORM,
        "production_semantics.*.source_evidence[].quote": EXACT_SOURCE,
        "production_semantics.dialogue": PROGRAM_OWNED,
    },
    "director_shot": {
        "director.performance_actions": FROZEN_UPSTREAM,
        "director.action_delta": FROZEN_UPSTREAM,
        "director.continuity_scope.mode/inherit_paths": FROZEN_UPSTREAM,
        "director.continuity_scope.inherit": PROGRAM_OWNED,
        "director.state_out/speaker_target_refs": PROGRAM_OWNED,
    },
}


def authority_manifest(model_stage: str) -> dict[str, dict[str, Any]]:
    return {
        path: {
            "mode": policy.mode,
            "hard_verifiable": policy.hard_verifiable,
            "description": policy.description,
        }
        for path, policy in STAGE_FIELD_AUTHORITY.get(model_stage, {}).items()
    }

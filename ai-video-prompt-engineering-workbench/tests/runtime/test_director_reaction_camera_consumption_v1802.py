from __future__ import annotations

import copy

from runtime.context_builder import ContextBuilder
from runtime.director_context_effect import build_shot_context_effect_audit
from runtime.stages.director import (
    CONTRACT_VERSION,
    SOFT_QUALITY_ERROR_TYPES,
    SYSTEM_PROMPT,
    build_director_shot_payload,
    canonicalize_director_fragment,
    validate_director_fragment,
)
from tests.api.fixtures.mock_story_run import RESPONSES


def _context() -> dict:
    builder = ContextBuilder(
        story_bible=copy.deepcopy(RESPONSES["story_bible"]),
        script=copy.deepcopy(RESPONSES["script"]),
        storyboard_base=copy.deepcopy(RESPONSES["storyboard_base"]),
    )
    semantics = {
        "shot_id": "SH001",
        "visual_events": [{
            "action": "阿宁站在窗边，手里拿着信封。",
            "character_refs": ["char_001"],
            "prop_refs": ["prop_001"],
            "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
        }],
        "dialogue": [{
            "character_id": "char_001",
            "text": "你来了。",
            "frozen_text_unit_id": "FTU_B001_D001",
        }],
        "production_choices": [],
        "appearance_overlays": [],
    }
    ctx = builder.director_context(
        "SH001",
        previous_state_out={"characters": {}, "props": {}, "environment": {}},
        production_semantics=semantics,
    )
    # Synthetic second current-shot character used only to verify the Director's
    # visual-subject freedom. No story facts are added to the production fixture.
    program = ctx["program_owned"]
    program["allowed_character_refs"] = ["char_001", "char_002"]
    program["speaker_target_refs"] = ["char_001"]
    program["reaction_opportunity"] = True
    program["scene_position"] = "reaction"
    program["scene_position_source"] = "scene_context"
    program["scene_context_status"] = "available"
    program["scene_director_context"] = {
        "emotional_arc": [{"phase_id": "P1", "shot_refs": ["SH001"], "function": "reaction"}],
    }
    program["scene_camera_baseline"] = {
        "stability": "stable",
        "framing_tendency": "medium_dominant",
        "movement_policy": "mostly_static",
    }
    program["previous_shot_design"] = {
        "shot_id": "SH000",
        "shot_size": "medium",
        "camera": "eye_level",
        "movement": "static",
        "execution_framing": {"framing_type": "single"},
    }
    program["next_shot_purpose"] = {"scene_position": "reveal"}
    return ctx


def _reaction_director(ctx: dict) -> dict:
    raw = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
    raw["shot_purpose"] = "reaction"
    raw["scene_position"] = "reaction"
    raw["scene_context_usage"] = ["reaction_strategy", "camera_strategy"]
    raw["primary_subject_refs"] = ["char_002"]
    raw["reaction_target_refs"] = ["char_002"]
    raw["visual_target"] = {
        "target_type": "reaction",
        "character_refs": ["char_002"],
        "prop_refs": [],
        "environment_keys": [],
    }
    raw["visual_focus"] = {
        "focus_type": "reaction",
        "subject_refs": ["char_002"],
        "body_regions": {},
        "prop_refs": [],
        "environment_keys": [],
    }
    raw["execution_framing"] = {"framing_type": "reaction", "foreground_character_refs": []}
    raw["execution_shot_design"] = {"shot_size": "close", "camera": "low_angle", "movement": "static"}
    raw.pop("camera_execution", None)
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    return canonical


def test_v1802_reaction_candidate_is_explicit_and_listener_visual_does_not_rebind_dialogue_owner():
    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id="director:SH001", is_first_global_shot=True)
    program = payload["program_owned"]

    assert CONTRACT_VERSION == "director_shot.v18_0_2"
    assert program["reaction_opportunity"] is True
    assert program["speaker_target_refs"] == ["char_001"]
    assert program["reaction_candidate_refs"] == ["char_002"]

    director = _reaction_director(ctx)
    assert director["primary_subject_refs"] == ["char_002"]
    assert director["reaction_target_refs"] == ["char_002"]
    assert director["visual_target"]["character_refs"] == ["char_002"]
    assert program["speaker_target_refs"] == ["char_001"]
    assert ctx["production_semantics"]["dialogue"][0]["character_id"] == "char_001"

    hard = [
        error for error in validate_director_fragment(director, ctx, is_first_global_shot=True)
        if error.get("type") not in SOFT_QUALITY_ERROR_TYPES
    ]
    assert not hard, hard


def test_v1802_model_facing_template_no_longer_prefills_base_camera_or_single_character_answer():
    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id="director:SH001", is_first_global_shot=True)
    template = payload["output_template"]["director"]

    assert template["shot_purpose"] == ""
    assert template["scene_position"] == ""
    assert template["visual_target"]["target_type"] == ""
    assert template["execution_framing"]["framing_type"] == ""
    assert template["execution_shot_design"] == {"shot_size": "", "camera": "", "movement": ""}
    assert template["camera_execution"]["shot_size"] == ""
    assert template["camera_execution"]["camera"] == ""
    assert template["camera_execution"]["movement"] == ""

    # The fallback remains present as input context, but is no longer copied into
    # the model-facing answer template.
    assert payload["program_owned"]["base_execution_fallback"]["camera"] == "eye_level"
    assert "output_template 中 creative enum 的空字符串只是结构占位" in SYSTEM_PROMPT


def test_v1802_camera_execution_can_deviate_from_base_without_runtime_overwrite_and_audit_observes_reaction():
    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id="director:SH001", is_first_global_shot=True)
    director = _reaction_director(ctx)

    assert director["execution_shot_design"] == {
        "shot_size": "close",
        "camera": "low_angle",
        "movement": "static",
    }
    assert director["execution_framing"]["framing_type"] == "reaction"

    audit = build_shot_context_effect_audit(payload["shot"], director, payload["program_owned"])
    assert audit["reaction_opportunity"] is True
    assert audit["reaction_candidate_available"] is True
    assert audit["reaction_visualized"] is True
    assert audit["base_to_execution_delta"]["shot_size_changed"] is True
    assert audit["base_to_execution_delta"]["camera_changed"] is True

    assert "必须先显式比较两个合法视觉方案" in SYSTEM_PROMPT
    assert "先确定 scene_position 与 visual subject" in SYSTEM_PROMPT


def test_v1802_multi_character_reaction_candidates_are_precision_first_and_ambiguous_group_stays_empty():
    ctx = _context()
    program = ctx["program_owned"]
    program["allowed_character_refs"] = ["char_001", "char_002", "char_003"]
    program["speaker_target_refs"] = ["char_001"]
    program["scene_director_context"] = {
        "emotional_arc": [{"phase_id": "P1", "shot_refs": ["SH001"], "function": "reaction"}],
        "relationship_dynamics": [],
    }

    payload = build_director_shot_payload(ctx, unit_id="director:SH001", is_first_global_shot=True)
    assert payload["program_owned"]["reaction_candidate_refs"] == []

    director = {
        "primary_subject_refs": ["char_003"],
        "reaction_target_refs": ["char_003"],
        "visual_target": {"character_refs": ["char_003"], "prop_refs": []},
        "execution_framing": {"framing_type": "single"},
        "execution_shot_design": {"shot_size": "medium", "camera": "eye_level", "movement": "static"},
        "scene_context_usage": ["reaction_strategy"],
        "scene_position": "reaction",
    }
    audit = build_shot_context_effect_audit(payload["shot"], director, payload["program_owned"])
    assert audit["reaction_candidate_available"] is False
    assert audit["reaction_visualized"] is False


def test_v1802_multi_character_reaction_candidate_uses_semantic_listener_or_shot_local_reaction_evidence():
    ctx = _context()
    program = ctx["program_owned"]
    program["allowed_character_refs"] = ["char_001", "char_002", "char_003"]
    program["speaker_target_refs"] = ["char_001"]
    program["scene_director_context"] = {
        "emotional_arc": [{"phase_id": "P1", "shot_refs": ["SH001"], "function": "reaction"}],
        "relationship_dynamics": [{
            "character_refs": ["char_001", "char_002"],
            "relation_mode": "speaker_listener",
            "power_balance": "balanced",
            "evidence_sources": [],
        }],
    }

    relation_payload = build_director_shot_payload(ctx, unit_id="director:SH001", is_first_global_shot=True)
    assert relation_payload["program_owned"]["reaction_candidate_refs"] == ["char_002"]

    # A uniquely attributable shot-local natural reaction is stronger than the
    # scene-level speaker_listener baseline and should select that character only.
    ctx_with_evidence = copy.deepcopy(ctx)
    ctx_with_evidence["production_semantics"]["production_choices"] = [{
        "type": "natural_reaction",
        "choice": "char_003 保持当前可见反应。",
        "affected_character_refs": ["char_003"],
        "affected_prop_refs": [],
        "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
    }]
    evidence_payload = build_director_shot_payload(
        ctx_with_evidence, unit_id="director:SH001", is_first_global_shot=True
    )
    assert evidence_payload["program_owned"]["reaction_candidate_refs"] == ["char_003"]

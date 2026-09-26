from __future__ import annotations

import copy

from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d
from runtime.production_readiness import validate_production_readiness
from runtime.shot_manifest import render_shot_prompt
from tests.runtime.test_production_closeout_v1 import _pvb, _script, _semantics, _shot, _story, _style


def _compile(shot: dict, semantics: dict | None = None):
    return compile_shot_consumption_prompt_v2d(
        shot,
        semantics if semantics is not None else _semantics(),
        _story(),
        _script(),
        _pvb(),
        {"scenes": []},
        _style(),
    )


def test_v2l_exact_authorized_action_overlap_is_deduped_before_readiness():
    shot = _shot()
    action = "年轻人把鞋翻过来，对着光看了看"
    shot["source_evidence"] = [{"quote": action}]
    shot["director"]["performance_actions"] = [{
        "character_ref": "char_001",
        "action": action,
        "source_evidence": [{"quote": action}],
    }]
    shot["director"]["performance_execution"] = [{
        "character_ref": "char_001",
        "movement": action,
    }]
    semantics = _semantics()
    semantics["visual_events"] = [{
        "action": action,
        "character_refs": ["char_001"],
        "prop_refs": [],
        "source_evidence": [{"quote": action}],
    }]

    result = _compile(shot, semantics)
    manifest = result["shot_consumption_manifest"]
    normalized = manifest["visual_content"].replace("，", "").replace("。", "").replace("；", "")
    needle = action.replace("，", "").replace("。", "").replace("；", "")
    assert normalized.count(needle) == 1

    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot],
        script=None,
    )
    assert not [e for e in readiness["errors"] if e.get("type") == "production_text_duplicate_clause"]


def test_v4_10_residual_duplicate_clause_is_quality_warning_not_compile_blocker():
    shot = _shot()
    result = _compile(shot)
    manifest = result["shot_consumption_manifest"]
    manifest["visual_content"] = "年轻人抬眼。年轻人抬眼。整体视觉基调：写实。"
    result["prompt_seedance"] = render_shot_prompt(manifest)

    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot],
        script=None,
    )
    assert not [e for e in readiness["errors"] if e.get("type") == "production_text_duplicate_clause"]
    assert [w for w in readiness["warnings"] if w.get("type") == "production_text_duplicate_clause"]


def test_v4_10_three_shot_camera_repetition_is_quality_warning_not_compile_blocker():
    shots = []
    prompts = []
    purposes = ["establishing", "observation", "transition"]
    target_types = ["character", "prop", "environment"]
    for index in range(3):
        shot = copy.deepcopy(_shot())
        shot["shot_id"] = f"SH{index + 1:03d}"
        shot["director"]["shot_purpose"] = purposes[index]
        shot["director"]["visual_target"] = {
            "target_type": target_types[index],
            "character_refs": ["char_001"] if index == 0 else [],
            "prop_refs": ["prop_001"] if index == 1 else [],
        }
        shots.append(shot)
        result = _compile(shot)
        result["shot_id"] = shot["shot_id"]
        result["shot_consumption_manifest"]["shot_id"] = shot["shot_id"]
        result["prompt_seedance"] = render_shot_prompt(result["shot_consumption_manifest"])
        prompts.append(result)

    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": prompts, "character_prompts": [], "scene_prompts": []},
        shot_specs=shots,
        script=None,
    )
    assert not [e for e in readiness["errors"] if e.get("type") == "camera_language_repetition_without_continuity_reason"]
    assert [w for w in readiness["warnings"] if w.get("type") == "camera_language_repetition_without_continuity_reason"]

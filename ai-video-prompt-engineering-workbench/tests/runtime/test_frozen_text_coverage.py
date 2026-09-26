from __future__ import annotations

import copy

from runtime.frozen_text_coverage import (
    build_frozen_text_coverage_manifest,
    validate_frozen_text_coverage,
)


def _script() -> dict:
    return {
        "scenes": [
            {
                "scene_id": "SC001",
                "beats": [{
                    "beat_id": "B001",
                    "dialogue": [
                        {"character_id": "char_001", "line": "先听我说。"},
                        {"character_id": "char_001", "line": "这件事还没结束。"},
                    ],
                    "narration": ["雨停了。人群散开。"],
                }],
            },
            {
                "scene_id": "SC002",
                "beats": [{
                    "beat_id": "B001",
                    "dialogue": [{"character_id": "char_002", "line": "我知道。"}],
                    "narration": ["天色暗下来。"],
                }],
            },
        ]
    }


def _tracked_layer() -> tuple[dict, list[dict], dict]:
    storyboard = {
        "scenes": [
            {"scene_id": "SC001", "shots": [
                {"shot_id": "SH001", "scene_id": "SC001", "frozen_text_unit_refs": {
                    "dialogue": ["FTU_B001_D001", "FTU_B001_D002"],
                    "narration": ["FTU_B001_N001", "FTU_B001_N002"],
                }},
            ]},
            {"scene_id": "SC002", "shots": [
                {"shot_id": "SH002", "scene_id": "SC002", "frozen_text_unit_refs": {
                    "dialogue": ["FTU_B001_D001"],
                    "narration": ["FTU_B001_N001"],
                }},
            ]},
        ]
    }
    shot_specs = [
        copy.deepcopy(storyboard["scenes"][0]["shots"][0]),
        copy.deepcopy(storyboard["scenes"][1]["shots"][0]),
    ]
    compiled = {
        "shot_prompts": [
            {"scene_id": item["scene_id"], "shot_consumption_manifest": {"provenance": {
                "frozen_text_unit_refs": copy.deepcopy(item["frozen_text_unit_refs"])
            }}}
            for item in shot_specs
        ]
    }
    return storyboard, shot_specs, compiled


def test_frozen_text_coverage_uses_scene_scoped_unit_identity_and_passes_exact_chain():
    storyboard, shot_specs, compiled = _tracked_layer()
    manifest = build_frozen_text_coverage_manifest(_script(), storyboard, shot_specs, compiled)
    assert manifest["passed"] is True
    assert manifest["expected"]["dialogue"] == [
        "SC001::FTU_B001_D001", "SC001::FTU_B001_D002", "SC002::FTU_B001_D001",
    ]
    assert validate_frozen_text_coverage(manifest) == []


def test_frozen_text_coverage_hard_fails_missing_duplicate_or_reordered_downstream_units():
    storyboard, shot_specs, compiled = _tracked_layer()
    compiled["shot_prompts"][0]["shot_consumption_manifest"]["provenance"]["frozen_text_unit_refs"]["dialogue"] = [
        "FTU_B001_D002", "FTU_B001_D001", "FTU_B001_D001",
    ]
    manifest = build_frozen_text_coverage_manifest(_script(), storyboard, shot_specs, compiled)
    errors = validate_frozen_text_coverage(manifest)
    compiled_dialogue = next(
        error for error in errors
        if error["type"] == "frozen_text_coverage_compiled_mismatch" and error["channel"] == "dialogue"
    )
    assert compiled_dialogue["duplicate_unit_refs"] == ["SC001::FTU_B001_D001"]
    assert compiled_dialogue["reordered"] is False
    assert manifest["passed"] is False

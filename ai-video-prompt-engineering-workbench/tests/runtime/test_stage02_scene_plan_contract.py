from __future__ import annotations

import copy

import pytest

from runtime.stages.scene_plan import (
    CONTRACT_VERSION,
    SYSTEM_PROMPT,
    build_scene_plan_payload,
    canonicalize_scene_plan,
    validate_scene_plan_output,
)


def _story() -> dict:
    return {
        "bible_id": "bible_x",
        "project_id": "run_x",
        "version": 1,
        "characters": [
            {"character_id": "char_001", "canonical_name": "阿宁", "role_type": "main"},
            {"character_id": "char_002", "canonical_name": "周野", "role_type": "supporting"},
        ],
        "scenes": [
            {"scene_id": "scene_001", "canonical_name": "厨房"},
            {"scene_id": "scene_002", "canonical_name": "楼道"},
        ],
        "props": [{"prop_id": "prop_001", "canonical_name": "饭盒"}],
        "narrative_contexts": [
            {"context_id": "context_001", "reality_status": "现实", "temporal_mode": "当前", "representation_mode": "直接呈现"}
        ],
    }


def _candidate() -> dict:
    return {
        "scenes": [
            {
                "scene_id": "MODEL_SCENE_X",
                "context_ref": "",
                "context_transition": "continue",
                "location_ref": "scene_001",
                "time": "傍晚",
                "character_refs": ["char_001", "char_001", "char_002"],
                "prop_refs": ["prop_001", "prop_001"],
                "continuous_with_previous": True,
                "dramatic_goal": "建立两人的现实关系",
                "conflict": "",
                "turning_point": "周野离开厨房",
                "beat_list": [
                    {"beat_id": "MODEL_B1", "description": "阿宁把饭盒放到桌上。", "type": "setup"},
                    {"beat_id": "MODEL_B2", "description": "周野转身离开。", "type": "action"},
                ],
            },
            {
                "scene_id": "MODEL_SCENE_X",
                "context_ref": "",
                "context_transition": "continue",
                "location_ref": "scene_002",
                "time": "随后",
                "character_refs": ["char_002"],
                "prop_refs": [],
                "continuous_with_previous": True,
                "dramatic_goal": "承接离开动作",
                "conflict": "",
                "turning_point": "",
                "beat_list": [
                    {"beat_id": "MODEL_B1", "description": "周野走进楼道。", "type": "action"},
                ],
            },
        ]
    }


def test_scene_plan_payload_makes_ids_program_owned_and_exposes_only_story_refs():
    payload = build_scene_plan_payload("原文", _story(), unit_id="scene_plan")
    assert payload["contract_version"] == CONTRACT_VERSION
    assert "source_text" not in payload
    assert payload["source_index"] == [{"source_ref": "SRC0001", "text": "原文"}]
    assert payload["story_bible"]["characters"][0]["character_id"] == "char_001"
    assert payload["reference_manifest"] == {
        "character_refs": ["char_001", "char_002"],
        "location_refs": ["scene_001", "scene_002"],
        "prop_refs": ["prop_001"],
        "context_refs": ["context_001"],
    }
    model_scene = payload["output_template"]["scenes"][0]
    assert "scene_id" not in model_scene
    assert "beat_id" not in model_scene["beat_list"][0]
    assert payload["output_contract"]["program_owned_fields"] == ["scene_id", "beat_id", "resume_context_ref", "source_start", "source_end"]
    assert "不要输出这些程序字段" in SYSTEM_PROMPT


def test_scene_plan_canonicalizer_owns_ids_dedupes_refs_and_forces_first_scene_not_continuous():
    normalized, changes = canonicalize_scene_plan(_candidate())
    scenes = normalized["scenes"]
    assert [s["scene_id"] for s in scenes] == ["SC001", "SC002"]
    assert [b["beat_id"] for s in scenes for b in s["beat_list"]] == ["B001", "B002", "B003"]
    assert scenes[0]["character_refs"] == ["char_001", "char_002"]
    assert scenes[0]["prop_refs"] == ["prop_001"]
    assert scenes[0]["continuous_with_previous"] is False
    assert scenes[1]["continuous_with_previous"] is True
    assert changes > 0


def test_scene_plan_validator_rejects_missing_required_scalar_wrong_bool_and_empty_beats():
    value, _ = canonicalize_scene_plan(_candidate())
    scene = value["scenes"][0]
    scene.pop("location_ref")
    scene["continuous_with_previous"] = "yes"
    scene["beat_list"] = []
    errors = validate_scene_plan_output(_story(), value)
    kinds = {e["type"] for e in errors}
    assert "missing_scene_plan_field" in kinds
    assert "invalid_scene_plan_scalar" in kinds
    assert "empty_scene_plan_beats" in kinds


def test_scene_plan_validator_rejects_empty_beat_description_and_type():
    value, _ = canonicalize_scene_plan(_candidate())
    value["scenes"][0]["beat_list"][0]["description"] = ""
    value["scenes"][0]["beat_list"][0]["type"] = ""
    errors = validate_scene_plan_output(_story(), value)
    bad_fields = {(e.get("type"), e.get("field")) for e in errors}
    assert ("invalid_scene_plan_scalar", "description") in bad_fields
    assert ("invalid_scene_plan_scalar", "type") in bad_fields


def test_scene_plan_validator_rejects_unknown_refs_and_multi_context():
    value, _ = canonicalize_scene_plan(_candidate())
    scene = value["scenes"][0]
    scene["location_ref"] = "scene_999"
    scene["context_ref"] = "context_001, context_002"
    scene["character_refs"].append("char_999")
    scene["prop_refs"].append("prop_999")
    kinds = {e["type"] for e in validate_scene_plan_output(_story(), value)}
    assert "unknown_location_ref" in kinds
    assert "multiple_context_refs" in kinds
    assert "unknown_character_ref" in kinds
    assert "unknown_prop_ref" in kinds


def test_scene_plan_same_physical_location_can_legitimately_appear_in_multiple_plan_scenes():
    value, _ = canonicalize_scene_plan(_candidate())
    value["scenes"][1]["location_ref"] = "scene_001"
    assert validate_scene_plan_output(_story(), value) == []


def test_runtime_stage02_canonicalizes_model_ids_and_duplicate_refs_without_repair(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.api.fixtures.mock_story_run import MockModel

    class BadMechanicalPlanModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            value = super().generate_json(stage, system_prompt, user_payload)
            if stage == "scene_plan":
                value = copy.deepcopy(value)
                scene = value["scenes"][0]
                scene["scene_id"] = "MODEL_SCENE"
                scene["character_refs"] = ["char_001", "char_001"]
                scene["prop_refs"] = ["prop_001", "prop_001"]
                scene["continuous_with_previous"] = True
                scene["beat_list"][0]["beat_id"] = "MODEL_BEAT"
            return value

    runtime = RuntimeV20(
        model=BadMechanicalPlanModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="Stage 2 wiring")
    assert run["status"] == "completed"
    plan_scene = run["artifacts"]["scene_plan"]["scenes"][0]
    assert plan_scene["scene_id"] == "SC001"
    assert plan_scene["beat_list"][0]["beat_id"] == "B001"
    assert plan_scene["character_refs"] == ["char_001"]
    assert plan_scene["prop_refs"] == ["prop_001"]
    assert plan_scene["continuous_with_previous"] is False
    assert run["units"]["scene_plan"]["repair_count"] == 0
    assert run["units"]["script:SC001"]["status"] == "completed"


def test_runtime_stage02_does_not_silently_remove_invalid_story_refs(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.api.fixtures.mock_story_run import MockModel

    class InvalidRefPlanModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            value = super().generate_json(stage, system_prompt, user_payload)
            if stage == "scene_plan":
                value = copy.deepcopy(value)
                value["scenes"][0]["location_ref"] = "scene_999"
            return value

    runtime = RuntimeV20(
        model=InvalidRefPlanModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="Stage 2 invalid ref")
    assert run["status"] == "paused"
    assert run["current_unit"] == "scene_plan"
    assert "unknown_location_ref" in run["error"]["message"]
    assert run["units"]["scene_plan"]["repair_count"] == 1
    assert "script:SC001" not in run["units"]


def test_scene_plan_rejects_unknown_fields_that_belong_to_downstream_stages():
    value, _ = canonicalize_scene_plan(_candidate())
    value["debug_note"] = "not canonical"
    value["scenes"][0]["camera"] = "close_up"
    value["scenes"][0]["beat_list"][0]["dialogue"] = [{"line": "越权对白"}]
    errors = validate_scene_plan_output(_story(), value)
    paths = {e.get("path") for e in errors if e.get("type") == "extra_scene_plan_field"}
    assert "$.debug_note" in paths
    assert "scenes[0].camera" in paths
    assert "scenes[0].beat_list[0].dialogue" in paths


def _single_scene_plan_for_source(source_text: str, *, description: str, prop_refs: list[str]) -> dict:
    candidate = {
        "scenes": [{
            "source_refs": ["SRC0001"],
            "context_ref": "", "context_transition": "continue",
            "location_ref": "scene_001", "time": "傍晚",
            "character_refs": ["char_001"], "prop_refs": prop_refs,
            "continuous_with_previous": False,
            "dramatic_goal": "", "conflict": "", "turning_point": "",
            "beat_list": [{"source_refs": ["SRC0001"], "description": description, "type": "action"}],
        }]
    }
    value, _ = canonicalize_scene_plan(candidate, source_text=source_text, story_bible=_story())
    return value


def test_scene_plan_requires_physically_handled_story_prop_from_exact_source_but_ignores_dialogue_only_mention():
    story = _story()
    story["props"].extend([
        {"prop_id": "prop_002", "canonical_name": "社区法律援助名片", "aliases": ["名片"]},
        {"prop_id": "prop_003", "canonical_name": "鱼丸", "aliases": ["一串鱼丸"]},
    ])
    source = "阿宁把名片攥在手里，然后说‘鱼丸’。"
    candidate = {
        "scenes": [{
            "source_refs": ["SRC0001"], "context_ref": "", "context_transition": "continue",
            "location_ref": "scene_001", "time": "傍晚", "character_refs": ["char_001"],
            "prop_refs": ["prop_001"], "continuous_with_previous": False,
            "dramatic_goal": "", "conflict": "", "turning_point": "",
            "beat_list": [{"source_refs": ["SRC0001"], "description": "阿宁处理手里的东西并说话。", "type": "action"}],
        }]
    }
    value, _ = canonicalize_scene_plan(candidate, source_text=source, story_bible=story)
    errors = validate_scene_plan_output(story, value, source_text=source, require_beat_provenance=True)
    missing = [e for e in errors if e["type"] == "scene_plan_missing_physical_prop_ref"]
    assert any(e.get("prop_ref") == "prop_002" for e in missing)
    assert not any(e.get("prop_ref") == "prop_003" for e in missing)


def test_scene_plan_does_not_treat_negated_prop_action_as_physical_presence():
    story = _story()
    story["props"].append({"prop_id": "prop_002", "canonical_name": "名片", "aliases": []})
    source = "阿宁只是提到名片，没有拿取或使用它。"
    candidate = {
        "scenes": [{
            "source_refs": ["SRC0001"], "context_ref": "", "context_transition": "continue",
            "location_ref": "scene_001", "time": "傍晚", "character_refs": ["char_001"],
            "prop_refs": ["prop_001"], "continuous_with_previous": False,
            "dramatic_goal": "", "conflict": "", "turning_point": "",
            "beat_list": [{"source_refs": ["SRC0001"], "description": "阿宁提到名片但没有使用。", "type": "dialogue"}],
        }]
    }
    value, _ = canonicalize_scene_plan(candidate, source_text=source, story_bible=story)
    errors = validate_scene_plan_output(story, value, source_text=source, require_beat_provenance=True)
    assert not any(e["type"] == "scene_plan_missing_physical_prop_ref" and e.get("prop_ref") == "prop_002" for e in errors)

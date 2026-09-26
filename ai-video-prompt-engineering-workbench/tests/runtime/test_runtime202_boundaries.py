from __future__ import annotations

import copy

from app.store import RunStore
from app.shape_validation import validate_director_fragment_shape
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20, _canonicalize_director_unit
from runtime.stages.script import canonicalize_script_scene, validate_script_scene_output
from runtime.stages.director import build_director_shot_payload
from runtime.stages.storyboard import build_storyboard_scene_payload, canonicalize_storyboard_scene, validate_storyboard_scene_output
from tests.api.fixtures.mock_story_run import RESPONSES


def test_storyboard_unit_rejects_null_base_shot_containers_at_storyboard_boundary():
    story = copy.deepcopy(RESPONSES["story_bible"])
    plan_scene = copy.deepcopy(RESPONSES["scene_plan"]["scenes"][0])
    script_scene = copy.deepcopy(RESPONSES["script"]["scenes"][0])
    scene = copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])
    shot = scene["shots"][0]
    shot["prop_refs"] = None
    shot["source_evidence"] = None
    shot["continuity"] = None

    normalized, _ = canonicalize_storyboard_scene(plan_scene, scene)
    errors = validate_storyboard_scene_output(plan_scene, script_scene, normalized)
    paths = {e.get("path") for e in errors if e.get("type") == "shape_type_mismatch"}

    assert "scene.shots[0].prop_refs" in paths
    assert "scene.shots[0].source_evidence" in paths
    assert "scene.shots[0].continuity" in paths


def test_script_unit_uses_shape_gate_before_semantic_validator():
    story = copy.deepcopy(RESPONSES["story_bible"])
    plan_scene = copy.deepcopy(RESPONSES["scene_plan"]["scenes"][0])
    script_scene = copy.deepcopy(RESPONSES["script"]["scenes"][0])
    script_scene["beats"][0]["dialogue"] = None

    normalized, _ = canonicalize_script_scene(plan_scene, script_scene)
    errors = validate_script_scene_output(story, plan_scene, normalized, source_text="阿宁站在窗边，手里拿着信封。")
    assert any(e.get("type") == "shape_type_mismatch" and e.get("path") == "scene.beats[0].dialogue" for e in errors)


def test_storyboard_unit_payload_has_versioned_full_shot_contract_to_invalidate_old_checkpoint():
    payload = build_storyboard_scene_payload(
        copy.deepcopy(RESPONSES["scene_plan"]["scenes"][0]),
        copy.deepcopy(RESPONSES["script"]["scenes"][0]),
        unit_id="storyboard:SC001",
    )

    assert payload["contract_version"] == "storyboard_scene.v16"
    assert payload["output_contract"]["model_shot_fields"] == [
        "beat_id", "character_refs", "prop_refs", "shot_size", "camera", "movement",
        "composition", "duration", "description", "dialogue_unit_refs", "narration_unit_refs", "continuity", "source_evidence",
    ]
    shot = payload["output_template"]["scene"]["shots"][0]
    assert "shot_id" not in shot
    assert "scene_id" not in shot
    assert shot["prop_refs"] == []
    assert shot["source_evidence"] == [{"quote": ""}]
    assert isinstance(shot["continuity"], dict)
    assert "story_bible" not in payload


def test_director_unit_canonicalizes_string_source_evidence_without_llm_repair():
    director = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
    director["performance_actions"][0]["source_evidence"] = ["阿宁站在窗边，手里拿着信封。"]

    normalized, changes = _canonicalize_director_unit(director)

    assert changes == 1
    assert normalized["performance_actions"][0]["source_evidence"] == [
        {"quote": "阿宁站在窗边，手里拿着信封。"}
    ]
    assert validate_director_fragment_shape(normalized) == []


def test_director_payload_explicitly_requires_evidence_object_shape():
    board = copy.deepcopy(RESPONSES["storyboard_base"])
    shot = board["scenes"][0]["shots"][0]
    context = {
        "shot": shot,
        "script_beat": copy.deepcopy(RESPONSES["script"]["scenes"][0]["beats"][0]),
        "assets": {},
        "previous_state_out": {"characters": {}, "props": {}, "environment": {}},
        "program_owned": {"speaker_target_refs": [], "allowed_character_refs": ["char_001"], "allowed_prop_refs": ["prop_001"]},
    }
    payload = build_director_shot_payload(context, unit_id="director:SH001", is_first_global_shot=True)

    assert payload["contract_version"] == "director_shot.v18_0_2"
    assert payload["output_contract"]["performance_action.source_evidence"] == "array<object{quote:string}>"
    assert payload["performance_action_template"]["source_evidence"] == [{"quote": ""}]


def test_director_fragment_shape_does_not_revalidate_base_shot_fields():
    director = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
    # Fragment validation owns only Director data; malformed Base Shot containers belong to storyboard boundary.
    assert validate_director_fragment_shape(director) == []

class BoundaryRegressionModel:
    def __init__(self):
        self.calls: list[tuple[str, str | None, bool]] = []

    def generate_json(self, stage, system_prompt, payload):
        uid = payload.get("unit_id")
        repairing = "repair_instruction" in payload
        self.calls.append((stage, uid, repairing))
        if stage == "story_bible":
            return copy.deepcopy(RESPONSES["story_bible"])
        if stage == "scene_plan":
            return copy.deepcopy(RESPONSES["scene_plan"])
        if stage == "script_scene":
            return {"scene": copy.deepcopy(RESPONSES["script"]["scenes"][0])}
        if stage == "storyboard_scene":
            scene = copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])
            if not repairing:
                scene["shots"][0]["prop_refs"] = None
                scene["shots"][0]["source_evidence"] = None
                scene["shots"][0]["continuity"] = None
            return {"scene": scene}
        if stage == "production_semantics_shot":
            shot = payload.get("shot", {}) or {}
            evidence = (payload.get("program_owned", {}) or {}).get("current_shot_evidence") or []
            quote = next((str(x).strip() for x in evidence if isinstance(x, str) and str(x).strip()), "")
            description = str(shot.get("description") or "").strip()
            visual_events = []
            if description and quote:
                visual_events.append({
                    "action": description,
                    "character_refs": list(shot.get("character_refs") or []),
                    "prop_refs": list(shot.get("prop_refs") or []),
                    "source_evidence": [{"quote": quote}],
                })
            return {"production_semantics": {
                "visual_events": visual_events,
                "audio_events": [],
                "renderability_status": "renderable",
                "renderability_issues": [],
                "dialogue": [
                    {"character_id": x.get("character_id"), "line": x.get("line"), "offscreen": False}
                    for x in (payload.get("shot", {}).get("dialogue") or [])
                ],
                "diegetic_text": [],
                "production_choices": [],
                "appearance_overlays": [],
            }}
        if stage == "director_shot":
            director = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
            for action in director.get("performance_actions", []):
                action["source_evidence"] = [item["quote"] for item in action.get("source_evidence", [])]
            return {"director": director}
        if stage == "pvb_character":
            return {"character": copy.deepcopy(RESPONSES["pvb"]["characters"][0])}
        if stage == "psb_scene":
            return {"scene": copy.deepcopy(RESPONSES["psb"]["scenes"][0])}
        if stage == "style_guide":
            return copy.deepcopy(RESPONSES["style_guide"])
        raise AssertionError(stage)


def test_exact_null_storyboard_plus_string_director_evidence_recovers_at_owning_boundaries(tmp_path):
    model = BoundaryRegressionModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="边界回归")

    assert run["status"] == "completed"
    assert run["units"]["storyboard:SC001"]["repair_count"] == 1
    assert run["units"]["director:SH001"]["repair_count"] == 0
    assert run["units"]["director:SH001"]["normalization_count"] >= 1
    assert run["artifacts"]["static_evaluation"]["passed"] is True
    # The first malformed Storyboard is repaired there; Director never receives those null Base Shot containers.
    assert ("storyboard_scene", "storyboard:SC001", True) in model.calls


def test_old_storyboard_checkpoint_is_not_reused_after_contract_version_upgrade(tmp_path):
    checkpoints = CheckpointStore(tmp_path / "checkpoints")
    story = copy.deepcopy(RESPONSES["story_bible"])
    plan_scene = copy.deepcopy(RESPONSES["scene_plan"]["scenes"][0])
    script_scene = copy.deepcopy(RESPONSES["script"]["scenes"][0])
    new_payload = build_storyboard_scene_payload(
        plan_scene,
        script_scene,
        unit_id="storyboard:SC001",
    )
    old_payload = copy.deepcopy(new_payload)
    old_payload["contract_version"] = "storyboard_scene.v2"
    old_payload["output_contract"] = {"root": "object", "scene": "object", "shots": "array<object>"}
    old_payload.pop("output_template", None)
    checkpoints.save("run_old", "storyboard:SC001", {
        "unit_id": "storyboard:SC001",
        "stage": "storyboard",
        "status": "completed",
        "input_hash": __import__("runtime.checkpoints", fromlist=["unit_input_hash"]).unit_input_hash(old_payload),
        "output": {"scene_id": "SC001", "shots": []},
    })

    assert checkpoints.get_reusable("run_old", "storyboard:SC001", new_payload) is None


def test_director_payload_publishes_all_closed_enum_domains_and_body_region_key_semantics():
    from prompt_foundry_v1_3.director_contract import (
        BODY_REGIONS,
        CONTINUITY_MODES,
        DEPENDENCY_TAGS,
        FOCUS_TYPES,
        TRANSFORMATION_TYPES,
        STATIC_ASSET_STATE_KEYS,
    )

    context = {
        "shot": {"character_refs": ["char_001"], "prop_refs": ["prop_001"], "dialogue": []},
        "script_beat": {},
        "assets": {},
        "previous_state_out": {"characters": {}, "props": {}, "environment": {}},
        "program_owned": {
            "speaker_target_refs": [],
            "allowed_character_refs": ["char_001"],
            "allowed_prop_refs": ["prop_001"],
        },
    }
    payload = build_director_shot_payload(context, unit_id="director:SH001", is_first_global_shot=True)
    enums = payload["output_contract"]["allowed_values"]

    assert enums["performance_actions[*].transformation_type"] == sorted(TRANSFORMATION_TYPES)
    assert enums["performance_actions[*].dependency_tags[*]"] == sorted(DEPENDENCY_TAGS)
    assert enums["visual_focus.focus_type"] == sorted(FOCUS_TYPES)
    assert enums["visual_focus.body_regions.*[*]"] == sorted(BODY_REGIONS)
    assert enums["continuity_scope.mode"] == sorted(CONTINUITY_MODES)
    assert "key must be a character_ref" in payload["output_contract"]["visual_focus.body_regions"]
    assert "posture" in payload["output_contract"]["visual_focus.body_regions"]
    assert "gaze_direction" in payload["output_contract"]["visual_focus.body_regions"]
    assert payload["output_contract"]["state_out.forbidden_static_keys"] == sorted(STATIC_ASSET_STATE_KEYS)
    assert "validation_errors" in payload["output_contract"]["repair_behavior"]
    assert "invalid_output" in payload["output_contract"]["repair_behavior"]


def test_runtime_director_system_prompt_forbids_semantic_labels_inside_body_regions():
    from runtime.stages.director import SYSTEM_PROMPT

    assert "body_regions 的 key" in SYSTEM_PROMPT
    assert "allowed_character_refs" in SYSTEM_PROMPT
    assert "posture" in SYSTEM_PROMPT
    assert "gaze_direction" in SYSTEM_PROMPT
    assert "站立" in SYSTEM_PROMPT
    assert "望向" in SYSTEM_PROMPT
    assert "face / eyes / mouth / head / neck / upper_body / lower_body / hands / feet" in SYSTEM_PROMPT
    assert "repair_instruction" in SYSTEM_PROMPT


def test_validation_retry_routes_through_configured_repair_model(tmp_path):
    from runtime.model_router import ModelRouter

    class FirstModel:
        def __init__(self):
            self.calls = 0
        def generate_json(self, stage, system_prompt, payload):
            self.calls += 1
            return {"ok": False}

    class RepairModel:
        def __init__(self):
            self.calls = 0
        def generate_json(self, stage, system_prompt, payload):
            self.calls += 1
            assert payload["repair_instruction"]["validation_errors"]
            assert payload["repair_instruction"]["invalid_output"] == {"ok": False}
            return {"ok": True}

    first = FirstModel()
    repair = RepairModel()
    runtime = RuntimeV20(
        model=first,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
        router=ModelRouter(default_model=first, direction_model=first, repair_model=repair),
    )
    run = runtime.create("测试文本", title="repair routing")

    result = runtime._execute_unit(
        run,
        unit_id="director:SH001",
        stage="director",
        model_stage="director_shot",
        payload={"unit_id": "director:SH001"},
        prompt="director prompt",
        extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "synthetic"}], 0),
    )

    assert result == {"ok": True}
    assert first.calls == 1
    assert repair.calls == 1


def test_director_payload_softens_lexical_modifiers_but_keeps_no_new_story_hard_boundary():
    from runtime.stages.director import build_director_shot_payload

    context = {
        "shot": {"character_refs": ["char_002"], "prop_refs": [], "dialogue": []},
        "script_beat": {}, "assets": {},
        "previous_state_out": {"characters": {}, "props": {}, "environment": {}},
        "program_owned": {"speaker_target_refs": [], "allowed_character_refs": ["char_002"], "allowed_prop_refs": []},
    }
    payload = build_director_shot_payload(context, unit_id="director:SH008", is_first_global_shot=False)
    action_contract = payload["output_contract"]["performance_actions[*].action"]
    assert "forbidden_unless_exactly_in_evidence" not in action_contract
    assert "micro-performance" in action_contract["rule"]
    assert "new plot event" in action_contract["hard_forbidden"]


def test_runtime_director_system_prompt_allows_micro_performance_without_new_story_facts():
    from runtime.stages.director import SYSTEM_PROMPT

    assert "眼神、停顿、呼吸" in SYSTEM_PROMPT
    assert "不要求修饰词逐字出现在原文证据中" in SYSTEM_PROMPT
    assert "不得把“爱、恨、背叛、原谅" in SYSTEM_PROMPT

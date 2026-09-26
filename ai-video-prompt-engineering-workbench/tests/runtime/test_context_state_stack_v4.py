from __future__ import annotations

import copy

from runtime.stages import scene_plan


def _story():
    return {
        "characters": [{"character_id": "char_001", "canonical_name": "甲"}],
        "scenes": [
            {"scene_id": "scene_001", "canonical_name": "现实房间"},
            {"scene_id": "scene_002", "canonical_name": "过去车间"},
        ],
        "props": [],
        "narrative_contexts": [
            {
                "context_id": "context_001",
                "reality_status": "memory",
                "temporal_mode": "past",
                "representation_mode": "flashback",
            }
        ],
    }


def _candidate():
    return {
        "scenes": [
            {
                "context_ref": "",
                "context_transition": "continue",
                "location_ref": "scene_001",
                "time": "现在",
                "character_refs": ["char_001"],
                "prop_refs": [],
                "continuous_with_previous": False,
                "dramatic_goal": "现实建立",
                "conflict": "",
                "turning_point": "",
                "beat_list": [{"description": "甲站在桌边。", "type": "setup"}],
            },
            {
                "context_ref": "context_001",
                "context_transition": "enter",
                "location_ref": "scene_002",
                "time": "多年以前",
                "character_refs": ["char_001"],
                "prop_refs": [],
                "continuous_with_previous": False,
                "dramatic_goal": "进入回忆",
                "conflict": "",
                "turning_point": "",
                "beat_list": [{"description": "甲站在旧车间。", "type": "memory"}],
            },
            {
                "context_ref": "",
                "context_transition": "return",
                "location_ref": "scene_001",
                "time": "现在",
                "character_refs": ["char_001"],
                "prop_refs": [],
                "continuous_with_previous": False,
                "dramatic_goal": "回到现实",
                "conflict": "",
                "turning_point": "",
                "beat_list": [{"description": "甲仍在桌边。", "type": "return"}],
            },
        ]
    }


def test_scene_plan_v4_exposes_model_transition_and_program_owned_resume_ref():
    payload = scene_plan.build_scene_plan_payload("原文", _story(), unit_id="scene_plan")
    assert payload["contract_version"] == "scene_plan.v8"
    assert "context_transition" in payload["output_template"]["scenes"][0]
    assert "resume_context_ref" not in payload["output_template"]["scenes"][0]
    assert "resume_context_ref" in payload["output_contract"]["program_owned_fields"]
    assert set(payload["output_contract"]["allowed_context_transitions"]) == {"continue", "enter", "return", "switch"}


def test_scene_plan_v4_canonicalizer_derives_resume_context_from_stack():
    value, _ = scene_plan.canonicalize_scene_plan(_candidate())
    scenes = value["scenes"]
    assert [s["resume_context_ref"] for s in scenes] == ["", "", ""]
    assert [s["scene_id"] for s in scenes] == ["SC001", "SC002", "SC003"]
    assert scene_plan.validate_scene_plan_output(_story(), value) == []


def test_scene_plan_v4_rejects_return_that_does_not_match_context_stack():
    candidate = _candidate()
    candidate["scenes"][2]["context_ref"] = "context_001"
    value, _ = scene_plan.canonicalize_scene_plan(candidate)
    kinds = {x["type"] for x in scene_plan.validate_scene_plan_output(_story(), value)}
    assert "context_return_target_mismatch" in kinds


def test_scene_plan_v4_rejects_context_change_disguised_as_continue():
    candidate = _candidate()
    candidate["scenes"][1]["context_transition"] = "continue"
    value, _ = scene_plan.canonicalize_scene_plan(candidate)
    kinds = {x["type"] for x in scene_plan.validate_scene_plan_output(_story(), value)}
    assert "context_continue_mismatch" in kinds


def _state_story():
    return {
        "characters": [{"character_id": "char_001", "canonical_name": "甲", "role_type": "main"}],
        "scenes": [
            {"scene_id": "scene_001", "canonical_name": "现实房间"},
            {"scene_id": "scene_002", "canonical_name": "过去车间"},
        ],
        "props": [],
        "narrative_contexts": [{
            "context_id": "context_001", "reality_status": "memory", "temporal_mode": "past",
            "representation_mode": "flashback", "source_evidence": [{"quote": "多年前"}],
        }],
    }


def _state_plan():
    value, _ = scene_plan.canonicalize_scene_plan(_candidate())
    return value


def _state_script():
    return {"scenes": [
        {"scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "scene_heading": "现实房间", "scene_description": "", "beats": [{"beat_id": "B001", "description": "甲站在现实桌边。", "dialogue": []}]},
        {"scene_id": "SC002", "context_ref": "context_001", "location_ref": "scene_002", "scene_heading": "过去车间", "scene_description": "", "beats": [{"beat_id": "B002", "description": "甲站在旧厂工位。", "dialogue": []}]},
        {"scene_id": "SC003", "context_ref": "", "location_ref": "scene_001", "scene_heading": "现实房间", "scene_description": "", "beats": [{"beat_id": "B003", "description": "甲仍站在现实桌边。", "dialogue": []}]},
    ]}


def _state_board():
    scenes = []
    specs = [
        ("SC001", "", "scene_001", "SH001", "B001", "甲站在现实桌边。"),
        ("SC002", "context_001", "scene_002", "SH002", "B002", "甲站在旧厂工位。"),
        ("SC003", "", "scene_001", "SH003", "B003", "甲仍站在现实桌边。"),
    ]
    for scid, ctx, loc, shid, bid, desc in specs:
        scenes.append({
            "scene_id": scid, "context_ref": ctx, "location_ref": loc,
            "shots": [{
                "shot_id": shid, "scene_id": scid, "beat_id": bid, "character_refs": ["char_001"], "prop_refs": [],
                "shot_size": "medium", "camera": "eye_level", "movement": "static", "composition": "甲位于画面中央。",
                "duration": 4.0, "description": desc, "dialogue": [],
                "continuity": {"continuous_with_previous": False, "axis_side": "neutral", "eyeline_match": "not_applicable"},
                "source_evidence": [{"quote": desc}],
            }],
        })
    return {"scenes": scenes}




def _state_semantics():
    shots = []
    for scene in _state_board()["scenes"]:
        for shot in scene["shots"]:
            desc = shot["description"]
            shots.append({
                "shot_id": shot["shot_id"],
                "context_ref": scene["context_ref"],
                "visual_events": [{
                    "action": desc,
                    "character_refs": list(shot.get("character_refs") or []),
                    "prop_refs": list(shot.get("prop_refs") or []),
                    "source_evidence": [{"quote": desc}],
                }],
                "audio_events": [],
                "renderability_status": "renderable",
                "renderability_issues": [],
                "dialogue": [],
                "diegetic_text": [],
                "production_choices": [],
                "appearance_overlays": [],
            })
    return {"shots": shots}

class _ContextDirectorModel:
    def generate_json(self, stage, system_prompt, user_payload):
        assert stage == "director_shot"
        shot = user_payload["shot"]
        sid = shot["shot_id"]
        position = {"SH001": "现实桌边", "SH002": "旧厂工位"}.get(sid)
        delta = {"characters": {}, "props": {}, "environment": {}}
        if position:
            delta["characters"] = {"char_001": {"position": position}}
        return {"director": {
            "dramatic_intent": "保持当前可见动作。",
            "primary_subject_refs": ["char_001"],
            "reaction_target_refs": [],
            "performance_actions": [],
            "visual_focus": {"focus_type": "character", "subject_refs": ["char_001"], "body_regions": {}, "prop_refs": [], "environment_keys": []},
            "action_delta": delta,
            "continuity_scope": {"mode": "reset" if sid == "SH001" else "inherit"},
        }}


def test_runtime_context_state_stack_restores_reality_state_after_flashback(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20

    runtime = RuntimeV20(
        model=_ContextDirectorModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.create("现实。多年前。回到现实。", title="context stack")
    run["artifacts"].update({"story_bible": _state_story(), "scene_plan": _state_plan(), "script": _state_script(), "storyboard_base": _state_board()})
    runtime._run_director_units(run, _state_story(), _state_script(), _state_board(), _state_plan(), _state_semantics())
    assert run["units"]["director:SH002"]["state_in"]["characters"] == {}
    assert run["units"]["director:SH003"]["state_in"]["characters"]["char_001"]["position"] == "现实桌边"


def _state(*, marker: str = ""):
    return {
        "characters": {"char_001": {"position": marker}} if marker else {},
        "props": {},
        "environment": {},
    }


def _director(*, mode: str, state_out: dict):
    return {
        "continuity_scope": {"mode": mode},
        "action_delta": {"characters": {}, "props": {}, "environment": {}},
        "state_out": copy.deepcopy(state_out),
    }


def _board_for_context_restore():
    return {
        "scenes": [
            {
                "scene_id": "SC001",
                "context_ref": "",
                "location_ref": "scene_001",
                "shots": [{
                    "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001",
                    "character_refs": ["char_001"], "prop_refs": [],
                    "director": _director(mode="reset", state_out=_state(marker="现实桌边")),
                }],
            },
            {
                "scene_id": "SC002",
                "context_ref": "context_001",
                "location_ref": "scene_002",
                "shots": [{
                    "shot_id": "SH002", "scene_id": "SC002", "beat_id": "B002",
                    "character_refs": ["char_001"], "prop_refs": [],
                    "director": _director(mode="inherit", state_out=_state(marker="过去工位")),
                }],
            },
            {
                "scene_id": "SC003",
                "context_ref": "",
                "location_ref": "scene_001",
                "shots": [{
                    "shot_id": "SH003", "scene_id": "SC003", "beat_id": "B003",
                    "character_refs": ["char_001"], "prop_refs": [],
                    "director": _director(mode="inherit", state_out=_state(marker="现实桌边")),
                }],
            },
        ]
    }


def test_state_shotspec_uses_same_context_restore_policy_as_director():
    from runtime.stages.state_shotspec import build_state_shot_specs

    plan, _ = scene_plan.canonicalize_scene_plan(_candidate())
    specs, errors = build_state_shot_specs(_board_for_context_restore(), scene_plan=plan)

    assert errors == []
    assert [spec["shot_id"] for spec in specs] == ["SH001", "SH002", "SH003"]
    assert specs[0]["state_in"] == {"characters": {}, "props": {}, "environment": {}}
    assert specs[1]["state_in"] == {"characters": {}, "props": {}, "environment": {}}
    assert specs[2]["state_in"] == _state(marker="现实桌边")
    # Context scheduling must not mutate the Frozen ShotSpec output shape.
    assert "context_transition" not in specs[2]
    assert "resume_context_ref" not in specs[2]


def test_scene_plan_v4_switch_discards_previous_return_stack():
    candidate = _candidate()
    candidate["scenes"][2]["context_ref"] = "context_002"
    candidate["scenes"][2]["context_transition"] = "switch"
    candidate["scenes"][2]["location_ref"] = "scene_002"
    candidate["scenes"].append({
        "context_ref": "",
        "context_transition": "return",
        "location_ref": "scene_001",
        "time": "现在",
        "character_refs": ["char_001"],
        "prop_refs": [],
        "continuous_with_previous": False,
        "dramatic_goal": "错误返回",
        "conflict": "",
        "turning_point": "",
        "beat_list": [{"description": "甲回到现实。", "type": "return"}],
    })
    story = _story()
    story["narrative_contexts"].append({
        "context_id": "context_002", "reality_status": "memory", "temporal_mode": "past", "representation_mode": "flashback"
    })
    value, _ = scene_plan.canonicalize_scene_plan(candidate)
    kinds = {x["type"] for x in scene_plan.validate_scene_plan_output(story, value)}
    assert "context_return_without_entry" in kinds


def test_context_state_validation_detects_tampered_restored_state():
    from runtime.stages.state_shotspec import build_state_shot_specs, validate_context_state_shot_specs

    plan, _ = scene_plan.canonicalize_scene_plan(_candidate())
    board = _board_for_context_restore()
    specs, errors = build_state_shot_specs(board, scene_plan=plan)
    assert errors == []
    assert validate_context_state_shot_specs(board, plan, specs) == []

    tampered = copy.deepcopy(specs)
    tampered[2]["state_in"] = _state(marker="过去工位")
    kinds = {item["type"] for item in validate_context_state_shot_specs(board, plan, tampered)}
    assert "runtime_context_state_chain_mismatch" in kinds


def test_frozen_state_chain_mismatch_is_suppressed_only_after_runtime_context_validation():
    from runtime.stages.compile_eval import _adapt_legacy_static_evaluation_v10

    raw = {
        "passed": False,
        "errors": [{
            "category": "STRUCTURE",
            "type": "state_chain_mismatch",
            "shot_id": "SH003",
            "detail": "legacy linear chain disagrees with context restore",
        }],
    }
    kept = _adapt_legacy_static_evaluation_v10(raw, context_state_validated=False)
    assert [e["type"] for e in kept["errors"]] == ["state_chain_mismatch"]

    adapted = _adapt_legacy_static_evaluation_v10(raw, context_state_validated=True)
    assert adapted["errors"] == []
    assert [e["type"] for e in adapted["compatibility_suppressed_errors"]] == ["state_chain_mismatch"]


def test_scene_plan_v8_same_context_switch_exposes_precise_repair_target():
    candidate = _candidate()
    # SC002 enters context_001. SC003 stays in context_001, so `switch` is only
    # a transition-label error and must not grant authority to invent another context_ref.
    candidate["scenes"][2]["context_transition"] = "switch"
    candidate["scenes"][2]["context_ref"] = "context_001"
    value, _ = scene_plan.canonicalize_scene_plan(candidate)
    errors = scene_plan.validate_scene_plan_output(_story(), value)
    error = next(item for item in errors if item["type"] == "context_switch_same_context")

    assert error["path"] == "scenes[2].context_transition"
    assert error["target_path"] == "scenes[2].context_transition"
    assert error["repair_action"] == "change_same_context_switch_to_continue"
    assert error["allowed_repair_values"] == ["continue"]

    from runtime.orchestrator import RuntimeV20
    policy = RuntimeV20._repair_policy("scene_plan", [error])
    assert policy["repair_targets"] == ["scenes[2].context_transition"]


def test_scene_plan_v8_same_context_enter_exposes_precise_repair_target():
    candidate = _candidate()
    candidate["scenes"][1]["context_ref"] = ""
    candidate["scenes"][1]["context_transition"] = "enter"
    value, _ = scene_plan.canonicalize_scene_plan(candidate)
    errors = scene_plan.validate_scene_plan_output(_story(), value)
    error = next(item for item in errors if item["type"] == "context_enter_same_context")

    assert error["path"] == "scenes[1].context_transition"
    assert error["target_path"] == "scenes[1].context_transition"
    assert error["repair_action"] == "change_same_context_enter_to_continue"
    assert error["allowed_repair_values"] == ["continue"]

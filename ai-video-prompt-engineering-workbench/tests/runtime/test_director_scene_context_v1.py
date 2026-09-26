from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.context_builder import ContextBuilder
from runtime.orchestrator import RuntimeV20
from runtime.stages.director_scene_context import (
    CONTRACT_VERSION,
    build_director_scene_context_payload,
    canonicalize_director_scene_context,
    validate_director_scene_context,
)
from tests.api.fixtures.mock_story_run import MockModel, RESPONSES


def _production_semantics() -> dict:
    return {
        "shots": [{
            "shot_id": "SH001",
            "context_ref": "",
            "visual_events": [{
                "action": "阿宁站在窗边，手里拿着信封。",
                "character_refs": ["char_001"],
                "prop_refs": ["prop_001"],
                "source_evidence": [{"quote": "阿宁站在窗边，手里拿着信封。"}],
            }],
            "audio_events": [],
            "renderability_status": "renderable",
            "renderability_issues": [],
            "dialogue": [],
            "diegetic_text": [],
            "production_choices": [],
            "appearance_overlays": [],
        }]
    }


def _scene_input() -> dict:
    builder = ContextBuilder(
        story_bible=copy.deepcopy(RESPONSES["story_bible"]),
        script=copy.deepcopy(RESPONSES["script"]),
        storyboard_base=copy.deepcopy(RESPONSES["storyboard_base"]),
    )
    return builder.director_scene_context(
        "SC001",
        scene_plan=copy.deepcopy(RESPONSES["scene_plan"]["scenes"][0]),
        production_semantics=copy.deepcopy(_production_semantics()["shots"]),
    )


def test_scene_context_payload_is_minimal_and_fact_inputs_remain_immutable():
    ctx = _scene_input()
    before = copy.deepcopy(ctx)
    payload = build_director_scene_context_payload(ctx, unit_id="director_scene:SC001")
    assert ctx == before
    assert payload["contract_version"] == CONTRACT_VERSION
    assert payload["scene"]["scene_id"] == "SC001"
    assert payload["program_owned"]["allowed_shot_refs"] == ["SH001"]
    assert payload["program_owned"]["allowed_beat_refs"] == ["B001"]
    assert payload["production_semantics_digest"][0]["shot_id"] == "SH001"
    assert "visual_events" not in payload["production_semantics_digest"][0]


def test_director_stage_does_not_mutate_fact_spine_inputs(tmp_path):
    model = MockModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    seed = runtime.start("阿宁站在窗边，手里拿着信封。", "seed")
    assert seed["status"] == "completed"
    story = copy.deepcopy(seed["artifacts"]["story_bible"])
    plan = copy.deepcopy(seed["artifacts"]["scene_plan"])
    script = copy.deepcopy(seed["artifacts"]["script"])
    board = copy.deepcopy(seed["artifacts"]["storyboard_base"])
    semantics = copy.deepcopy(seed["artifacts"]["production_semantics"])
    before = copy.deepcopy((story, plan, script, board, semantics))

    run = runtime.create("阿宁站在窗边，手里拿着信封。", "fact-integrity")
    runtime._run_director_units(run, story, script, board, plan, semantics)
    assert (story, plan, script, board, semantics) == before
    assert "director_scene_contexts" in run["artifacts"]


class _BadSceneContextModel(MockModel):
    def generate_json(self, stage, system_prompt, user_payload):
        if stage == "director_scene_context":
            self.calls.append(stage)
            return {"scene_director_context": {"bad": "field"}}
        return super().generate_json(stage, system_prompt, user_payload)


def test_scene_context_validation_failure_repairs_once_then_falls_back_without_pause(tmp_path):
    model = _BadSceneContextModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", "fail-soft")
    assert run["status"] == "completed"
    assert model.calls.count("director_scene_context") == 2
    scene_artifact = run["artifacts"]["director_scene_contexts"]["SC001"]
    assert scene_artifact["scene_context_status"] == "unavailable_after_repair"
    assert scene_artifact["scene_director_context"] == {}
    unit = run["units"]["director_scene:SC001"]
    assert unit["status"] == "completed"
    assert unit["scene_context_status"] == "unavailable_after_repair"
    assert run.get("error") in (None, {})


class _ContextConsumptionModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_payloads: list[dict] = []

    def generate_json(self, stage, system_prompt, user_payload):
        if stage == "director_scene_context":
            self.calls.append(stage)
            program = user_payload["program_owned"]
            evidence = [copy.deepcopy(program["allowed_evidence_refs"][0])]
            return {"scene_director_context": {
                "scene_id": "SC001", "contract_version": CONTRACT_VERSION,
                "dramatic_function": {"summary": "承接信息后的反应阶段。", "evidence_sources": evidence},
                "emotional_arc": [{
                    "phase_id": "phase_reaction", "beat_refs": ["B001"], "shot_refs": ["SH001"],
                    "function": "reaction", "intensity": "medium", "evidence_sources": evidence,
                }],
                "relationship_dynamics": [],
                "reaction_strategy": {"priority": "high", "preferred_reaction_shot_refs": ["SH001"]},
                "camera_strategy": {"stability": "mixed", "framing_tendency": "close_dominant", "movement_policy": "selective_motion"},
                "character_performance_baselines": [{
                    "character_ref": "char_001", "baseline_energy": "restrained",
                    "baseline_control": "controlled", "baseline_social_posture": "guarded",
                }],
                "evidence_sources": evidence,
            }}
        if stage == "director_shot":
            self.director_payloads.append(copy.deepcopy(user_payload))
            value = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
            value["scene_position"] = "reaction"
            value["scene_context_usage"] = ["emotional_arc", "reaction_strategy", "camera_strategy"]
            self.calls.append(stage)
            return {"director": value}
        return super().generate_json(stage, system_prompt, user_payload)


def test_shot_director_consumes_scene_context_and_explicit_v18_program_context(tmp_path):
    model = _ContextConsumptionModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", "context-consumption")
    assert run["status"] == "completed", run.get("error")
    assert len(model.director_payloads) == 1
    program = model.director_payloads[0]["program_owned"]
    assert program["scene_context_status"] == "available"
    assert program["scene_director_context"]["emotional_arc"][0]["function"] == "reaction"
    assert program["previous_shot_design"] == {}
    assert program["next_shot_purpose"] is None
    assert program["scene_distribution_so_far"]["prior_shot_count"] == 0
    shot = run["artifacts"]["storyboard"]["scenes"][0]["shots"][0]
    assert shot["director"]["scene_position"] == "reaction"
    assert shot["director"]["scene_context_usage"] == ["emotional_arc", "reaction_strategy", "camera_strategy"]


def test_scene_context_boundary_drops_shot_level_camera_prescription_and_unknown_refs():
    ctx = _scene_input()
    payload = build_director_scene_context_payload(ctx, unit_id="director_scene:SC001")
    model = MockModel()
    raw = model.generate_json("director_scene_context", "", payload)["scene_director_context"]
    raw["camera_strategy"]["contrast_rules"] = ["低机位35度，摄影机慢推0.5米"]
    raw["relationship_dynamics"] = [{
        "character_refs": ["char_001", "char_unknown"],
        "relation_mode": "confrontation", "power_balance": "balanced",
        "evidence_sources": copy.deepcopy(raw["evidence_sources"]),
        "specific_action": "新增动作",
    }]
    normalized, changes = canonicalize_director_scene_context(raw, ctx)
    assert changes > 0
    assert normalized["relationship_dynamics"] == []
    assert set(normalized["camera_strategy"]) == {"stability", "framing_tendency", "movement_policy"}
    assert validate_director_scene_context(normalized, ctx) == []


def test_scene_context_large_scene_boundary_validates_120_shots_without_ref_drift():
    ctx = _scene_input()
    shots = [f"SH{i:03d}" for i in range(1, 121)]
    beats = [f"B{i:03d}" for i in range(1, 121)]
    ctx["program_owned"]["allowed_shot_refs"] = shots
    ctx["program_owned"]["allowed_beat_refs"] = beats
    ctx["program_owned"]["allowed_evidence_refs"] = [
        {"source_type": "storyboard_shot", "source_ref": shot} for shot in shots
    ]
    ctx["storyboard_scene"]["shots"] = [
        {"shot_id": shot, "scene_id": "SC001", "beat_id": beat, "character_refs": ["char_001"]}
        for shot, beat in zip(shots, beats)
    ]
    evidence = [{"source_type": "storyboard_shot", "source_ref": shots[0]}]
    value = {
        "scene_id": "SC001", "contract_version": CONTRACT_VERSION,
        "dramatic_function": {"summary": "长场景测试", "evidence_sources": evidence},
        "emotional_arc": [{
            "phase_id": "phase_all", "beat_refs": beats, "shot_refs": shots,
            "function": "setup", "intensity": "medium",
            "evidence_sources": evidence,
        }],
        "relationship_dynamics": [],
        "reaction_strategy": {"priority": "low", "preferred_reaction_shot_refs": []},
        "camera_strategy": {"stability": "stable", "framing_tendency": "mixed", "movement_policy": "mostly_static"},
        "character_performance_baselines": [{
            "character_ref": "char_001", "baseline_energy": "restrained",
            "baseline_control": "controlled", "baseline_social_posture": "guarded",
        }],
        "evidence_sources": evidence,
    }
    normalized, _ = canonicalize_director_scene_context(value, ctx)
    assert validate_director_scene_context(normalized, ctx) == []
    assert normalized["emotional_arc"][0]["shot_refs"] == shots

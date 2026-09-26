from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.context_builder import ContextBuilder
from runtime.director_context_effect import build_shot_context_effect_audit
from runtime.orchestrator import RuntimeV20
from runtime.stages.director import build_director_shot_payload, canonicalize_director_fragment
from runtime.stages.director_scene_context import (
    CONTRACT_VERSION as SCENE_CONTEXT_CONTRACT,
    canonicalize_director_scene_context,
    validate_director_scene_context,
)
from tests.api.fixtures.mock_story_run import MockModel, RESPONSES


def _evidence(ref: str = "SH001") -> list[dict[str, str]]:
    return [{"source_type": "storyboard_shot", "source_ref": ref}]


def _partition_context() -> dict:
    shots = [
        {"shot_id": f"SH00{i}", "scene_id": "SC001", "beat_id": "B001", "character_refs": ["char_001"]}
        for i in range(1, 5)
    ]
    return {
        "scene": {"scene_id": "SC001", "location_ref": "scene_001", "context_ref": ""},
        "storyboard_scene": {"scene_id": "SC001", "shots": shots},
        "program_owned": {
            "allowed_character_refs": ["char_001"],
            "allowed_beat_refs": ["B001"],
            "allowed_shot_refs": [shot["shot_id"] for shot in shots],
            "allowed_evidence_refs": [
                {"source_type": "storyboard_shot", "source_ref": shot["shot_id"]}
                for shot in shots
            ],
        },
    }


def _scene_value(phases: list[dict]) -> dict:
    return {
        "scene_id": "SC001",
        "contract_version": SCENE_CONTEXT_CONTRACT,
        "dramatic_function": {"summary": "同一 Beat 内发生连续戏剧转折。", "evidence_sources": _evidence()},
        "emotional_arc": phases,
        "relationship_dynamics": [],
        "reaction_strategy": {"priority": "medium", "preferred_reaction_shot_refs": ["SH002"]},
        "camera_strategy": {"stability": "stable", "framing_tendency": "medium_dominant", "movement_policy": "mostly_static"},
        "character_performance_baselines": [],
        "evidence_sources": _evidence(),
    }


def _phase(pid: str, shot_refs: list[str], function: str) -> dict:
    return {
        "phase_id": pid,
        "beat_refs": ["B001"],
        "shot_refs": shot_refs,
        "function": function,
        "intensity": "medium",
        "evidence_sources": _evidence(shot_refs[0]),
    }


def test_v1801_dramatic_turn_segmentation_allows_multiple_phases_inside_one_beat_with_complete_partition():
    ctx = _partition_context()
    value = _scene_value([
        _phase("P1", ["SH001"], "reveal"),
        _phase("P2", ["SH002"], "reaction"),
        _phase("P3", ["SH003"], "escalation"),
        _phase("P4", ["SH004"], "confirmation"),
    ])
    normalized, _ = canonicalize_director_scene_context(value, ctx)
    assert validate_director_scene_context(normalized, ctx) == []
    assert [p["function"] for p in normalized["emotional_arc"]] == ["reveal", "reaction", "escalation", "confirmation"]

    broken = copy.deepcopy(value)
    broken["emotional_arc"] = [
        _phase("P1", ["SH001", "SH003"], "reveal"),
        _phase("P2", ["SH002", "SH004"], "reaction"),
    ]
    errors = validate_director_scene_context(broken, ctx)
    assert any(e["type"] == "scene_context_phase_partition_invalid" for e in errors)


def _director_context() -> dict:
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
        "dialogue": [],
        "production_choices": [],
        "appearance_overlays": [],
    }
    return builder.director_context("SH001", previous_state_out={"characters": {}, "props": {}, "environment": {}}, production_semantics=semantics)


def test_v1801_scene_position_is_runtime_derived_creative_and_overrides_model_disagreement():
    ctx = _director_context()
    program = ctx["program_owned"]
    program.update({
        "scene_context_status": "available",
        "scene_position": "reaction",
        "scene_position_source": "scene_context",
        "scene_director_context": {
            "emotional_arc": [{"phase_id": "P1", "shot_refs": ["SH001"], "function": "reaction"}],
        },
    })
    raw = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
    raw["scene_position"] = "reveal"
    canonical, changes = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    assert changes > 0
    assert canonical["scene_position"] == "reaction"


def test_v1801_base_fact_constraints_are_hard_but_execution_fallback_is_not_forced():
    ctx = _director_context()
    payload = build_director_shot_payload(ctx, unit_id="director:SH001", is_first_global_shot=True)
    program = payload["program_owned"]
    assert "base_shot_design" not in program
    assert program["base_shot_fact_constraints"]["required_character_refs"] == ["char_001"]
    assert program["base_shot_fact_constraints"]["required_prop_refs"] == ["prop_001"]
    assert program["base_execution_fallback"] == {"shot_size": "medium", "camera": "eye_level", "movement": "static"}

    raw = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
    raw["execution_shot_design"] = {"shot_size": "close", "camera": "low_angle", "movement": "static"}
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    assert canonical["execution_shot_design"] == {"shot_size": "close", "camera": "low_angle", "movement": "static"}
    assert program["base_shot_fact_constraints"]["required_character_refs"] == ["char_001"]

    audit = build_shot_context_effect_audit(payload["shot"], canonical, program)
    assert audit["base_to_execution_delta"]["shot_size_changed"] is True
    assert audit["base_to_execution_delta"]["camera_changed"] is True
    assert audit["reaction_visualized"] is None

    reaction_shot = copy.deepcopy(payload["shot"])
    reaction_shot["dialogue"] = [{"character_id": "char_001", "line": "继续说。"}]
    reaction_director = copy.deepcopy(canonical)
    reaction_director["primary_subject_refs"] = ["char_002"]
    reaction_director["reaction_target_refs"] = ["char_002"]
    reaction_director["visual_target"] = {
        "target_type": "reaction", "character_refs": ["char_002"], "prop_refs": [], "environment_keys": [],
    }
    reaction_program = copy.deepcopy(program)
    reaction_program["allowed_character_refs"] = ["char_001", "char_002"]
    # v18.0_2+ audit requires explicit precision-first reaction candidate authority.
    reaction_program["reaction_candidate_refs"] = ["char_002"]
    reaction_audit = build_shot_context_effect_audit(reaction_shot, reaction_director, reaction_program)
    assert reaction_audit["reaction_visualized"] is True


class _InvalidPartitionModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_payloads: list[dict] = []

    def generate_json(self, stage, system_prompt, user_payload):
        if stage == "director_scene_context":
            self.calls.append(stage)
            program = user_payload["program_owned"]
            evidence = [copy.deepcopy(program["allowed_evidence_refs"][0])]
            return {"scene_director_context": {
                "scene_id": "SC001",
                "contract_version": SCENE_CONTEXT_CONTRACT,
                "dramatic_function": {"summary": "非法缺镜分区。", "evidence_sources": evidence},
                "emotional_arc": [],
                "relationship_dynamics": [],
                "reaction_strategy": {"priority": "low", "preferred_reaction_shot_refs": []},
                "camera_strategy": {"stability": "stable", "framing_tendency": "mixed", "movement_policy": "mostly_static"},
                "character_performance_baselines": [],
                "evidence_sources": evidence,
            }}
        if stage == "director_shot":
            self.director_payloads.append(copy.deepcopy(user_payload))
        return super().generate_json(stage, system_prompt, user_payload)


def test_v1801_partition_failure_repairs_once_then_whole_scene_falls_back_to_legacy_without_pollution(tmp_path):
    model = _InvalidPartitionModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", "v18.0_1-fail-soft")
    assert run["status"] == "completed", run.get("error")
    assert model.calls.count("director_scene_context") == 2
    record = run["artifacts"]["director_scene_contexts"]["SC001"]
    assert record["scene_context_status"] == "unavailable_after_repair"
    assert record["scene_director_context"] == {}
    assert len(model.director_payloads) == 1
    program = model.director_payloads[0]["program_owned"]
    assert program["scene_context_status"] == "unavailable_after_repair"
    assert program["scene_position"] is None
    assert program["scene_position_source"] == "legacy_model"
    assert program["reaction_opportunity"] is False
    assert run.get("error") in (None, {})
    assert not run.get("failure_history")

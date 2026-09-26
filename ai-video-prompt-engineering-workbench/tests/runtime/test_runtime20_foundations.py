from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path

import pytest

from runtime.checkpoints import CheckpointStore, unit_input_hash
from runtime.context_builder import ContextBuilder
from runtime.orchestrator import RuntimeV20
from app.store import RunStore
from tests.api.fixtures.mock_story_run import RESPONSES


CORE_HASHES = {
    "schemas/director_output_schema_v1_3.json": "5124e54565ee17814dd751f1fe4de530957225fdca744f7757d358a5b11abf7e",
    "src/prompt_foundry_v1_3/__init__.py": "a47b10ab631ceda9db28458593eb5b4191adc7ab1b43a2f7a24b9e1afe44bdf3",
    "src/prompt_foundry_v1_3/asset_compilers.py": "f55addc5501ee850aadb84c6567aeac4754d47b84861a0787874af066631d2da",
    "src/prompt_foundry_v1_3/director_contract.py": "f349bd25d3be9193e1157db3613b530a46f8bf278b86b58ab089519dde1b8510",
    "src/prompt_foundry_v1_3/pvb_optional.py": "6c5f2b4a7ae2aed80febe3842a9317b569215bfc67a802f6972bc91e472cb83e",
    "src/prompt_foundry_v1_3/shot_compiler.py": "b06cdbda6e13909f589ae093b6526a2ffbdf769a57518f70d262045fe06d6b29",
    "src/prompt_foundry_v1_3/state_resolver.py": "ccb63af4aa195dfe4111f490b973af3ec1686abb8f01cb48158f8730e7615d5d",
    "src/prompt_foundry_v1_3/static_evaluation.py": "b49f1651dd12321b2b5f1122ac57231cb5987c51c001c8b877bb464717422543",
}


class TwoShotModel:
    def __init__(self, *, fail_once_on: str | None = None):
        self.calls: list[tuple[str, str | None]] = []
        self.fail_once_on = fail_once_on
        self.failed = False

    def generate_json(self, stage, system_prompt, user_payload):
        unit_id = user_payload.get("unit_id")
        self.calls.append((stage, unit_id))
        if self.fail_once_on == unit_id and not self.failed:
            self.failed = True
            raise RuntimeError("synthetic director failure")

        if stage == "story_bible":
            return copy.deepcopy(RESPONSES["story_bible"])
        if stage == "scene_plan":
            plan = copy.deepcopy(RESPONSES["scene_plan"])
            plan["scenes"][0]["beat_list"].append({"beat_id": "B002", "description": "阿宁转身。", "type": "action"})
            return plan
        if stage == "script_scene":
            scene = copy.deepcopy(RESPONSES["script"]["scenes"][0])
            scene["beats"].append({"beat_id": "B002", "description": "阿宁转身。", "dialogue": []})
            return {"scene": scene}
        if stage == "storyboard_scene":
            scene = copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])
            scene["shots"].append({
                "shot_id": "SH002", "scene_id": "SC001", "beat_id": "B002", "character_refs": ["char_001"], "prop_refs": [],
                "shot_size": "medium", "camera": "eye_level", "movement": "static", "composition": "阿宁转身。",
                "duration": 3.0, "description": "阿宁转身。", "dialogue": [],
                "continuity": {"continuous_with_previous": True, "axis_side": "neutral", "eyeline_match": "not_applicable"},
                "source_evidence": [{"quote": "阿宁转身。"}],
            })
            return {"scene": scene}
        if stage == "production_semantics_shot":
            shot = user_payload.get("shot", {}) or {}
            evidence = (user_payload.get("program_owned", {}) or {}).get("current_shot_evidence") or []
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
                    for x in (shot.get("dialogue") or [])
                ],
                "diegetic_text": [],
                "production_choices": [],
                "appearance_overlays": [],
            }}
        if stage == "director_shot":
            shot_id = user_payload["shot"]["shot_id"]
            if shot_id == "SH001":
                director = copy.deepcopy(RESPONSES["director"]["scenes"][0]["shots"][0]["director"])
            else:
                director = {
                    "dramatic_intent": "呈现阿宁转身。",
                    "primary_subject_refs": ["char_001"],
                    "reaction_target_refs": [],
                    "performance_actions": [{
                        "character_ref": "char_001", "action": "转身。", "transformation_type": "physical_sequence_expansion",
                        "dependency_tags": ["upper_body"], "source_evidence": [{"quote": "阿宁转身。"}],
                    }],
                    "visual_focus": {"focus_type": "character", "subject_refs": ["char_001"], "body_regions": {"char_001": ["upper_body"]}, "prop_refs": [], "environment_keys": []},
                    "action_delta": {"characters": {}, "props": {}, "environment": {}},
                    "state_out": {"characters": {}, "props": {}, "environment": {}},
                    "continuity_scope": {"mode": "inherit"},
                }
            return {"director": director}
        if stage == "pvb_character":
            return {"character": copy.deepcopy(RESPONSES["pvb"]["characters"][0])}
        if stage == "psb_scene":
            return {"scene": copy.deepcopy(RESPONSES["psb"]["scenes"][0])}
        if stage == "style_guide":
            return copy.deepcopy(RESPONSES["style_guide"])
        raise AssertionError(stage)


def test_checkpoint_store_reuses_completed_unit_with_same_input_hash(tmp_path):
    checkpoints = CheckpointStore(tmp_path / "checkpoints")
    payload = {"shot_id": "SH001", "value": 1}
    input_hash = unit_input_hash(payload)
    checkpoints.save("run_x", "director:SH001", {
        "unit_id": "director:SH001", "status": "completed", "input_hash": input_hash, "output": {"ok": True}
    })

    hit = checkpoints.get_reusable("run_x", "director:SH001", payload)
    assert hit is not None
    assert hit["output"] == {"ok": True}
    assert checkpoints.get_reusable("run_x", "director:SH001", {"shot_id": "SH001", "value": 2}) is None


def test_director_context_is_minimal_and_excludes_other_shots_and_full_source():
    story = copy.deepcopy(RESPONSES["story_bible"])
    script = copy.deepcopy(RESPONSES["script"])
    board = copy.deepcopy(RESPONSES["storyboard_base"])
    other = copy.deepcopy(board["scenes"][0]["shots"][0])
    other["shot_id"] = "SH999"
    other["description"] = "OTHER_SHOT_SENTINEL"
    board["scenes"][0]["shots"].append(other)

    ctx = ContextBuilder(story_bible=story, script=script, storyboard_base=board).director_context(
        "SH001", previous_state_out={"characters": {}, "props": {}, "environment": {}}
    )
    serialized = json.dumps(ctx, ensure_ascii=False)
    assert ctx["shot"]["shot_id"] == "SH001"
    assert "source_text" not in ctx
    assert "state_in" not in ctx
    assert "previous_state_out" in ctx
    assert "OTHER_SHOT_SENTINEL" not in serialized
    assert ctx["assets"]["characters"].keys() == {"char_001"}
    assert ctx["assets"]["props"].keys() == {"prop_001"}


def test_runtime_pauses_on_one_director_shot_and_resumes_without_regenerating_previous_units(tmp_path):
    model = TwoShotModel(fail_once_on="director:SH002")
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。阿宁转身。", title="恢复测试")

    assert run["status"] == "paused"
    assert run["current_unit"] == "director:SH002"
    assert run["units"]["director:SH001"]["status"] == "completed"
    calls_before = list(model.calls)

    resumed = runtime.resume(run["run_id"])
    assert resumed["status"] == "completed"
    assert resumed["units"]["director:SH001"]["status"] == "completed"
    assert model.calls.count(("director_shot", "director:SH001")) == 1
    assert model.calls.count(("story_bible", "story_bible")) == 1
    assert len(model.calls) > len(calls_before)


def test_runtime_does_not_modify_frozen_core_files():
    root = Path(__file__).resolve().parents[2] / "packages" / "prompt_foundry_v13"
    for relative, expected in CORE_HASHES.items():
        actual = hashlib.sha256((root / relative).read_bytes()).hexdigest()
        assert actual == expected, relative


def test_director_v16_runtime_passes_recent_effective_design_to_next_shot(tmp_path):
    import copy
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20

    class DesignHistoryModel(TwoShotModel):
        def __init__(self):
            super().__init__()
            self.director_payloads = []

        def generate_json(self, stage, system_prompt, user_payload):
            if stage == 'director_shot':
                self.director_payloads.append(copy.deepcopy(user_payload))
            return super().generate_json(stage, system_prompt, user_payload)

    model = DesignHistoryModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / 'runs'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints'),
    )
    run = runtime.start('阿宁站在窗边，手里拿着信封。阿宁转身。', title='director v16 design history')
    assert run['status'] == 'completed'
    assert len(model.director_payloads) == 2
    first = model.director_payloads[0]['program_owned']
    second = model.director_payloads[1]['program_owned']
    assert first['recent_shot_designs'] == []
    assert second['recent_shot_designs'] == [{
        'shot_id': 'SH001', 'scene_id': 'SC001',
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'shot_purpose': 'continuity',
        'scene_position': 'setup',
        'execution_framing': {'framing_type': 'single', 'foreground_character_refs': []},
        'visual_target': {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []},
    }]

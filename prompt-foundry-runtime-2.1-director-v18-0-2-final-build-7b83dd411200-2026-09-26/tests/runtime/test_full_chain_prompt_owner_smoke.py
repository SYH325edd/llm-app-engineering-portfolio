from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from tests.api.fixtures.mock_story_run import RESPONSES


class PromptOwnerOnlyModel:
    """Return only fields the current Stage prompt says the model owns.

    This deliberately does not return the post-canonicalization structures used by
    older mocks. It catches prompt/runtime ownership mismatches across the entire
    production chain.
    """

    def __init__(self):
        self.calls: list[str] = []

    def generate_json(self, stage, system_prompt, payload):
        self.calls.append(stage)
        if stage == "story_bible":
            value = copy.deepcopy(RESPONSES["story_bible"])
            value["bible_id"] = ""
            value["project_id"] = ""
            value["version"] = 1
            for item in value["characters"]:
                item["character_id"] = ""
            for item in value["scenes"]:
                item["scene_id"] = ""
            for item in value["props"]:
                item["prop_id"] = ""
            return value
        if stage == "scene_plan":
            value = copy.deepcopy(RESPONSES["scene_plan"])
            for scene in value["scenes"]:
                scene.pop("scene_id", None)
                scene.pop("resume_context_ref", None)
                for beat in scene["beat_list"]:
                    beat.pop("beat_id", None)
            return value
        if stage == "script_scene":
            scene = copy.deepcopy(RESPONSES["script"]["scenes"][0])
            for key in ("scene_id", "context_ref", "location_ref"):
                scene.pop(key, None)
            for beat in scene["beats"]:
                beat.pop("beat_id", None)
            return {"scene": scene}
        if stage == "storyboard_scene":
            scene = copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])
            for key in ("scene_id", "context_ref", "location_ref"):
                scene.pop(key, None)
            for shot in scene["shots"]:
                shot.pop("shot_id", None)
                shot.pop("scene_id", None)
            return {"scene": scene}
        if stage == "pvb_character":
            return {"character": {
                "visual_identity": {
                    "age_appearance": "年轻成年女性", "face": "", "hair": "黑色中长发",
                    "body": "自然日常体态", "skin": "自然肤色",
                },
                "wardrobe": {
                    "default": "简洁日常服装", "outerwear": "浅色外套", "shirt": "素色上衣",
                    "footwear": "平底鞋", "accessory": "",
                },
            }}
        if stage == "psb_scene":
            return {"scene": {"production_visual": {
                "space": "尺度适中的普通室内空间", "layout": "窗边留出人物站立区域",
                "materials": "普通墙面与玻璃窗", "lighting": "自然日间窗光",
                "color": "低饱和自然色", "environment": "安静、生活化",
            }}}
        if stage == "style_guide":
            return {
                "era": "当代", "region": "中国城市", "genre": "现实主义",
                "tone": "克制写实", "visual_reference": "真实摄影质感",
            }
        if stage == "production_semantics_shot":
            shot = payload["shot"]
            quote = payload["program_owned"]["current_shot_evidence"][0]
            return {"production_semantics": {
                "visual_events": [{
                    "action": "阿宁站在窗边，手里拿着信封。",
                    "character_refs": list(shot.get("character_refs") or []),
                    "prop_refs": list(shot.get("prop_refs") or []),
                    "source_evidence": [{"quote": quote}],
                }],
                "audio_events": [], "renderability_status": "renderable", "renderability_issues": [],
                "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": [],
            }}
        if stage == "director_scene_context":
            program = payload["program_owned"]
            evidence = [copy.deepcopy(program["allowed_evidence_refs"][0])] if program.get("allowed_evidence_refs") else []
            return {"scene_director_context": {
                "scene_id": payload["scene"]["scene_id"],
                "contract_version": "director_scene_context.v1_1",
                "dramatic_function": {"summary": "建立人物当前状态。", "evidence_sources": evidence},
                "emotional_arc": [{
                    "phase_id": "phase_01", "beat_refs": list(program.get("allowed_beat_refs") or []),
                    "shot_refs": list(program.get("allowed_shot_refs") or []), "function": "setup",
                    "intensity": "low", "evidence_sources": evidence,
                }],
                "relationship_dynamics": [],
                "reaction_strategy": {"priority": "low", "preferred_reaction_shot_refs": []},
                "camera_strategy": {"stability": "stable", "framing_tendency": "medium_dominant", "movement_policy": "mostly_static"},
                "character_performance_baselines": [{
                    "character_ref": ref, "baseline_energy": "restrained", "baseline_control": "controlled", "baseline_social_posture": "guarded"
                } for ref in program.get("allowed_character_refs") or []],
                "evidence_sources": evidence,
            }}
        if stage == "director_shot":
            quote = payload["program_owned"]["current_shot_action_evidence"][0]
            return {"director": {
                "dramatic_intent": "呈现阿宁当前的可见状态。",
                "primary_subject_refs": ["char_001"],
                "reaction_target_refs": [],
                "performance_actions": [{
                    "character_ref": "char_001", "action": "站在窗边，手里拿着信封。",
                    "transformation_type": "visible_state_expression",
                    "dependency_tags": ["upper_body", "hands", "prop_interaction"],
                    "source_evidence": [{"quote": quote}],
                }],
                "visual_focus": {
                    "focus_type": "character", "subject_refs": ["char_001"],
                    "body_regions": {"char_001": ["upper_body", "hands"]},
                    "prop_refs": ["prop_001"], "environment_keys": [],
                },
                "action_delta": {"characters": {}, "props": {}, "environment": {}},
                "continuity_scope": {"mode": "reset"},
            }}
        raise AssertionError(f"unexpected stage: {stage}")


def test_full_chain_runs_when_model_returns_only_prompt_owned_fields(tmp_path):
    model = PromptOwnerOnlyModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )

    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="prompt-owner smoke")

    assert run["status"] == "completed", run.get("error")
    assert run["counts"]["shots"] == 1
    assert run["counts"]["shot_prompts"] == 1
    assert model.calls == [
        "story_bible", "scene_plan", "script_scene", "storyboard_scene",
        "pvb_character", "psb_scene", "style_guide",
        "production_semantics_shot", "director_scene_context", "director_shot",
    ]


class AdaptationRepairModel(PromptOwnerOnlyModel):
    def __init__(self):
        super().__init__()
        self.production_semantics_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage != "production_semantics_shot":
            return super().generate_json(stage, system_prompt, payload)
        self.calls.append(stage)
        self.production_semantics_attempts += 1
        shot = payload["shot"]
        quote = payload["program_owned"]["current_shot_evidence"][0]
        if self.production_semantics_attempts == 1:
            return {"production_semantics": {
                "visual_events": [], "audio_events": [],
                "renderability_status": "needs_adaptation",
                "renderability_issues": [{
                    "type": "underspecified_action", "detail": "需要最小可拍动作机制。",
                    "source_evidence": [{"quote": quote}],
                }],
                "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": [],
            }}
        assert payload["repair_instruction"]["mode"] == "repair_current_unit_only"
        return {"production_semantics": {
            "visual_events": [{
                "action": "阿宁站在窗边，手里拿着信封。",
                "character_refs": list(shot.get("character_refs") or []),
                "prop_refs": list(shot.get("prop_refs") or []),
                "source_evidence": [{"quote": quote}],
            }],
            "audio_events": [], "renderability_status": "renderable", "renderability_issues": [],
            "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": [],
        }}


def test_needs_adaptation_is_repaired_inside_production_semantics_before_gate(tmp_path):
    model = AdaptationRepairModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )

    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="adaptation repair")

    assert run["status"] == "completed", run.get("error")
    assert model.production_semantics_attempts == 2
    unit = run["units"]["production_semantics:SH001"]
    assert unit["repair_count"] == 1
    assert run["validations"]["production_semantics"]["passed"] is True

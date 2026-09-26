from __future__ import annotations

from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d
from runtime.production_readiness import validate_production_readiness
from runtime.storyboard_overload_feedback import build_storyboard_overload_feedback_from_board
from runtime.storyboard_redistribution import build_storyboard_redistribution_plan


def _style():
    return {
        "era": {"status": "locked", "value": "当代"},
        "region": {"status": "locked", "value": "中国城市社区"},
        "genre": {"status": "locked", "value": "现实主义生活流"},
        "tone": {"status": "locked", "value": "克制自然"},
        "visual_reference": {"status": "locked", "value": "低饱和暖调"},
    }


def _story():
    return {
        "characters": [{
            "character_id": "char_001", "canonical_name": "年轻人", "role_type": "main",
            "visual_lock": {
                "age_appearance": "二十岁出头", "face": "瘦长脸，颌线清晰",
                "hair": "黑色短发，两侧推短", "body": "等偏瘦，肩背平直，手臂线条自然",
                "skin": "偏黄的小麦色",
            },
        }],
        "scenes": [{
            "scene_id": "scene_001", "canonical_name": "修鞋摊",
            "visual_lock": {
                "space": "摊子不大", "layout": "一台手摇补鞋机；一个木头工具箱",
                "materials": "木头工具箱", "lighting": "自然暖光", "color": "暖黄与深棕为主",
            },
        }],
        "props": [],
    }


def _pvb():
    return {"characters": [{
        "character_id": "char_001",
        "visual_identity": {},
        "wardrobe": {"default": {"status": "locked", "value": "黑色短袖T恤，深灰色休闲长裤"}},
    }]}


def _shot(*, dialogue: bool = False, purpose: str = "continuity"):
    return {
        "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "location_ref": "scene_001",
        "duration": 5.0, "character_refs": ["char_001"], "prop_refs": [],
        "shot_size": "medium_close", "camera": "eye_level", "movement": "static",
        "composition": "年轻人位于画面中央", "description": "",
        "dialogue": [{"character_id": "char_001", "line": "后来呢？"}] if dialogue else [],
        "narration": [], "state_in": {"characters": {}, "props": {}, "environment": {}},
        "director": {
            "shot_purpose": purpose,
            "dramatic_intent": "",
            "performance_actions": ([{
                "character_ref": "char_001", "action": "年轻人抬眼开口问：“后来呢？”",
                "source_evidence": [{"quote": "后来呢？"}],
            }] if dialogue else []),
            "visual_focus": {}, "speaker_target_refs": ["char_001"] if dialogue else [],
        },
    }


def _semantics(*, dialogue: bool = False):
    return {
        "shot_id": "SH001", "renderability_status": "renderable", "renderability_issues": [],
        "visual_events": [], "audio_events": [], "diegetic_text": [], "production_choices": [],
        "appearance_overlays": [],
        "dialogue": ([{"character_id": "char_001", "line": "后来呢？", "offscreen": False}] if dialogue else []),
    }


def _script():
    return {"scenes": [{"scene_id": "SC001", "scene_heading": "修鞋摊 - 下午"}]}


def test_v2e_compact_continuity_normalizes_asset_residue_and_cross_field_scene_duplicates():
    result = compile_shot_consumption_prompt_v2d(
        _shot(), _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    prompt = result["prompt_seedance"] or ""
    assert result["compiler_version"] == "consumption_v2m"
    assert "等偏瘦" not in prompt
    assert "偏瘦" not in prompt  # medium-close anchor keeps visible identity/wardrobe, not nonessential body detail
    assert "短袖短袖" not in prompt
    assert "黑色短袖上衣" in prompt
    anchor = result["shot_consumption_manifest"]["scene_continuity_anchor"]
    assert anchor.count("木头工具箱") == 1
    assert result["resolved_refs"]["continuity_anchor_version"] == "continuity_anchor_v2"


def test_v2e_exact_dialogue_is_only_in_dialogue_track_not_visual_content():
    result = compile_shot_consumption_prompt_v2d(
        _shot(dialogue=True, purpose="speaker"), _semantics(dialogue=True), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    manifest = result["shot_consumption_manifest"]
    assert "后来呢？" not in manifest["visual_content"]
    assert "后来呢？" in manifest["dialogue"]
    assert manifest["performance_source"] == "director"


def test_production_readiness_warns_on_critical_performance_fallback():
    shot = _shot(purpose="reaction")
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    readiness = validate_production_readiness(compiled_project={"shot_prompts": [result]}, shot_specs=[shot])
    assert readiness["passed"] is True
    assert not [x for x in readiness["errors"] if x.get("type") == "E025_PERFORMANCE_NOT_EXECUTABLE"]
    assert any(x.get("type") == "W027_PERFORMANCE_NOT_EXECUTABLE" for x in readiness["warnings"])


def test_pre_director_duration_feedback_returns_long_multi_sentence_dialogue_to_allocator():
    script = {"scenes": [{
        "scene_id": "SC001",
        "beats": [{
            "beat_id": "B001", "description": "老周继续说往事。",
            "dialogue": [{
                "dialogue_id": "D001", "character_id": "char_001",
                "line": "九几年，我在这修鞋。有个小伙子，天天路过。后来他租了我隔壁的门面，开杂货铺。我俩常一起吃饭。",
            }],
        }],
    }]}
    # FrozenText v16 splits the utterance into four complete strong-punctuation units.
    from runtime.stages.storyboard import build_frozen_text_units
    units = build_frozen_text_units(script["scenes"][0])["B001"]["dialogue"]
    refs = [x["unit_id"] for x in units]
    board = {"scenes": [{
        "scene_id": "SC001", "shots": [{
            "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "duration": 6.0,
            "dialogue": [{"character_id": "char_001", "line": x["text"]} for x in units],
            "narration": [], "frozen_text_unit_refs": {"dialogue": refs, "narration": []},
        }],
    }]}
    feedback = build_storyboard_overload_feedback_from_board(board, script, run_id="r", build_id="b")
    assert feedback["shots"][0]["classification"] == "overloaded"
    plan = build_storyboard_redistribution_plan(feedback)
    assert plan["validation"]["passed"] is True
    assert plan["shot_plans"][0]["plan_status"] == "preview_ready"
    assert len(plan["shot_plans"][0]["preview_shots"]) == 4


def test_v2e_consumption_input_hash_changes_when_resolved_character_anchor_changes():
    first = compile_shot_consumption_prompt_v2d(
        _shot(), _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    changed_pvb = _pvb()
    changed_pvb["characters"][0]["wardrobe"]["default"]["value"] = "白色长袖衬衫，深灰色休闲长裤"
    second = compile_shot_consumption_prompt_v2d(
        _shot(), _semantics(), _story(), _script(), changed_pvb, {"scenes": []}, _style()
    )
    assert first["resolved_refs"]["character_anchor_hash"] != second["resolved_refs"]["character_anchor_hash"]
    assert first["resolved_refs"]["consumption_input_hash"] != second["resolved_refs"]["consumption_input_hash"]


def test_final_shotspec_duration_authority_extends_before_compile(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_unitization import MultiUnitModel

    rt = RuntimeV20(
        model=MultiUnitModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    shot = {
        "shot_id": "SH001", "scene_id": "SC001", "duration": 1.0,
        "dialogue": [], "movement": "static",
        "director": {"performance_actions": [{"action": "人物起身走到门口。"}]},
    }
    artifacts = {
        "shot_specs": [shot],
        "storyboard": {"scenes": [{"scene_id": "SC001", "shots": [{"shot_id": "SH001", "duration": 1.0}]}]},
        "duration_authority_report": {"status": "passed", "basis": "test"},
    }
    run = {"run_id": "r", "validations": {}, "events": []}
    rt._apply_final_shotspec_duration_authority(run, artifacts)
    assert artifacts["shot_specs"][0]["duration"] == 2.0
    assert artifacts["storyboard"]["scenes"][0]["shots"][0]["duration"] == 2.0
    assert artifacts["duration_authority_report"]["final_shotspec_duration_changes"][0]["shot_id"] == "SH001"


def test_production_readiness_warns_camera_monotony_without_mutating_shots():
    compiled = []
    specs = []
    for index in range(1, 4):
        shot = _shot()
        shot["shot_id"] = f"SH{index:03d}"
        shot["scene_id"] = "SC001"
        result = compile_shot_consumption_prompt_v2d(
            shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
        )
        result["shot_id"] = shot["shot_id"]
        compiled.append(result)
        specs.append(shot)
    before = [(x["shot_size"], x["camera"], x["movement"]) for x in specs]
    readiness = validate_production_readiness(compiled_project={"shot_prompts": compiled}, shot_specs=specs)
    assert readiness["passed"] is True
    assert any(x["type"] == "camera_language_monotony" for x in readiness["warnings"])
    after = [(x["shot_size"], x["camera"], x["movement"]) for x in specs]
    assert after == before


def test_v2e_uniquely_recoverable_speech_cue_truncation_is_normalized_before_readiness():
    shot = _shot(dialogue=True, purpose="speaker")
    shot["director"]["performance_actions"][0]["action"] = "年轻人身体前倾，开口追。"
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    visual = result["shot_consumption_manifest"]["visual_content"]
    assert "开口追问" in visual
    assert "开口追。" not in visual
    readiness = validate_production_readiness(compiled_project={"shot_prompts": [result]}, shot_specs=[shot])
    assert not any(x["type"] == "production_text_suspected_truncation" for x in readiness["errors"])


def test_v2e_uniquely_recoverable_tone_cue_truncation_is_normalized_before_readiness():
    shot = _shot(dialogue=True, purpose="speaker")
    shot["director"]["performance_actions"][0]["action"] = "年轻人看向老周，语气带着询。"
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    visual = result["shot_consumption_manifest"]["visual_content"]
    assert "语气带着询问" in visual
    assert "语气带着询。" not in visual
    readiness = validate_production_readiness(compiled_project={"shot_prompts": [result]}, shot_specs=[shot])
    assert not any(x["type"] == "production_text_suspected_truncation" for x in readiness["errors"])

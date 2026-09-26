from __future__ import annotations

import copy
import json
from pathlib import Path

from runtime.consumption_compiler import (
    compile_character_consumption_prompt,
    compile_project_consumption_v1,
    compile_scene_consumption_prompt,
    compile_shot_consumption_prompt_v1,
)
from runtime.consumption_lint import estimate_min_duration
from runtime.shot_manifest import build_shot_consumption_manifest

ROOT = Path(__file__).resolve().parents[2]


def test_final_manifest_merges_same_speaker_continuation_segments_into_one_utterance():
    story = {"characters": [{"character_id": "char_001", "canonical_name": "来访者"}]}
    shot = {
        "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "duration": 4,
        "character_refs": ["char_001"], "prop_refs": [], "composition": "来访者站在门口。",
        "dialogue": [
            {"character_id": "char_001", "line": "老师，"},
            {"character_id": "char_001", "line": "这份材料还要改吗？"},
        ],
        "frozen_text_unit_refs": {"dialogue": ["FTU_B001_D001", "FTU_B001_D002"], "narration": []},
    }
    semantics = {
        "dialogue": [
            {"character_id": "char_001", "line": "老师，", "offscreen": False},
            {"character_id": "char_001", "line": "这份材料还要改吗？", "offscreen": False},
        ],
        "audio_events": [], "appearance_overlays": [], "diegetic_text": [], "visual_events": [],
    }
    manifest = build_shot_consumption_manifest(
        shot, semantics, story, {"scenes": []}, {"characters": []}, {"scenes": []}, {},
        shot_index=1, shot_size_label="中景", camera_label="平视机位", movement_label="固定镜头", scene_name="门口",
    )
    assert manifest["dialogue"] == "来访者（画内）：“老师，这份材料还要改吗？”"


def _real_run():
    return json.loads((ROOT / "tests" / "fixtures" / "consumption_regression_run.json").read_text(encoding="utf-8"))


def _shot(run, shot_id):
    return next(x for x in run["artifacts"]["shot_specs"] if x["shot_id"] == shot_id)


def test_character_prompt_is_chinese_consumption_asset_and_phase_wardrobe_is_explicit():
    a = _real_run()["artifacts"]
    result = compile_character_consumption_prompt(a["story_bible"], a["pvb"], a["style_guide"], "char_002")
    prompt = result["prompt_gpt_image"]
    assert "人物锁定" in prompt
    assert "基础服装" in prompt
    assert "阶段服装" in prompt
    assert "灰色风衣" in prompt and "第七天" in prompt and "羽绒服" in prompt
    assert "Quiet realism" not in prompt
    assert "Neorealist" not in prompt
    assert "char_002" not in prompt


def test_scene_prompt_removes_story_history_future_light_and_analysis_notes():
    a = _real_run()["artifacts"]
    result = compile_scene_consumption_prompt(a["story_bible"], a["psb"], a["style_guide"], "scene_001")
    prompt = result["prompt_gpt_image"]
    assert "空间结构" in prompt
    assert "白炽灯管" in prompt
    assert "周迟曾靠在货架旁擦咖啡机" not in prompt
    assert "原文未" not in prompt
    assert "天快亮" not in prompt
    assert "灰白天光" not in prompt
    assert "fluorescent" not in prompt.lower()


def test_stage0_mixed_baseline_remains_one_ok_one_warning_four_blocked():
    run = _real_run(); a = run["artifacts"]
    project = compile_project_consumption_v1(
        run["run_id"], a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"], a["shot_specs"]
    )
    by_id = {x["shot_id"]: x for x in project["shot_prompts"]}
    assert by_id["SH008"]["compile_status"] == "ok"
    assert by_id["SH043"]["compile_status"] == "warning"
    for sid in ["SH017", "SH034", "SH041", "SH049"]:
        assert by_id[sid]["compile_status"] == "blocked"
        assert by_id[sid]["prompt_seedance"] is None
    assert {e["code"] for e in by_id["SH017"]["errors"]} == {"E003_SPATIOTEMPORAL_POLLUTION"}
    assert "E001_ENTITY_MISBIND" in {e["code"] for e in by_id["SH034"]["errors"]}
    assert "E001_ENTITY_MISBIND" in {e["code"] for e in by_id["SH049"]["errors"]}
    assert "W003_DURATION_RISK" in {w["code"] for w in by_id["SH043"]["warnings"]}
    assert "W007_STYLE_HARD_FACT_DRIFT" in {w["code"] for w in by_id["SH008"]["warnings"]}


def test_inherited_visible_action_is_not_misclassified_as_cross_shot_pollution():
    run = _real_run(); a = run["artifacts"]
    shot = _shot(run, "SH018")
    result = compile_shot_consumption_prompt_v1(shot, a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
    assert "E003_SPATIOTEMPORAL_POLLUTION" not in {e["code"] for e in result["errors"]}
    assert result["compile_status"] != "blocked"
    assert "擦咖啡机" in (result["prompt_seedance"] or "")


def test_consumption_prompt_does_not_leak_ir_or_repeat_long_style():
    run = _real_run(); a = run["artifacts"]
    for sid in ["SH008", "SH043"]:
        result = compile_shot_consumption_prompt_v1(_shot(run, sid), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
        prompt = result["prompt_seedance"] or ""
        for bad in ["outerwear_changed", "left_wrist_visible", "at_window_seat", "action_state", "held_by", "char_001", "char_002", "axis_side", "True", "False", "Neorealist", "Quiet realism"]:
            assert bad not in prompt
        assert result["compiler_version"] == "consumption_v1"
        assert result["prompt_metrics"]["char_count"] == len(prompt)


def test_sh043_duration_estimate_is_warning_calibration_not_blocker():
    run = _real_run(); shot = _shot(run, "SH043")
    estimate = estimate_min_duration(shot)
    assert estimate >= 10.0
    a = run["artifacts"]
    result = compile_shot_consumption_prompt_v1(shot, a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
    assert result["compile_status"] == "warning"
    assert "W003_DURATION_RISK" in {w["code"] for w in result["warnings"]}


def test_project_manifest_has_version_status_and_shot_level_atomicity():
    run = _real_run(); a = run["artifacts"]
    project = compile_project_consumption_v1(run["run_id"], a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"], a["shot_specs"])
    assert project["compiler_version"] == "consumption_v1"
    assert project["compile_manifest"] == {
        "asset_compiler": "consumption_v1",
        "shot_compiler": "consumption_v1",
        "lint": "consumption_lint_v1",
    }
    assert project["compile_status"] == "partial_blocked"
    assert len(project["shot_prompts"]) == len(a["shot_specs"])
    assert any(x["compile_status"] == "blocked" for x in project["shot_prompts"])
    assert any(x["prompt_seedance"] for x in project["shot_prompts"])


def test_prop_lint_does_not_treat_dialogue_or_indirect_story_mentions_as_visible_prop_binding():
    run = _real_run(); a = run["artifacts"]
    for sid in ["SH012", "SH020"]:
        result = compile_shot_consumption_prompt_v1(_shot(run, sid), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
        assert "E001_ENTITY_MISBIND" not in {e["code"] for e in result["errors"]}, (sid, result["errors"])


def test_cross_shot_lint_matches_current_description_by_clauses_not_only_whole_sentence():
    run = _real_run(); a = run["artifacts"]
    result = compile_shot_consumption_prompt_v1(_shot(run, "SH044"), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
    assert "E003_SPATIOTEMPORAL_POLLUTION" not in {e["code"] for e in result["errors"]}, result["errors"]


def test_inherited_visible_state_accepts_semantic_equivalents_but_keeps_other_cross_shot_errors():
    run = _real_run(); a = run["artifacts"]
    sh023 = compile_shot_consumption_prompt_v1(_shot(run, "SH023"), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
    refs_023 = {e["source_ref"] for e in sh023["errors"] if e["code"] == "E003_SPATIOTEMPORAL_POLLUTION"}
    assert "shots[SH023].director.performance_actions[1]" not in refs_023  # state_in=带笑 supports “笑了”
    assert "shots[SH023].director.performance_actions[2]" in refs_023

    sh046 = compile_shot_consumption_prompt_v1(_shot(run, "SH046"), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
    refs_046 = {e["source_ref"] for e in sh046["errors"] if e["code"] == "E003_SPATIOTEMPORAL_POLLUTION"}
    assert "shots[SH046].director.performance_actions[2]" not in refs_046  # inherited eating_oden state
    assert "shots[SH046].director.performance_actions[1]" in refs_046      # next-shot coffee action


def test_prop_lint_still_blocks_directly_handled_wrong_props_after_false_positive_reduction():
    run = _real_run(); a = run["artifacts"]
    for sid in ["SH027", "SH029", "SH030", "SH032", "SH033", "SH034", "SH042", "SH049"]:
        result = compile_shot_consumption_prompt_v1(_shot(run, sid), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
        assert "E001_ENTITY_MISBIND" in {e["code"] for e in result["errors"]}, (sid, result["errors"])


def test_character_asset_avoids_repeating_default_upper_garment_and_separates_stable_outerwear():
    a = _real_run()["artifacts"]
    zhou = compile_character_consumption_prompt(a["story_bible"], a["pvb"], a["style_guide"], "char_001")["prompt_gpt_image"]
    woman = compile_character_consumption_prompt(a["story_bible"], a["pvb"], a["style_guide"], "char_002")["prompt_gpt_image"]
    assert zhou.count("黑色长袖") == 1
    assert "外层服装：" in zhou and "深灰色薄款拉链连帽外套" in zhou
    assert woman.count("黑色长袖") == 1
    assert "阶段服装：" in woman


def test_dialogue_action_prompt_does_not_add_duplicate_sentence_punctuation_after_quoted_line():
    run = _real_run(); a = run["artifacts"]
    result = compile_shot_consumption_prompt_v1(_shot(run, "SH043"), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
    prompt = result["prompt_seedance"] or ""
    assert "。”。" not in prompt
    assert "！”。" not in prompt
    assert "？”。" not in prompt


def test_user_facing_lint_details_do_not_leak_raw_internal_english_state_tokens():
    run = _real_run(); a = run["artifacts"]
    for sid in ["SH017", "SH041", "SH049"]:
        result = compile_shot_consumption_prompt_v1(_shot(run, sid), a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"])
        details_text = "\n".join(str(x.get("detail") or "") for x in (result["errors"] + result["warnings"]))
        for raw in ["State In", "Style Guide", "fluorescent-lit", "prop_002", "being_poured_as_coffee", "wide", "hands", "upper_body"]:
            assert raw not in details_text, (sid, raw, details_text)


def test_project_aggregates_scene_asset_warnings_without_inserting_them_into_prompt():
    run = _real_run(); a = run["artifacts"]
    project = compile_project_consumption_v1(run["run_id"], a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"], a["shot_specs"])
    asset_warnings = [w for w in project["warnings"] if w.get("target_type") == "scene"]
    assert any(w["code"] == "W001_MISSING_COLOR" and w.get("target_id") == "scene_001" for w in asset_warnings)
    scene = next(x for x in project["scene_prompts"] if x["scene_id"] == "scene_001")
    assert "W001_MISSING_COLOR" not in scene["prompt_gpt_image"]
    assert "配色信息缺失" not in scene["prompt_gpt_image"]


def test_scene_asset_prompt_filters_dynamic_story_time_and_event_clauses():
    story_bible = {
        "scenes": [{
            "scene_id": "scene_001",
            "canonical_name": "街角豆浆摊",
            "visual_lock": {
                "space": "街角",
                "layout": "摊子上后来多摆了一个小板凳",
                "materials": "三轮车为深色铁架车体",
                "environment": "豆浆锅的热气腾起来，把整条街都熏得暖暖的",
                "lighting": "凌晨四点路灯还亮着",
                "color": "铁架车身呈深灰色",
            },
        }],
        "characters": [],
        "props": [],
    }
    result = compile_scene_consumption_prompt(story_bible, {"scenes": []}, {"era": {"status": "locked", "value": "当代"}}, "scene_001")
    prompt = result["prompt_gpt_image"]
    assert "多摆了一个小板凳" not in prompt
    assert "热气腾起来" not in prompt
    assert "街角" in prompt
    assert "深色铁架车体" in prompt


def test_shot_prompt_avoids_duplicate_dialogue_from_action_cue_and_single_emits_context():
    story_bible = {
        "characters": [{"character_id": "char_001", "canonical_name": "老张"}],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "街角豆浆摊", "visual_lock": {"lighting": "凌晨四点路灯还亮着"}}],
        "props": [],
    }
    script = {"scenes": [{"scene_id": "scene_001", "scene_heading": "街角豆浆摊 - 凌晨四点"}]}
    shot = {
        "shot_id": "SH001", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001"], "prop_refs": [], "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "老张站在摊前。",
        "description": "凌晨四点，路灯还亮着，老张站在摊前。",
        "dialogue": [{"character_id": "char_001", "line": "送的。"}],
        "director": {"performance_actions": [{"character_ref": "char_001", "action": "说出“送的。”"}], "visual_focus": {}, "speaker_target_refs": ["char_001"]},
        "state_in": {"characters": {"char_001": {"position": "at_counter"}}},
    }
    result = compile_shot_consumption_prompt_v1(shot, story_bible, script, {"characters": []}, {"scenes": []}, {})
    prompt = result["prompt_seedance"] or ""
    assert prompt.count("送的") == 1
    assert prompt.count("凌晨四点") == 1
    assert prompt.count("路灯还亮着") <= 1
    assert "开始状态：老张，柜台旁" not in prompt


def test_dialogue_only_prop_mentions_do_not_trigger_entity_misbind_block():
    story_bible = {
        "characters": [{"character_id": "char_001", "canonical_name": "老张"}, {"character_id": "char_002", "canonical_name": "林小雨"}],
        "scenes": [{"scene_id": "scene_004", "canonical_name": "病房", "visual_lock": {}}],
        "props": [
            {"prop_id": "prop_soup", "canonical_name": "鸡汤", "aliases": []},
            {"prop_id": "prop_soymilk", "canonical_name": "豆浆", "aliases": []},
            {"prop_id": "prop_bowl", "canonical_name": "碗", "aliases": []},
        ],
    }
    shot = {
        "shot_id": "SH032", "scene_id": "scene_004", "location_ref": "scene_004", "duration": 6.0,
        "character_refs": ["char_001", "char_002"], "prop_refs": ["prop_soup", "prop_bowl"],
        "shot_size": "medium", "camera": "eye_level", "movement": "static", "composition": "病床旁。",
        "description": "老张把鸡汤倒进碗里，说：‘你天天喝我的豆浆，我也没给你加过钱。这碗鸡汤，也不要钱。’",
        "dialogue": [
            {"character_id": "char_001", "line": "你天天喝我的豆浆，我也没给你加过钱。"},
            {"character_id": "char_001", "line": "这碗鸡汤，也不要钱。"},
        ],
        "director": {"performance_actions": [{"character_ref": "char_001", "action": "把鸡汤倒进碗里"}], "visual_focus": {}, "speaker_target_refs": ["char_001"]},
        "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(shot, story_bible, {"scenes": []}, {"characters": []}, {"scenes": []}, {})
    assert "E001_ENTITY_MISBIND" not in {e["code"] for e in result["errors"]}
    assert result["compile_status"] != "blocked"



def _minimal_cn_story_for_gate():
    return {
        "characters": [
            {"character_id": "char_001", "canonical_name": "老周", "role_type": "main", "visual_lock": {}},
            {"character_id": "char_002", "canonical_name": "年轻人", "role_type": "supporting", "visual_lock": {}},
        ],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "小区门口修鞋摊", "visual_lock": {}}],
        "props": [],
    }


def _minimal_cn_script_for_gate():
    return {"scenes": [{"scene_id": "scene_001", "scene_heading": "小区门口修鞋摊 - 下午"}]}


def test_shot_prompt_blocks_english_composition_instead_of_falling_back_to_mixed_language():
    shot = {
        "shot_id": "SH001", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001"], "prop_refs": [], "shot_size": "wide", "camera": "eye_level", "movement": "static",
        "composition": "Wide framing of the residential gate and shoe repair stall.",
        "description": "老周坐在修鞋摊前。", "dialogue": [],
        "director": {"performance_actions": [], "visual_focus": {}, "speaker_target_refs": []},
        "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(shot, _minimal_cn_story_for_gate(), _minimal_cn_script_for_gate(), {"characters": []}, {"scenes": []}, {})
    assert result["compile_status"] == "blocked"
    assert result["prompt_seedance"] is None
    issue = next(e for e in result["errors"] if e["code"] == "E007_NON_CHINESE_OUTPUT")
    assert issue["source_layer"] == "Storyboard Base / ShotSpec"
    assert "基础分镜" in issue["suggested_fix"]


def test_shot_prompt_blocks_english_director_action_instead_of_mixing_it_with_chinese_dialogue():
    shot = {
        "shot_id": "SH012", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001", "char_002"], "prop_refs": [], "shot_size": "medium_close", "camera": "eye_level", "movement": "static",
        "composition": "老周面对年轻人。", "description": "老周开口回答。",
        "dialogue": [{"character_id": "char_001", "line": "一个朋友的。"}],
        "director": {
            "performance_actions": [
                {"character_ref": "char_001", "action": "opens his mouth to speak, saying that the key belongs to a friend"},
                {"character_ref": "char_002", "action": "listens"},
            ],
            "visual_focus": {}, "speaker_target_refs": ["char_001"],
        },
        "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(shot, _minimal_cn_story_for_gate(), _minimal_cn_script_for_gate(), {"characters": []}, {"scenes": []}, {})
    assert result["compile_status"] == "blocked"
    assert result["prompt_seedance"] is None
    issues = [e for e in result["errors"] if e["code"] == "E007_NON_CHINESE_OUTPUT"]
    assert any(e["source_layer"] == "Director" for e in issues)
    assert any("导演执行" in e["suggested_fix"] for e in issues)


def test_scene_asset_filters_smell_people_actions_and_time_locked_lighting_and_compresses_style():
    story = {
        "scenes": [{
            "scene_id": "scene_001", "canonical_name": "小区门口修鞋摊",
            "visual_lock": {
                "space": "小区门口",
                "layout": "摊子不大，一台手摇补鞋机，一个木头工具箱，几把塑料凳",
                "materials": "木头工具箱；塑料凳",
                "environment": "胶水味混着灰尘在空气里散开；几个年轻人在里面笑",
                "lighting": "夕阳",
                "color": "夕阳映照下的暖橙色调，混合木头工具箱的深棕与磨损处的暗铜色",
            },
        }],
        "characters": [], "props": [],
    }
    style = {
        "era": {"status": "locked", "value": "20世纪90年代末至当代"},
        "region": {"status": "locked", "value": "中国城市普通小区门口及街边"},
        "genre": {"status": "locked", "value": "现实主义生活温情短剧"},
        "tone": {"status": "locked", "value": "克制平淡、隐忍深情，带些许时代变迁的怅惘"},
        "visual_reference": {"status": "locked", "value": "中国城市街头修鞋摊与旧城生活气息；夕阳下的老旧小区门口、斑驳路面的写实质感；色调偏暖而素朴，带胶片颗粒感与怀旧氛围。"},
    }
    result = compile_scene_consumption_prompt(story, {"scenes": []}, style, "scene_001")
    prompt = result["prompt_gpt_image"]
    assert "胶水味" not in prompt
    assert "年轻人在里面笑" not in prompt
    assert "夕阳" not in prompt
    style_block = prompt.split("视觉基调：\n", 1)[1].split("\n\n保持：", 1)[0]
    assert len(style_block) < 80
    assert "隐忍深情" not in style_block
    assert "怅惘" not in style_block
    assert "修鞋摊" not in style_block
    assert "写实" in style_block


def test_blocked_shot_exposes_source_layer_and_suggested_fix_for_user_recovery():
    story = _minimal_cn_story_for_gate()
    story["props"] = [
        {"prop_id": "prop_001", "canonical_name": "钥匙", "aliases": []},
        {"prop_id": "prop_002", "canonical_name": "工具箱", "aliases": []},
    ]
    shot = {
        "shot_id": "SH032", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001"], "prop_refs": ["prop_002"], "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "老周站在工具箱前。", "description": "老周拿起钥匙。", "dialogue": [],
        "director": {"performance_actions": [], "visual_focus": {}, "speaker_target_refs": []}, "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(shot, story, _minimal_cn_script_for_gate(), {"characters": []}, {"scenes": []}, {})
    assert result["compile_status"] == "blocked"
    issue = next(e for e in result["errors"] if e["code"] == "E001_ENTITY_MISBIND")
    assert issue["source_layer"] == "Storyboard Base"
    assert "suggested_fix" in issue
    assert "基础分镜" in issue["suggested_fix"]
    assert result["source_layer"] == "Storyboard Base"
    assert "基础分镜" in result["suggested_fix"]



def test_character_asset_removes_time_specific_lighting_from_stable_identity_and_compresses_style():
    story = {
        "characters": [{
            "character_id": "char_001", "canonical_name": "老周", "role_type": "main",
            "visual_lock": {"face": "脸上的皱纹在夕阳里堆着", "age_appearance": "老人"},
        }],
        "scenes": [], "props": [],
    }
    style = {
        "genre": {"status": "locked", "value": "现实主义生活温情短剧"},
        "tone": {"status": "locked", "value": "克制平淡、隐忍深情，带些许时代变迁的怅惘"},
        "visual_reference": {"status": "locked", "value": "夕阳下的老旧小区门口，色调偏暖，带胶片颗粒感与怀旧氛围"},
    }
    result = compile_character_consumption_prompt(story, {"characters": []}, style, "char_001")
    prompt = result["prompt_gpt_image"]
    assert "夕阳" not in prompt
    assert "皱纹" in prompt
    style_block = prompt.split("视觉基调：\n", 1)[1].split("\n\n保持：", 1)[0]
    assert len(style_block) < 80
    assert "隐忍深情" not in style_block
    assert "怅惘" not in style_block


def test_non_visual_smell_description_is_not_serialized_as_shot_action():
    story = _minimal_cn_story_for_gate()
    shot = {
        "shot_id": "SH011", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 3.0,
        "character_refs": ["char_001"], "prop_refs": [], "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "老周低头坐在修鞋摊前。", "description": "胶水味混着灰尘在空气里散开。", "dialogue": [],
        "director": {"performance_actions": [], "visual_focus": {}, "speaker_target_refs": []}, "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(shot, story, _minimal_cn_script_for_gate(), {"characters": []}, {"scenes": []}, {})
    prompt = result["prompt_seedance"] or ""
    assert "胶水味" not in prompt
    assert "气味" not in prompt


def test_consumption_compiler_removes_dialogue_semantic_restatement_from_speaking_cue():
    story = {
        "characters": [
            {"character_id": "char_001", "canonical_name": "甲"},
            {"character_id": "char_002", "canonical_name": "乙"},
        ],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "室内", "visual_lock": {}}],
        "props": [],
    }
    script = {"scenes": [{"scene_id": "scene_001", "scene_heading": "室内"}]}
    shot = {
        "shot_id": "SH001", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 5.0,
        "character_refs": ["char_001", "char_002"], "prop_refs": [], "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "两人隔桌相对。", "description": "两人交谈。",
        "dialogue": [
            {"character_id": "char_001", "line": "等多久？"},
            {"character_id": "char_002", "line": "半个月。"},
        ],
        "director": {
            "speaker_target_refs": ["char_001", "char_002"],
            "performance_actions": [
                {"character_ref": "char_001", "action": "问等多久"},
                {"character_ref": "char_002", "action": "回答半个月"},
            ],
            "visual_focus": {},
        },
        "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(shot, story, script, {"characters": []}, {"scenes": []}, {})
    prompt = result["prompt_seedance"] or ""
    assert "问等多久" not in prompt
    assert "回答半个月" not in prompt
    assert "甲问：“等多久？”" in prompt
    assert "乙回答：“半个月。”" in prompt


def test_consumption_state_is_rendered_as_natural_sentence_not_field_dump():
    story = {
        "characters": [
            {"character_id": "char_001", "canonical_name": "甲"},
            {"character_id": "char_002", "canonical_name": "乙"},
        ],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "室内", "visual_lock": {}}],
        "props": [],
    }
    script = {"scenes": [{"scene_id": "scene_001", "scene_heading": "室内"}]}
    shot = {
        "shot_id": "SH001", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001", "char_002"], "prop_refs": [], "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "两人一高一低。", "description": "乙把小零件放到甲手里。", "dialogue": [],
        "director": {"speaker_target_refs": [], "performance_actions": [], "visual_focus": {}},
        "state_in": {
            "characters": {
                "char_001": {"position": "地上", "posture": "蹲下"},
                "char_002": {"position": "甲面前", "posture": "弯腰"},
            }
        },
    }
    result = compile_shot_consumption_prompt_v1(shot, story, script, {"characters": []}, {"scenes": []}, {})
    prompt = result["prompt_seedance"] or ""
    assert "甲在地上蹲下" in prompt
    assert "乙在甲面前弯腰" in prompt
    assert "甲，地上，蹲下" not in prompt
    assert "乙，甲面前，弯腰" not in prompt


def test_shot_prompt_blocks_english_director_environment_focus_from_legacy_checkpoint():
    shot = {
        "shot_id": "SH013", "scene_id": "scene_001", "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001"], "prop_refs": [], "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "老周坐在修鞋摊前。", "description": "镜头看向窗边。", "dialogue": [],
        "director": {
            "performance_actions": [],
            "visual_focus": {"environment_keys": ["glass_window"]},
            "speaker_target_refs": [],
        },
        "state_in": {},
    }
    result = compile_shot_consumption_prompt_v1(
        shot, _minimal_cn_story_for_gate(), _minimal_cn_script_for_gate(),
        {"characters": []}, {"scenes": []}, {}
    )
    assert result["compile_status"] == "blocked"
    assert result["prompt_seedance"] is None
    issue = next(
        e for e in result["errors"]
        if e["code"] == "E007_NON_CHINESE_OUTPUT"
        and "visual_focus.environment_keys" in e["source_ref"]
    )
    assert issue["source_layer"] == "Director"


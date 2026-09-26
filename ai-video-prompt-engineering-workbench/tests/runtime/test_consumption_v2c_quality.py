from __future__ import annotations


def _style():
    return {
        "era": {"status": "locked", "value": "当代（故事跨度多年）"},
        "region": {"status": "locked", "value": "中国城市社区（配角来自外省）"},
        "genre": {"status": "locked", "value": "现实主义生活流短篇"},
        "tone": {"status": "locked", "value": "克制、平实、留白，以日常细节承载时间与承诺"},
        "visual_reference": {"status": "locked", "value": "低饱和暖调，真实材质，轻微胶片颗粒感与怀旧氛围"},
    }


def _story():
    return {
        "characters": [
            {
                "character_id": "char_001", "canonical_name": "老匠人", "role_type": "main",
                "visual_lock": {"age_appearance": "六十多岁", "face": "脸上的皱纹在夕阳里很深", "hair": "灰白短发"},
            },
            {
                "character_id": "char_002", "canonical_name": "年轻顾客", "role_type": "supporting",
                "visual_lock": {"age_appearance": "二十多岁", "face": "五官端正", "hair": "黑色短发"},
            },
        ],
        "scenes": [{
            "scene_id": "scene_001", "canonical_name": "社区入口摊位",
            "visual_lock": {
                "space": "普通城市社区入口",
                "layout": "一张工作台，一个工具箱，几把凳子",
                "materials": "旧木工具箱，磨损金属件",
                "environment": "旧报刊亭现在是咖啡店，灯亮着",
                "lighting": "夕阳",
                "color": "夕阳下的暖橙色调，木箱深棕，地面灰褐",
            },
        }],
        "props": [],
    }


def _shot():
    return {
        "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "location_ref": "scene_001", "duration": 5.0,
        "character_refs": ["char_001", "char_002"], "prop_refs": [],
        "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "老匠人坐在画面左侧，年轻顾客站在咖啡店前。",
        "description": "", "dialogue": [], "narration": [],
        "director": {
            "dramatic_intent": "营造岁月沉淀的宁静氛围，突出人物与摊位融为一体的日常感。",
            "performance_actions": [
                {"character_ref": "char_001", "action": "低头整理工具，抬眼看向年轻顾客"},
                {"character_ref": "char_002", "action": "站在咖啡店前看向老匠人"},
            ],
            "visual_focus": {}, "speaker_target_refs": [],
        },
        "state_in": {"characters": {}, "props": {}, "environment": {}},
    }


def _semantics():
    return {
        "shot_id": "SH001",
        "visual_events": [{"action": "年轻顾客站在咖啡店前。", "character_refs": ["char_002"], "prop_refs": [], "source_evidence": []}],
        "audio_events": [], "renderability_status": "renderable", "renderability_issues": [],
        "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": [],
    }


def test_v2c_consumes_compact_visual_context_instead_of_copying_full_assets():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2c

    result = compile_shot_consumption_prompt_v2c(
        _shot(), _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    prompt = result["prompt_seedance"] or ""

    assert result["compiler_version"] == "consumption_v2m"
    assert result["prompt_metrics"]["char_count"] < 450
    assert "表演意图：" not in prompt
    assert "故事跨度多年" not in prompt
    assert "配角来自外省" not in prompt
    assert "承载时间与承诺" not in prompt
    assert "脸上的皱纹在夕阳里" not in prompt
    assert "夕阳" not in result["shot_consumption_manifest"]["scene_continuity_anchor"]
    assert "夕阳" in result["shot_consumption_manifest"]["scene_state_anchor"]
    assert "轻微胶片颗粒" in prompt


def test_v2d_scene_selection_keeps_current_sublocation_and_repeats_core_layout_for_continuity():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2c

    result = compile_shot_consumption_prompt_v2c(
        _shot(), _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    prompt = result["prompt_seedance"] or ""

    assert "咖啡店" in prompt
    # Active transformed scene must not inherit unrelated root-stall landmarks.
    assert "一张工作台" not in result["shot_consumption_manifest"]["scene_continuity_anchor"]
    assert "一个工具箱" not in result["shot_consumption_manifest"]["scene_continuity_anchor"]
    assert "下的暖橙色调" not in prompt


def test_v2c_does_not_repeat_identical_composition_after_spatial_blocking():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2c

    result = compile_shot_consumption_prompt_v2c(
        _shot(), _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    prompt = result["prompt_seedance"] or ""

    assert prompt.count("老匠人坐在画面左侧，年轻顾客站在咖啡店前") == 1


def test_v2d_renders_director_over_shoulder_relationship_in_camera_line():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d

    shot = _shot()
    shot['director']['visual_target'] = {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    shot['director']['execution_framing'] = {'framing_type': 'over_shoulder', 'foreground_character_refs': ['char_002']}
    shot['director']['execution_shot_design'] = {'shot_size': 'medium_close', 'camera': 'high_angle', 'movement': 'handheld'}
    shot['shot_size'] = 'medium_close'
    shot['camera'] = 'high_angle'
    shot['movement'] = 'handheld'
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    prompt = result['prompt_seedance'] or ''
    assert '摄法：越过年轻顾客肩后拍摄老匠人，高角度俯拍，手持' in prompt


def test_v2d_repeats_same_stable_scene_anchor_but_keeps_shot_specific_spatial_blocking():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d

    first = _shot()
    second = _shot()
    second['shot_id'] = 'SH002'
    second['composition'] = '老匠人站在工具箱前，年轻顾客位于画面右侧。'
    first_result = compile_shot_consumption_prompt_v2d(
        first, _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    second_result = compile_shot_consumption_prompt_v2d(
        second, _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    first_anchor = first_result['shot_consumption_manifest']['scene_continuity_anchor']
    second_anchor = second_result['shot_consumption_manifest']['scene_continuity_anchor']
    assert first_anchor == second_anchor
    assert '场景连续性：' not in first_result['prompt_seedance']
    assert first_result['shot_consumption_manifest']['spatial_blocking'] != second_result['shot_consumption_manifest']['spatial_blocking']


def test_v2d_character_anchor_keeps_visible_wardrobe_without_copying_low_priority_skin_detail():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d

    story = _story()
    story["characters"][0]["visual_lock"]["body"] = "偏瘦，肩背微驼"
    pvb = {"characters": [{
        "character_id": "char_001",
        "visual_identity": {"skin": {"value": "偏暖肤色", "status": "locked"}},
        "wardrobe": {"default": {"value": "深灰旧夹克，深色长裤", "status": "locked"}},
    }]}
    result = compile_shot_consumption_prompt_v2d(
        _shot(), _semantics(), story, {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        pvb, {"scenes": []}, _style(),
    )
    prompt = result["prompt_seedance"] or ""
    assert "深灰旧夹克，深色长裤" in prompt
    assert "偏暖肤色" not in prompt


def test_v2d_scene_continuity_anchor_is_identical_across_shots_even_when_blocking_changes():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d

    first = _shot()
    second = _shot()
    second["shot_id"] = "SH002"
    second["composition"] = "年轻顾客坐在工作台右侧，老匠人站在工具箱旁。"
    first_result = compile_shot_consumption_prompt_v2d(
        first, _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    second_result = compile_shot_consumption_prompt_v2d(
        second, _semantics(), _story(), {"scenes": [{"scene_id": "SC001", "scene_heading": "社区入口 - 傍晚"}]},
        {"characters": []}, {"scenes": []}, _style(),
    )
    first_anchor = first_result["shot_consumption_manifest"]["scene_continuity_anchor"]
    second_anchor = second_result["shot_consumption_manifest"]["scene_continuity_anchor"]
    assert first_anchor == second_anchor
    assert "场景连续性：" not in first_result["prompt_seedance"]
    assert "咖啡店" in first_anchor
    assert "一张工作台" not in first_anchor
    assert "一个工具箱" not in first_anchor
    assert first_result["shot_consumption_manifest"]["spatial_blocking"] != second_result["shot_consumption_manifest"]["spatial_blocking"]

from __future__ import annotations


def _story():
    return {
        "characters": [{"character_id": "char_001", "canonical_name": "甲", "role_type": "main", "visual_lock": {}}],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "房间", "visual_lock": {}}],
        "props": [{"prop_id": "prop_001", "canonical_name": "纸条", "aliases": []}],
    }


def _script():
    return {"scenes": [{"scene_id": "SC001", "scene_heading": "房间 - 白天"}]}


def _shot(*, description="旧描述不应成为 v2 动作。", dialogue=None):
    return {
        "shot_id": "SH001", "scene_id": "SC001", "context_ref": "", "beat_id": "B001",
        "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001"], "prop_refs": ["prop_001"],
        "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "甲站在桌边。", "description": description,
        "dialogue": dialogue or [],
        "director": {"performance_actions": [], "visual_focus": {}, "speaker_target_refs": []},
        "state_in": {"characters": {}, "props": {}, "environment": {}},
    }


def _semantics(*, visual=True, dialogue=None, diegetic=None, overlays=None, audio=None):
    return {
        "shot_id": "SH001", "context_ref": "",
        "visual_events": ([{
            "action": "甲把纸条放到桌面。",
            "character_refs": ["char_001"], "prop_refs": ["prop_001"],
            "source_evidence": [{"quote": "甲留下联系方式。"}],
        }] if visual else []),
        "audio_events": audio or [],
        "renderability_status": "renderable", "renderability_issues": [],
        "dialogue": dialogue or [],
        "diegetic_text": diegetic or [],
        "production_choices": [],
        "appearance_overlays": overlays or [],
    }


def test_v2a_prefers_semantic_visual_events_over_raw_description():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2a

    result = compile_shot_consumption_prompt_v2a(
        _shot(), _semantics(), _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert result["compiler_version"] == "consumption_v2a"
    assert result["consumption_view"]["semantic_path"] == "production_semantics"
    assert "甲把纸条放到桌面" in result["prompt_seedance"]
    assert "旧描述不应成为 v2 动作" not in result["prompt_seedance"]


def test_v2a_keeps_explicit_legacy_fallback_until_patch08():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2a

    result = compile_shot_consumption_prompt_v2a(
        _shot(description="甲抬手。"), _semantics(visual=False), _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert result["consumption_view"]["semantic_path"] == "legacy_fallback"
    assert "甲抬手" in (result["prompt_seedance"] or "")


def test_v2a_diegetic_text_replaces_blanket_no_readable_text_constraint():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2a

    semantics = _semantics(diegetic=[{
        "content": "A17", "carrier_type": "prop", "carrier_ref": "prop_001", "required_visible": True,
        "source_evidence": [{"quote": "纸条上写着A17。"}],
    }])
    result = compile_shot_consumption_prompt_v2a(
        _shot(), semantics, _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    prompt = result["prompt_seedance"] or ""
    assert "A17" in prompt
    assert "仅允许剧情明确要求" in prompt
    assert "额外可阅读文字" not in prompt


def test_v2a_appearance_overlay_is_emitted_without_mutating_character_asset():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2a

    story = _story()
    semantics = _semantics(overlays=[{
        "character_ref": "char_001", "narrative_context_ref": "",
        "overrides": {"age_appearance": "十六岁少年时期"},
        "source_evidence": [{"quote": "十六岁的甲站在桌边。"}],
    }])
    result = compile_shot_consumption_prompt_v2a(
        _shot(), semantics, story, _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert "人物阶段：甲：十六岁少年时期" in (result["prompt_seedance"] or "")
    assert story["characters"][0]["visual_lock"] == {}


def test_v2a_audio_events_remain_metadata_not_visual_prompt():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2a

    semantics = _semantics(audio=[{
        "audio_type": "diegetic", "content": "门外传来脚步声。", "source_evidence": [{"quote": "门外传来脚步声。"}],
    }])
    result = compile_shot_consumption_prompt_v2a(
        _shot(), semantics, _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert "门外传来脚步声" not in (result["prompt_seedance"] or "")
    assert result["consumption_view"]["audio_events"][0]["content"] == "门外传来脚步声。"


def test_project_v2a_reports_semantic_coverage_and_preserves_asset_compiler():
    from runtime.consumption_compiler import compile_project_consumption_v2a

    shot = _shot()
    project = compile_project_consumption_v2a(
        "project_x", _story(), _script(), {"characters": []}, {"scenes": []}, {}, [shot],
        {"shots": [_semantics()]},
    )
    assert project["compiler_version"] == "consumption_v2a"
    assert project["compile_manifest"]["asset_compiler"] == "consumption_v1"
    assert project["compile_manifest"]["shot_compiler"] == "consumption_v2a"
    assert project["summary"]["semantic_action_covered"] == 1
    assert project["summary"]["fallback_used"] == 0
    assert project["shot_prompts"][0]["consumption_view"]["semantic_path"] == "production_semantics"

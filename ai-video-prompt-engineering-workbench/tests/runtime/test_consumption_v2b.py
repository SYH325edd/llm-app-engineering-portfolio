from __future__ import annotations

import copy


def _story():
    return {
        "characters": [{"character_id": "char_001", "canonical_name": "甲", "role_type": "main", "visual_lock": {}}],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "房间", "visual_lock": {}}],
        "props": [{"prop_id": "prop_001", "canonical_name": "纸条", "aliases": []}],
    }


def _script():
    return {"scenes": [{"scene_id": "SC001", "scene_heading": "房间 - 白天"}]}


def _shot(*, description="原始描述绝不能进入 v2b 动作。", dialogue=None):
    return {
        "shot_id": "SH001", "scene_id": "SC001", "context_ref": "", "beat_id": "B001",
        "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001"], "prop_refs": ["prop_001"],
        "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "甲站在桌边。", "description": description,
        "dialogue": dialogue or [],
        "director": {"performance_actions": [], "visual_focus": {}, "speaker_target_refs": [str(x.get("character_id") or "") for x in (dialogue or [])]},
        "state_in": {"characters": {}, "props": {}, "environment": {}},
    }


def _semantics(*, status="renderable", visual=None, dialogue=None, choices=None):
    return {
        "shot_id": "SH001", "context_ref": "",
        "visual_events": visual if visual is not None else [],
        "audio_events": [],
        "renderability_status": status,
        "renderability_issues": ([] if status == "renderable" else [{
            "type": "underspecified_action", "detail": "动作机制仍未确定。",
            "source_evidence": [{"quote": "他留下了联系方式。"}],
        }]),
        "dialogue": dialogue or [],
        "diegetic_text": [],
        "production_choices": choices or [],
        "appearance_overlays": [],
    }


def test_v2b_static_renderable_shot_may_have_no_action_without_description_fallback():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2b

    result = compile_shot_consumption_prompt_v2b(
        _shot(description="多年以后他仍记得这一刻。"), _semantics(), _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert result["compile_status"] != "blocked"
    assert "多年以后" not in (result["prompt_seedance"] or "")
    assert "动作与互动：" not in (result["prompt_seedance"] or "")
    assert result["consumption_view"]["fallback_used"] is False
    assert result["consumption_view"]["semantic_path"] == "production_semantics"


def test_v2b_uses_semantic_visual_event_and_never_raw_description():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2b

    semantics = _semantics(visual=[{
        "action": "甲把纸条放到桌面。", "character_refs": ["char_001"], "prop_refs": ["prop_001"],
        "source_evidence": [{"quote": "甲留下了联系方式。"}],
    }])
    result = compile_shot_consumption_prompt_v2b(
        _shot(description="RAW_DESCRIPTION_SENTINEL"), semantics, _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert "甲把纸条放到桌面" in (result["prompt_seedance"] or "")
    assert "RAW_DESCRIPTION_SENTINEL" not in (result["prompt_seedance"] or "")
    assert result["consumption_view"]["fallback_used"] is False


def test_v2b_non_renderable_semantics_blocks_atomically_instead_of_falling_back():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2b

    result = compile_shot_consumption_prompt_v2b(
        _shot(description="甲留下了联系方式。"), _semantics(status="needs_adaptation"),
        _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert result["compile_status"] == "blocked"
    assert result["prompt_seedance"] is None
    assert any(e.get("code") == "E008_SEMANTIC_NOT_RENDERABLE" for e in result["errors"])
    assert result["consumption_view"]["fallback_used"] is False


def test_v2b_offscreen_dialogue_is_kept_in_dialogue_field_without_visible_speaking_action():
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2b

    semantics = _semantics(dialogue=[{"character_id": "char_001", "line": "回来。", "offscreen": True}])
    result = compile_shot_consumption_prompt_v2b(
        _shot(dialogue=[{"character_id": "char_001", "line": "回来。"}]), semantics,
        _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )
    assert result["compile_status"] != "blocked"
    assert "甲说" not in (result["prompt_seedance"] or "")
    assert "台词：甲（画外）：“回来。”" in (result["prompt_seedance"] or "")
    assert result["consumption_view"]["dialogue"][0]["offscreen"] is True

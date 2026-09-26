from __future__ import annotations

import copy


def _story():
    return {
        "characters": [
            {"character_id": "char_001", "canonical_name": "甲", "role_type": "main", "visual_lock": {}},
            {"character_id": "char_002", "canonical_name": "乙", "role_type": "supporting", "visual_lock": {}},
        ],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "房间", "visual_lock": {}}],
        "props": [{"prop_id": "prop_001", "canonical_name": "纸条", "aliases": []}],
    }


def _script():
    return {"scenes": [{"scene_id": "SC001", "scene_heading": "房间 - 白天"}]}


def _shot(*, dialogue=None, description="原始小说描述不得直接进入最终动作。"):
    dialogue = dialogue or []
    return {
        "shot_id": "SH001", "scene_id": "SC001", "context_ref": "", "beat_id": "B001",
        "location_ref": "scene_001", "duration": 4.0,
        "character_refs": ["char_001", "char_002"], "prop_refs": ["prop_001"],
        "shot_size": "medium", "camera": "eye_level", "movement": "static",
        "composition": "甲与乙隔桌相对。", "description": description, "dialogue": dialogue,
        "director": {
            "performance_actions": [], "visual_focus": {},
            "speaker_target_refs": [str(x.get("character_id") or "") for x in dialogue],
        },
        "state_in": {"characters": {}, "props": {}, "environment": {}},
    }


def _semantics(**overrides):
    value = {
        "shot_id": "SH001", "context_ref": "",
        "visual_events": [], "audio_events": [],
        "renderability_status": "renderable", "renderability_issues": [],
        "dialogue": [], "diegetic_text": [], "production_choices": [], "appearance_overlays": [],
    }
    value.update(overrides)
    return value


def _compile(shot, semantics, story=None):
    from runtime.consumption_compiler import compile_shot_consumption_prompt_v2b
    return compile_shot_consumption_prompt_v2b(
        shot, semantics, story or _story(), _script(), {"characters": []}, {"scenes": []}, {}
    )


def test_business_gate_01_reality_dialogue_is_emitted_once_without_semantic_repetition():
    shot = _shot(dialogue=[{"character_id": "char_001", "line": "你来了。"}])
    shot["director"]["performance_actions"] = [{
        "character_ref": "char_001", "action": "抬眼看向乙，低声说你来了。"
    }]
    semantics = _semantics(
        visual_events=[{
            "action": "甲抬眼看向乙。", "character_refs": ["char_001"], "prop_refs": [],
            "source_evidence": [{"quote": "甲抬眼看向乙。"}],
        }],
        dialogue=[{"character_id": "char_001", "line": "你来了。", "offscreen": False}],
    )
    result = _compile(shot, semantics)
    prompt = result["prompt_seedance"] or ""
    assert result["compile_status"] != "blocked"
    assert prompt.count("你来了") == 1
    assert "原始小说描述" not in prompt


def test_business_gate_02_flashback_return_restores_reality_state_instead_of_restarting_action(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_context_state_stack_v4 import (
        _ContextDirectorModel, _state_board, _state_plan, _state_script, _state_semantics, _state_story,
    )

    rt = RuntimeV20(
        model=_ContextDirectorModel(), store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = rt.create("现实。回忆。回到现实。", title="timeline business gate")
    rt._run_director_units(run, _state_story(), _state_script(), _state_board(), _state_plan(), _state_semantics())
    assert run["units"]["director:SH003"]["state_in"]["characters"]["char_001"]["position"] == "现实桌边"


def test_business_gate_03_age_variant_is_context_overlay_without_mutating_base_character():
    story = _story()
    before = copy.deepcopy(story)
    semantics = _semantics(appearance_overlays=[{
        "character_ref": "char_001", "narrative_context_ref": "context_memory",
        "overrides": {"age_appearance": "十六岁少年时期"},
        "source_evidence": [{"quote": "十六岁的甲站在窗边。"}],
    }])
    result = _compile(_shot(), semantics, story)
    assert "甲：十六岁少年时期。" in (result["prompt_seedance"] or "")
    assert "人物阶段：" not in (result["prompt_seedance"] or "")
    assert story == before


def test_business_gate_04_required_diegetic_text_is_allowed_without_conflicting_blanket_text_ban():
    semantics = _semantics(diegetic_text=[{
        "content": "A17", "carrier_type": "prop", "carrier_ref": "prop_001",
        "required_visible": True, "source_evidence": [{"quote": "纸条上写着A17。"}],
    }])
    result = _compile(_shot(), semantics)
    prompt = result["prompt_seedance"] or ""
    assert result["compile_status"] != "blocked"
    assert "A17" in prompt
    assert "仅允许剧情明确要求的画面内文字" in prompt
    assert "画面无字幕、水印或无依据可阅读文字" not in prompt


def test_business_gate_05_psychological_or_literary_statement_cannot_become_visual_event():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output
    from tests.runtime.test_production_semantics_v1a import _context, _valid_candidate

    ctx = _context()
    quote = "甲想起过去，心里后悔。"
    ctx["shot"]["description"] = quote
    ctx["shot"]["source_evidence"] = [{"quote": quote}]
    ctx["program_owned"]["current_shot_evidence"] = [quote]
    candidate = _valid_candidate()
    candidate["visual_events"] = [{
        "action": quote, "character_refs": ["char_001"], "prop_refs": [],
        "source_evidence": [{"quote": quote}],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {e.get("type") for e in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_non_visual_event" in kinds


def test_business_gate_06_outcome_without_mechanism_cannot_reach_final_prompt_until_adapted():
    unresolved = _semantics(
        renderability_status="needs_adaptation",
        renderability_issues=[{
            "type": "underspecified_action", "detail": "只知道留下联系方式，动作机制未确定。",
            "source_evidence": [{"quote": "甲留下了联系方式。"}],
        }],
    )
    blocked = _compile(_shot(description="甲留下了联系方式。"), unresolved)
    assert blocked["compile_status"] == "blocked"
    assert blocked["prompt_seedance"] is None
    assert any(e.get("code") == "E008_SEMANTIC_NOT_RENDERABLE" for e in blocked["errors"])

    adapted = _semantics(
        visual_events=[{
            "action": "甲把现有纸条放到桌面。", "character_refs": ["char_001"], "prop_refs": ["prop_001"],
            "source_evidence": [{"quote": "甲留下了联系方式。"}],
        }],
        production_choices=[{
            "type": "minimal_action_mechanism", "choice": "甲把现有纸条放到桌面。",
            "affected_character_refs": ["char_001"], "affected_prop_refs": ["prop_001"],
            "narrative_context_ref": "", "impact": "no_story_change", "rationale": "最小可拍适配。",
            "story_changes": {
                "new_characters": [], "new_relationships": [], "new_plot_outcomes": [],
                "new_dialogue_information": [], "new_locations": [], "new_key_props": [],
            },
            "source_evidence": [{"quote": "甲留下了联系方式。"}],
        }],
    )
    rendered = _compile(_shot(description="甲留下了联系方式。"), adapted)
    assert rendered["compile_status"] != "blocked"
    assert "甲把现有纸条放到桌面" in (rendered["prompt_seedance"] or "")
    assert "甲留下了联系方式" not in (rendered["prompt_seedance"] or "")

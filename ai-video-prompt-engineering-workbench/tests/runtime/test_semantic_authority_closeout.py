from __future__ import annotations

import copy

from runtime.source_index import build_source_index
from runtime.stages.story_bible import canonicalize_story_bible, validate_story_bible_output
from runtime.stages.scene_plan import canonicalize_scene_plan, validate_scene_plan_output
from runtime.stages.script import canonicalize_script_scene, validate_script_scene_output
from runtime.stages.storyboard import canonicalize_storyboard_scene, validate_storyboard_scene_output
from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output
from runtime.stages.director import canonicalize_director_fragment, validate_director_fragment
from tests.runtime.test_production_semantics_v1a import _context as ps_context, _valid_candidate as ps_candidate
from tests.runtime.test_stage06_director_contract import _context as director_context, _director


def _minimal_story(source: str) -> dict:
    candidate = {
        "characters": [{
            "canonical_name": "阿宁", "aliases": [], "role_type": "main",
            "explicit_facts": ["阿宁站在窗边"], "inferred_facts": [],
            "identity_lock": {}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["explicit_facts[0]"]}],
        }],
        "scenes": [{
            "canonical_name": "房间", "name": "房间", "time": "", "weather": "",
            "explicit_facts": ["阿宁站在窗边"], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["explicit_facts[0]"]}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_semantic", source_text=source, source_index=build_source_index(source))
    return value


def test_story_bible_marks_weak_explicit_fact_as_soft_semantic_summary_warning():
    source = "阿宁站在窗边。"
    value = _minimal_story(source)
    value["characters"][0]["explicit_facts"].append("阿宁是总统")
    value["characters"][0]["source_evidence"][0]["supports"].append("explicit_facts[1]")
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    assert not any(e["type"] == "story_bible_fact_not_supported" for e in errors)
    assert any(e["type"] == "story_bible_explicit_fact_weak_lexical_anchor" for e in errors)


def test_scene_plan_flags_invented_beat_as_quality_warning_while_source_refs_remain_authority():
    source = "阿宁把饭盒放到桌上。"
    story = {
        "characters": [{"character_id": "char_001", "canonical_name": "阿宁", "role_type": "main"}],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "房间"}],
        "props": [{"prop_id": "prop_001", "canonical_name": "饭盒", "aliases": []}],
        "narrative_contexts": [],
    }
    candidate = {"scenes": [{
        "source_refs": ["SRC0001"], "context_ref": "", "context_transition": "continue",
        "location_ref": "scene_001", "time": "", "character_refs": ["char_001"],
        "prop_refs": ["prop_001"], "continuous_with_previous": False,
        "dramatic_goal": "呈现当前动作", "conflict": "", "turning_point": "",
        "beat_list": [{"source_refs": ["SRC0001"], "description": "阿宁突然拔枪射击。", "type": "action"}],
    }]}
    value, _ = canonicalize_scene_plan(candidate, source_text=source, source_index=build_source_index(source), story_bible=story)
    errors = validate_scene_plan_output(story, value, source_text=source, require_beat_provenance=True)
    assert any(e["type"] == "scene_plan_beat_low_source_overlap" for e in errors)
    # Scene Planner descriptions are structural summaries. Exact contiguous source_refs
    # remain the downstream factual authority instead of a lexical-similarity hard gate.
    from runtime.stages.script import build_script_scene_payload
    payload = build_script_scene_payload(source, story, value["scenes"][0], unit_id="script:SC001")
    assert payload["beat_source_authority"][0]["source_text"] == source


def test_script_rejects_high_confidence_speaker_swap():
    source = "阿宁说：你回来了。周野说：我回来了。"
    story = {
        "characters": [
            {"character_id": "char_001", "canonical_name": "阿宁", "aliases": [], "role_type": "main"},
            {"character_id": "char_002", "canonical_name": "周野", "aliases": [], "role_type": "supporting"},
        ], "scenes": [{"scene_id": "scene_001", "canonical_name": "房间"}], "props": [], "narrative_contexts": [],
    }
    plan = {
        "scene_id": "SC001", "source_refs": ["SRC0001", "SRC0002"], "context_ref": "", "location_ref": "scene_001",
        "time": "", "character_refs": ["char_001", "char_002"], "prop_refs": [], "continuous_with_previous": False,
        "dramatic_goal": "对话", "conflict": "", "turning_point": "",
        "beat_list": [
            {"beat_id": "B001", "source_refs": ["SRC0001"], "description": "阿宁说：你回来了。", "type": "dialogue"},
            {"beat_id": "B002", "source_refs": ["SRC0002"], "description": "周野说：我回来了。", "type": "dialogue"},
        ],
    }
    candidate = {"scene_heading": "房间", "scene_description": "两人交谈。", "beats": [
        {"description": "阿宁说：你回来了。", "dialogue": [{"character_id": "char_002", "line": "你回来了。"}]},
        {"description": "周野说：我回来了。", "dialogue": [{"character_id": "char_001", "line": "我回来了。"}]},
    ]}
    value, _ = canonicalize_script_scene(plan, candidate)
    errors = validate_script_scene_output(story, plan, value, source_text=source)
    assert any(e["type"] == "dialogue_speaker_mismatch" for e in errors)


def test_storyboard_rejects_invented_shot_description_with_legal_evidence():
    plan = {
        "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "time": "",
        "character_refs": ["char_001"], "prop_refs": [], "continuous_with_previous": False,
        "dramatic_goal": "", "conflict": "", "turning_point": "",
        "beat_list": [{"beat_id": "B001", "description": "阿宁先开口。", "type": "dialogue"}],
    }
    script = {
        "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "scene_heading": "房间",
        "scene_description": "阿宁在房间。", "beats": [{"beat_id": "B001", "description": "阿宁先开口。", "dialogue": []}],
    }
    candidate = {"shots": [{
        "beat_id": "B001", "character_refs": ["char_001"], "prop_refs": [], "shot_size": "medium",
        "camera": "eye_level", "movement": "static", "composition": "阿宁居中。", "duration": 3,
        "description": "阿宁突然拔枪射击。", "dialogue": [], "narration": [],
        "continuity": {"continuous_with_previous": False, "axis_side": "neutral", "eyeline_match": "not_applicable"},
        "source_evidence": [{"quote": "阿宁先开口。"}],
    }]}
    value, _ = canonicalize_storyboard_scene(plan, candidate)
    errors = validate_storyboard_scene_output(plan, script, value)
    assert any(e["type"] == "storyboard_description_not_supported_by_evidence" for e in errors)


def test_production_semantics_rejects_invented_visual_event_using_legal_evidence():
    ctx = ps_context()
    candidate = ps_candidate()
    candidate["visual_events"][0]["action"] = "甲突然拔枪指向门口。"
    candidate["visual_events"][0]["source_evidence"] = [{"quote": "甲把信封放到桌上。"}]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    errors = validate_production_semantics_output(value, ctx)
    assert any(e["type"] == "production_semantics_visual_event_not_supported" for e in errors)


def test_production_semantics_program_owns_fixed_choice_fields_and_environment_carrier():
    ctx = ps_context()
    ctx["program_owned"]["current_location_ref"] = "scene_001"
    candidate = ps_candidate()
    candidate["production_choices"] = [{
        "type": "natural_reaction", "choice": "甲短暂停顿。", "affected_character_refs": ["char_001"],
        "affected_prop_refs": [], "impact": "wrong", "rationale": "自然反应",
        "story_changes": {}, "source_evidence": [{"quote": "甲把信封放到桌上。"}],
    }]
    candidate["diegetic_text"] = [{
        "content": "出口", "carrier_type": "environment", "carrier_ref": "scene_wrong",
        "required_visible": "false", "source_evidence": [{"quote": "出口"}],
    }]
    # Make the diegetic text evidence authoritative for this representation test.
    ctx["program_owned"]["current_shot_evidence"].append("出口")
    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert value["production_choices"][0]["impact"] == "no_story_change"
    assert all(not values for values in value["production_choices"][0]["story_changes"].values())
    assert value["diegetic_text"][0]["carrier_ref"] == "scene_001"
    assert value["diegetic_text"][0]["required_visible"] is False


def test_production_design_audio_cannot_smuggle_music_or_new_story_event():
    ctx = ps_context()
    for content, expected in [
        ("悲伤背景音乐缓慢响起。", "production_semantics_audio_design_adds_music"),
        ("门外突然响起枪声。", "production_semantics_audio_design_adds_story_event"),
    ]:
        candidate = ps_candidate()
        candidate["audio_events"] = [{
            "audio_type": "diegetic", "audio_role": "atmosphere", "origin": "production_design",
            "content": content, "source_evidence": [],
        }]
        value, _ = canonicalize_production_semantics(candidate, ctx)
        errors = validate_production_semantics_output(value, ctx)
        assert any(e["type"] == expected for e in errors)


def test_director_rejects_empty_performance_evidence():
    ctx = director_context()
    raw = _director()
    raw["performance_actions"][0]["source_evidence"] = []
    value, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(value, ctx, is_first_global_shot=True)
    assert any(e["type"] == "director_missing_performance_evidence" for e in errors)


def test_director_rejects_unknown_persistent_state_key():
    ctx = director_context()
    raw = _director()
    raw["action_delta"] = {"characters": {"char_001": {"custom_state": {"x": 1}}}, "props": {}, "environment": {}}
    value, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(value, ctx, is_first_global_shot=True)
    assert any(e["type"] == "unsupported_persistent_character_state" for e in errors)


def test_storyboard_representation_drift_is_normalized_without_semantic_guessing():
    plan = {
        "scene_id": "SC001", "context_ref": "", "location_ref": "scene_001", "time": "",
        "character_refs": ["char_001"], "prop_refs": [], "continuous_with_previous": False,
        "dramatic_goal": "", "conflict": "", "turning_point": "",
        "beat_list": [{"beat_id": "B001", "description": "阿宁先开口。", "type": "dialogue"}],
    }
    candidate = {"shots": [{
        "beat_id": "B001", "character_refs": ["char_001"], "prop_refs": [],
        "shot_size": "中景", "camera": "平视机位", "movement": "固定镜头",
        "composition": "阿宁居中。", "duration": "4.0", "description": "阿宁先开口。", "dialogue": [], "narration": [],
        "continuity": {"continuous_with_previous": "false", "axis_side": "neutral", "eyeline_match": "not_applicable"},
        "source_evidence": [{"quote": "阿宁先开口。"}],
    }]}
    value, _ = canonicalize_storyboard_scene(plan, candidate)
    shot = value["shots"][0]
    assert shot["shot_size"] == "medium"
    assert shot["camera"] == "eye_level"
    assert shot["movement"] == "static"
    assert shot["duration"] == 4.0
    assert shot["continuity"]["continuous_with_previous"] is False


def test_source_index_splits_only_explicit_spatial_transition_clauses():
    ordinary = build_source_index("阿宁站在窗边，手里拿着信封。")
    assert [x["text"] for x in ordinary] == ["阿宁站在窗边，手里拿着信封。"]

    moving = build_source_index("他走出卧室，穿过走廊，来到客厅。")
    assert [x["text"] for x in moving] == ["他走出卧室，", "穿过走廊，", "来到客厅。"]
    assert "".join(x["text"] for x in moving) == "他走出卧室，穿过走廊，来到客厅。"


def test_downstream_evidence_representation_drift_reanchors_to_exact_authority():
    from runtime.stages.production_semantics import canonicalize_production_semantics
    from runtime.stages.director import canonicalize_director_fragment

    ctx = ps_context()
    candidate = ps_candidate()
    candidate["visual_events"][0]["source_evidence"] = [{"quote": "甲把信封放到桌上"}]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert value["visual_events"][0]["source_evidence"][0]["quote"] == "甲把信封放到桌上。"

    dctx = director_context()
    dctx["program_owned"]["current_shot_action_evidence"] = ["阿宁站在窗边，手里拿着信封。"]
    raw = _director()
    raw["performance_actions"][0]["source_evidence"] = [{"quote": "阿宁站在窗边 手里拿着信封"}]
    canonical, _ = canonicalize_director_fragment(raw, dctx, is_first_global_shot=True)
    assert canonical["performance_actions"][0]["source_evidence"][0]["quote"] == "阿宁站在窗边，手里拿着信封。"


def test_inferred_facts_are_not_promoted_into_downstream_model_authority():
    from runtime.stages.scene_plan import build_scene_plan_payload
    from runtime.stages.script import build_script_scene_payload
    from runtime.stages.pvb import build_pvb_character_payload

    story = {
        "characters": [{
            "character_id": "char_001", "canonical_name": "阿宁", "aliases": [], "role_type": "main",
            "explicit_facts": ["阿宁站在窗边"], "inferred_facts": ["阿宁可能很焦虑"],
            "identity_lock": {}, "visual_lock": {}, "source_evidence": [],
        }],
        "scenes": [{"scene_id": "scene_001", "canonical_name": "房间", "explicit_facts": ["阿宁站在窗边"], "visual_lock": {}}],
        "props": [], "narrative_contexts": [],
    }
    plan_payload = build_scene_plan_payload("阿宁站在窗边。", story, unit_id="scene_plan")
    assert "inferred_facts" not in plan_payload["story_bible"]["characters"][0]

    scene = {
        "scene_id": "SC001", "source_refs": ["SRC0001"], "source_start": 0, "source_end": 8,
        "context_ref": "", "context_transition": "continue", "resume_context_ref": "",
        "location_ref": "scene_001", "time": "", "character_refs": ["char_001"], "prop_refs": [],
        "continuous_with_previous": False, "dramatic_goal": "", "conflict": "", "turning_point": "",
        "beat_list": [{"beat_id": "B001", "source_refs": ["SRC0001"], "description": "阿宁站在窗边。", "type": "setup"}],
    }
    script_payload = build_script_scene_payload("阿宁站在窗边。", story, scene, unit_id="script:SC001")
    assert "inferred_facts" not in script_payload["relevant_story_facts"]["characters"][0]

    pvb_payload = build_pvb_character_payload(story["characters"][0], unit_id="pvb:char_001")
    assert "inferred_facts" not in pvb_payload["story_character"]

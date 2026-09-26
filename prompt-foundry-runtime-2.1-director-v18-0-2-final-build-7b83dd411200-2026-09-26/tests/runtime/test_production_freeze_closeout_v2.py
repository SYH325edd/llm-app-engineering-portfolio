from __future__ import annotations

import copy

from runtime.consumption_compiler import (
    compile_character_consumption_prompt,
    compile_scene_consumption_prompt,
    compile_shot_consumption_prompt_v2d,
)
from runtime.production_readiness import validate_production_readiness
from runtime.stages.compile_eval import validate_visible_character_asset_preflight
from runtime.stages.director import canonicalize_director_fragment, validate_director_fragment
from runtime.stages.storyboard import build_frozen_text_units
from tests.runtime.test_production_closeout_v1 import _pvb, _script, _semantics, _shot, _story, _style
from tests.runtime.test_stage06_director_contract import _context, _director


def _full_compiled(shot: dict, semantics: dict, *, story=None, script=None, pvb=None, psb=None):
    story = copy.deepcopy(story or _story())
    script = copy.deepcopy(script or _script())
    pvb = copy.deepcopy(pvb or _pvb())
    psb = copy.deepcopy(psb or {"scenes": []})
    shot_result = compile_shot_consumption_prompt_v2d(shot, semantics, story, script, pvb, psb, _style())
    return {
        "shot_prompts": [shot_result],
        "character_prompts": [compile_character_consumption_prompt(story, pvb, _style(), "char_001")],
        "scene_prompts": [compile_scene_consumption_prompt(story, psb, _style(), "scene_001")],
    }, shot_result


def test_v2f_character_asset_is_canonical_source_of_truth_for_shot_anchor():
    story = _story()
    story["characters"][0]["visual_lock"]["body"] = "等身高，体型偏瘦，肩背平直，手指粗短，指节因常年劳作突出"
    pvb = _pvb()
    pvb["characters"][0]["wardrobe"] = {
        "default": {"status": "locked", "value": "深灰旧夹克，灰蓝长袖，藏青工装裤"},
        "outerwear": {"status": "locked", "value": "深灰旧夹克，肘部有补丁，领口微磨"},
        "footwear": {"status": "locked", "value": "黑色旧布鞋"},
    }
    char_asset = compile_character_consumption_prompt(story, pvb, _style(), "char_001")
    assert "；等身高" not in char_asset["prompt_gpt_image"]
    assert "中等身高" in char_asset["prompt_gpt_image"]
    assert char_asset["prompt_gpt_image"].count("深灰旧夹克") == 1
    assert "肘部有补丁" in char_asset["prompt_gpt_image"]

    shot = _shot()
    shot["shot_size"] = "wide"
    result = compile_shot_consumption_prompt_v2d(shot, _semantics(), story, _script(), pvb, {"scenes": []}, _style())
    manifest = result["shot_consumption_manifest"]
    assert "中等身高" in manifest["character_continuity_anchor"]
    assert "肘部有补丁" in manifest["character_continuity_anchor"]
    assert "黑色旧布鞋" in manifest["character_continuity_anchor"]
    assert result["resolved_refs"]["character_asset_hashes"]["char_001"] == char_asset["asset_hash"]


def test_v2f_scene_stable_anchor_is_constant_while_scene_state_changes():
    story = _story()
    story["scenes"][0]["visual_lock"].update({
        "layout": "一台手摇补鞋机；一个木头工具箱；旧报刊亭现在是咖啡店",
        "lighting": "夕阳从西侧斜照",
    })
    shot_a = _shot()
    shot_b = _shot()
    shot_b["shot_id"] = "SH002"
    shot_b["scene_id"] = "SC002"
    shot_b["composition"] = "年轻人站在旧报刊亭现在是咖啡店的门口"
    script = {"scenes": [
        {"scene_id": "SC001", "scene_heading": "修鞋摊 - 下午"},
        {"scene_id": "SC002", "scene_heading": "修鞋摊 - 傍晚"},
    ]}
    a = compile_shot_consumption_prompt_v2d(shot_a, _semantics(), story, script, _pvb(), {"scenes": []}, _style())
    b = compile_shot_consumption_prompt_v2d(shot_b, _semantics(), story, script, _pvb(), {"scenes": []}, _style())
    ma = a["shot_consumption_manifest"]
    mb = b["shot_consumption_manifest"]
    # v2g: an explicitly transformed active sublocation is a different effective
    # Shot scene. Root repair-stall anchors must not leak into the cafe Shot.
    assert ma["scene_continuity_anchor"] != mb["scene_continuity_anchor"]
    assert "补鞋机" in ma["scene_continuity_anchor"]
    assert "咖啡店" in mb["scene_continuity_anchor"]
    assert "补鞋机" not in mb["scene_continuity_anchor"]
    assert "夕阳" not in ma["scene_continuity_anchor"]
    assert "下午" in ma["scene_state_anchor"]
    assert "夕阳" in mb["scene_state_anchor"]
    assert "咖啡店" in b["prompt_seedance"]


def test_v2f_storyboard_explicit_motion_beats_generic_fallback():
    shot = _shot()
    shot["composition"] = "老周推着三轮车继续向前，奶茶店逐渐移出画面"
    shot["director"]["performance_actions"] = []
    shot["director"]["shot_purpose"] = "continuity"
    result = compile_shot_consumption_prompt_v2d(shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style())
    manifest = result["shot_consumption_manifest"]
    assert manifest["performance_source"] == "storyboard_explicit_action"
    assert "推着三轮车继续向前" in manifest["visual_content"]
    assert "自然呼吸、眨眼" not in manifest["visual_content"]


def test_v2m_storyboard_explicit_action_fallback_cannot_reintroduce_frozen_dialogue():
    shot = _shot(dialogue=True, purpose="speaker")
    shot["dialogue"] = [{"character_id": "char_001", "line": "你到底去哪了？"}]
    shot["composition"] = "老周抬眼看向年轻人，身体停住后低声说“你到底去哪了？”"
    shot["director"]["performance_actions"] = []
    shot["director"]["performance_logic"] = []
    shot["director"]["performance_execution"] = []
    semantics = _semantics(dialogue=True)
    semantics["dialogue"] = [{"character_id": "char_001", "line": "你到底去哪了？", "offscreen": False}]
    semantics["visual_events"] = []

    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    manifest = result["shot_consumption_manifest"]
    assert manifest["performance_source"] == "storyboard_explicit_action"
    assert "你到底去哪了？" not in manifest["visual_content"]
    assert "你到底去哪了？" in manifest["dialogue"]

    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot],
        script=None,
    )
    assert not [
        e for e in readiness["errors"]
        if e.get("type") == "exact_dialogue_repeated_in_visual_content"
    ]


def test_v2f_visual_track_removes_exact_dialogue_wrapped_in_speech_cue():
    shot = _shot(dialogue=True, purpose="speaker")
    shot["dialogue"] = [{"character_id": "char_001", "line": "找过。"}]
    shot["director"]["performance_actions"][0]["action"] = "年轻人抬眼看向对方，嘴唇微动说出“找过”。"
    shot["director"]["performance_actions"][0]["source_evidence"] = [{"quote": "找过。"}]
    semantics = _semantics(dialogue=True)
    semantics["dialogue"] = [{"character_id": "char_001", "line": "找过。", "offscreen": False}]
    result = compile_shot_consumption_prompt_v2d(shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style())
    manifest = result["shot_consumption_manifest"]
    assert "找过" not in manifest["visual_content"]
    assert "找过" in manifest["dialogue"]


def test_v2f_utterance_continuation_reconstructs_exactly_and_corruption_is_blocked():
    script = {"scenes": [{
        "scene_id": "SC001",
        "beats": [{
            "beat_id": "B001",
            "description": "年轻人回头追问。",
            "dialogue": [
                {"dialogue_id": "D001", "character_id": "char_002", "line": "师傅，"},
                {"dialogue_id": "D002", "character_id": "char_002", "line": "那柜子呢？"},
            ],
        }],
    }]}
    units = build_frozen_text_units(script["scenes"][0])["B001"]["dialogue"]
    assert len(units) == 1
    assert units[0]["text"] == "师傅，那柜子呢？"
    shot = {
        "shot_id": "SH001", "scene_id": "SC001", "beat_id": "B001", "location_ref": "scene_001",
        "duration": 4.0, "character_refs": ["char_002"], "prop_refs": [],
        "shot_size": "close", "camera": "eye_level", "movement": "static", "composition": "年轻人回头",
        "dialogue": [{"character_id": "char_002", "line": "师傅，那柜子呢？"}], "narration": [],
        "frozen_text_unit_refs": {"dialogue": [units[0]["unit_id"]], "narration": []},
        "director": {"shot_purpose": "speaker", "performance_actions": [], "visual_focus": {}, "speaker_target_refs": ["char_002"]},
    }
    readiness = validate_production_readiness(compiled_project={"shot_prompts": []}, shot_specs=[shot], script=script)
    assert not any(e["type"].startswith("utterance_") for e in readiness["errors"])
    bad = copy.deepcopy(shot)
    bad["dialogue"][0]["line"] = "那柜子呢？"
    readiness_bad = validate_production_readiness(compiled_project={"shot_prompts": []}, shot_specs=[bad], script=script)
    assert any(e["type"] == "utterance_exact_reconstruction_failed" for e in readiness_bad["errors"])


def test_v2f_readiness_blocks_asset_hash_mismatch():
    shot = _shot()
    compiled, result = _full_compiled(shot, _semantics())
    result["shot_consumption_manifest"]["provenance"]["character_asset_hashes"]["char_001"] = "stale"
    readiness = validate_production_readiness(compiled_project=compiled, shot_specs=[shot], script=_script())
    assert readiness["passed"] is False
    assert any(e["type"] == "character_asset_source_of_truth_mismatch" for e in readiness["errors"])


def test_v2f_w005_is_budgeted_not_blanket_total_length_warning():
    shot = _shot(dialogue=True, purpose="speaker")
    result = compile_shot_consumption_prompt_v2d(shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {"scenes": []}, _style())
    metrics = result["prompt_metrics"]
    assert {"continuity_chars", "shot_delta_chars", "dialogue_chars", "audio_chars", "char_count"} <= set(metrics)
    for warning in result["warnings"]:
        if warning.get("code") == "W005_PROMPT_LENGTH_HIGH":
            assert "信息预算异常" in warning["detail"]
            assert "budget" in warning


def test_director_v16_2_scene_monoculture_is_a_hard_quality_error():
    context = _context()
    raw = _director()
    raw["shot_purpose"] = "speaker"
    design = raw.get("execution_shot_design") or {}
    framing = raw.get("execution_framing") or {}
    size = design.get("shot_size")
    camera = design.get("camera")
    movement = design.get("movement")
    framing_type = framing.get("framing_type")
    context["program_owned"]["scene_design_summary"] = {
        "prior_shot_count": 8,
        "shot_size_counts": {size: 8},
        "camera_counts": {camera: 8},
        "movement_counts": {movement: 8},
        "framing_counts": {framing_type: 8},
        "purpose_counts": {"speaker": 3, "reaction": 2, "relationship": 3},
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e["type"] == "director_scene_design_monoculture" for e in errors)


def test_readiness_v2_warns_scene_wide_camera_distribution_overconcentration_without_blocking():
    specs = []
    purposes = ["speaker", "reaction", "relationship", "speaker", "detail", "reaction", "action", "closing"]
    for idx, purpose in enumerate(purposes, start=1):
        shot = _shot(purpose=purpose)
        shot["shot_id"] = f"SH{idx:03d}"
        shot["scene_id"] = "SC001"
        shot["camera"] = "eye_level"
        shot["movement"] = "static"
        shot["director"].setdefault("execution_framing", {"framing_type": "single", "foreground_character_refs": []})
        specs.append(shot)
    readiness = validate_production_readiness(compiled_project={"shot_prompts": []}, shot_specs=specs)
    assert not any(e["type"] == "scene_camera_distribution_overconcentrated" for e in readiness["errors"])
    warnings = [w for w in readiness["warnings"] if w["type"] == "scene_camera_distribution_overconcentrated"]
    assert warnings
    assert all(w.get("code") == "W026_CAMERA_DISTRIBUTION_OVERCONCENTRATED" for w in warnings)


def test_readiness_v2_returns_minimal_recoverable_director_set_for_scene_distribution_warning():
    specs = []
    purposes = ["speaker", "reaction", "relationship", "speaker", "detail", "reaction", "action", "closing", "speaker", "reaction"]
    for idx, purpose in enumerate(purposes, start=1):
        shot = _shot(purpose=purpose)
        shot["shot_id"] = f"SH{idx:03d}"
        shot["scene_id"] = "SC001"
        shot["camera"] = "eye_level"
        shot["movement"] = "static"
        shot["director"].setdefault("execution_framing", {"framing_type": "single", "foreground_character_refs": []})
        specs.append(shot)
    readiness = validate_production_readiness(compiled_project={"shot_prompts": []}, shot_specs=specs)
    warnings = [w for w in readiness["warnings"] if w["type"] == "scene_camera_distribution_overconcentrated"]
    assert len(warnings) >= 3  # Keep the minimal recoverable set as a non-blocking quality diagnostic.
    ids = [w["shot_id"] for w in warnings]
    assert len(ids) == len(set(ids))
    assert all(w.get("required_dimensions") for w in warnings)
    assert all(set(w.get("affected_shot_ids") or []) == set(ids) for w in warnings)


def test_director_v16_2_blocks_camera_movement_pressure_even_when_other_dimensions_vary():
    context = _context()
    raw = _director()
    raw["shot_purpose"] = "reaction"
    design = raw.get("execution_shot_design") or {}
    # The current shot intentionally varies shot size/framing, but camera and
    # movement still repeat the scene-wide dominant grammar.
    design["shot_size"] = "close"
    raw["execution_shot_design"] = design
    raw["execution_framing"] = {"framing_type": "reaction", "foreground_character_refs": []}
    camera = design.get("camera")
    movement = design.get("movement")
    context["program_owned"]["scene_design_summary"] = {
        "prior_shot_count": 9,
        "shot_size_counts": {"medium_close": 5, "close": 4},
        "camera_counts": {camera: 9},
        "movement_counts": {movement: 9},
        "framing_counts": {"single": 4, "reaction": 3, "two_shot": 2},
        "purpose_counts": {"speaker": 4, "reaction": 2, "relationship": 3},
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e["type"] == "director_scene_camera_distribution_pressure" for e in errors)


def test_v2m_detail_focus_falls_back_to_other_canonical_identity_instead_of_empty_anchor():
    story = _story()
    story["characters"][0]["visual_lock"] = {"face": "瘦长脸，颌线清晰", "hair": "黑色短发，两侧推短"}
    pvb = {"characters": [{
        "character_id": "char_001",
        "visual_identity": {},
        "wardrobe": {},
    }]}
    shot = _shot()
    shot["shot_size"] = "close"
    shot["director"]["visual_focus"] = {"body_regions": {"char_001": ["hands"]}}
    shot["director"]["execution_framing"] = {"framing_type": "detail", "foreground_character_refs": []}
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), story, _script(), pvb, {"scenes": []}, _style()
    )
    anchor = result["shot_consumption_manifest"]["character_continuity_anchor"]
    assert anchor
    assert "年轻人" in anchor
    assert "黑色短发" in anchor or "瘦长脸" in anchor
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot], script=_script(),
    )
    assert not [e for e in readiness["errors"] if e.get("type") == "E023_SHOT_NOT_SELF_CONTAINED"]


def test_v2m_visual_performance_strips_frozen_dialogue_from_logic_and_execution():
    shot = _shot(dialogue=True, purpose="speaker")
    shot["dialogue"] = [{"character_id": "char_001", "line": "你到底去哪了？"}]
    shot["director"]["performance_actions"] = []
    shot["director"]["performance_logic"] = [{
        "character_ref": "char_001",
        "base_emotion": "克制",
        "emotion_delta": "听见对方问“你到底去哪了？”后短暂停顿",
        "trigger": "听见对方说“你到底去哪了？”",
        "behavior_goal": "",
        "behavior_tendency": "",
        "evidence_source": [{"quote": "你到底去哪了？"}],
    }]
    shot["director"]["performance_execution"] = [{
        "character_ref": "char_001",
        "expression": "听到“你到底去哪了？”后眉间轻轻收紧",
        "breathing": "呼吸短暂停顿",
    }]
    semantics = _semantics(dialogue=True)
    semantics["dialogue"] = [{"character_id": "char_001", "line": "你到底去哪了？", "offscreen": False}]
    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    manifest = result["shot_consumption_manifest"]
    assert "你到底去哪了？" not in manifest["visual_content"]
    assert "你到底去哪了？" in manifest["dialogue"]
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness["errors"] if e.get("type") == "exact_dialogue_repeated_in_visual_content"]


def test_v2m_short_dialogue_does_not_corrupt_unrelated_performance_word():
    shot = _shot(dialogue=True, purpose="speaker")
    shot["dialogue"] = [{"character_id": "char_001", "line": "好"}]
    shot["director"]["performance_actions"] = []
    shot["director"]["performance_logic"] = []
    shot["director"]["performance_execution"] = [{
        "character_ref": "char_001",
        "expression": "人物状态良好，眉眼放松",
        "breathing": "呼吸平稳",
    }]
    semantics = _semantics(dialogue=True)
    semantics["dialogue"] = [{"character_id": "char_001", "line": "好", "offscreen": False}]
    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    manifest = result["shot_consumption_manifest"]
    assert "状态良好" in manifest["visual_content"]
    assert "状态良" not in manifest["visual_content"].replace("状态良好", "")
    assert "好" in manifest["dialogue"]


def test_v2m_visible_character_with_no_canonical_visual_asset_still_hard_fails_e023():
    story = _story()
    story["characters"][0]["visual_lock"] = {}
    pvb = {"characters": [{
        "character_id": "char_001",
        "visual_identity": {},
        "wardrobe": {},
    }]}
    shot = _shot()
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), story, _script(), pvb, {"scenes": []}, _style()
    )
    assert result["shot_consumption_manifest"]["character_continuity_anchor"] == ""
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot], script=_script(),
    )
    e023 = [e for e in readiness["errors"] if e.get("type") == "E023_SHOT_NOT_SELF_CONTAINED"]
    assert e023
    assert e023[0]["target_character_refs"] == ["char_001"]
    assert e023[0]["source_layer"] == "PVB Canonical Asset Registry"


def test_v2m_reported_e023_cluster_is_caught_by_asset_preflight_and_attributed_to_pvb():
    target_shots = ["SH007", "SH010", "SH016", "SH026", "SH027", "SH029", "SH036", "SH037"]
    story = _story()
    story["characters"][0]["visual_lock"] = {}
    pvb = {"characters": [{"character_id": "char_001", "visual_identity": {}, "wardrobe": {}}]}
    shots = []
    for shot_id in target_shots:
        shot = _shot()
        shot["shot_id"] = shot_id
        shots.append(shot)
    errors = validate_visible_character_asset_preflight(story, pvb, shots)
    assert [e["shot_id"] for e in errors] == target_shots
    assert all(e["type"] == "pvb_visible_identity_anchor_missing" for e in errors)
    assert all(e["target_character_refs"] == ["char_001"] for e in errors)


def test_v2m_reported_compile_static_e023_cluster_and_dialogue_duplication_regression():
    target_shots = ["SH007", "SH010", "SH016", "SH026", "SH027", "SH029", "SH036", "SH037"]
    story = _story()
    # Reproduce the contract shape that previously failed: the character has
    # canonical face/hair identity, but the current detail framing asks for a
    # different body region and age/default wardrobe are absent.
    story["characters"][0]["visual_lock"] = {
        "face": "瘦长脸，颌线清晰",
        "hair": "黑色短发，两侧推短",
    }
    pvb = {"characters": [{
        "character_id": "char_001",
        "visual_identity": {},
        "wardrobe": {},
    }]}

    shot_specs = []
    shot_prompts = []
    for shot_id in target_shots:
        shot = _shot(dialogue=shot_id == "SH016", purpose="speaker" if shot_id == "SH016" else "continuity")
        shot["shot_id"] = shot_id
        shot["shot_size"] = "close"
        shot["director"]["execution_framing"] = {"framing_type": "detail", "foreground_character_refs": []}
        shot["director"]["visual_focus"] = {"body_regions": {"char_001": ["hands"]}}
        semantics = _semantics(dialogue=shot_id == "SH016")
        if shot_id == "SH016":
            shot["dialogue"] = [{"character_id": "char_001", "line": "你到底去哪了？"}]
            shot["director"]["performance_actions"] = []
            shot["director"]["performance_logic"] = [{
                "character_ref": "char_001",
                "base_emotion": "克制",
                "emotion_delta": "听见对方问“你到底去哪了？”后短暂停顿",
                "trigger": "听见对方说“你到底去哪了？”",
                "behavior_goal": "",
                "behavior_tendency": "",
                "evidence_source": [{"quote": "你到底去哪了？"}],
            }]
            shot["director"]["performance_execution"] = [{
                "character_ref": "char_001",
                "expression": "听到“你到底去哪了？”后眉间轻轻收紧",
                "breathing": "呼吸短暂停顿",
            }]
            semantics["dialogue"] = [{"character_id": "char_001", "line": "你到底去哪了？", "offscreen": False}]
        result = compile_shot_consumption_prompt_v2d(
            shot, semantics, story, _script(), pvb, {"scenes": []}, _style()
        )
        shot_specs.append(shot)
        shot_prompts.append(result)

    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": shot_prompts, "character_prompts": [], "scene_prompts": []},
        shot_specs=shot_specs,
        script=None,
    )
    blocked = [
        e for e in readiness["errors"]
        if e.get("type") in {"E023_SHOT_NOT_SELF_CONTAINED", "exact_dialogue_repeated_in_visual_content"}
    ]
    assert blocked == []

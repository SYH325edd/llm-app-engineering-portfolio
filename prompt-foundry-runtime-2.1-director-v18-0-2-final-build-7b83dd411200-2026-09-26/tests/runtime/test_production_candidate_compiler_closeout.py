from __future__ import annotations

import copy

import pytest

from runtime.consumption_compiler import _ambiguous_subject_warning, _dedupe_stable_clauses, _time_inconsistency_warning, compile_shot_consumption_prompt_v2d
from runtime.orchestrator import RuntimePaused, RuntimeV20
from runtime.checkpoints import CheckpointStore
from app.store import RunStore
from runtime.production_readiness import validate_production_readiness
from runtime.shot_visibility import visible_character_refs
from runtime.stages.director import canonicalize_director_fragment, validate_director_fragment
from tests.runtime.test_production_closeout_v1 import _pvb, _script, _semantics, _shot, _story, _style
from tests.runtime.test_stage06_director_contract import _context, _director


def test_pc_scene_state_subset_dedupe_removes_all_covered_fragments():
    values = [
        "下午",
        "自然光从小区门口一侧斜照，形成柔和阴影，无人工补光",
        "下午自然光从小区门口一侧斜照，形成柔和阴影，无人工补光",
        "旧木工具箱表面磨损",
    ]
    assert _dedupe_stable_clauses(values) == [
        "下午自然光从小区门口一侧斜照，形成柔和阴影，无人工补光",
        "旧木工具箱表面磨损",
    ]


def test_pc_director_subject_ownership_uses_visible_canonical_name_only():
    context = _context()
    context["shot"]["character_refs"] = ["char_001", "char_002"]
    context["assets"]["characters"]["char_002"] = {
        "character_id": "char_002",
        "canonical_name": "老周",
    }
    context["program_owned"]["allowed_character_refs"] = ["char_001", "char_002"]
    raw = _director()
    raw["primary_subject_refs"] = ["char_001", "char_002"]
    raw["performance_actions"][0]["character_ref"] = "char_001"
    raw["performance_actions"][0]["action"] = "老周抬眼看向年轻人"
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    mismatch = next(e for e in errors if e["type"] == "director_performance_subject_mismatch")
    assert mismatch["path"] == "director.performance_actions[0].action"
    assert mismatch["conflicting_canonical_name"] == "老周"


def test_pc_monoculture_repair_contract_requires_one_dominant_path_to_change():
    context = _context()
    raw = _director()
    raw["shot_purpose"] = "speaker"
    raw["execution_framing"] = {"framing_type": "single", "foreground_character_refs": []}
    design = raw["execution_shot_design"]
    framing = raw["execution_framing"]
    context["program_owned"]["scene_design_summary"] = {
        "prior_shot_count": 8,
        "shot_size_counts": {design["shot_size"]: 1},
        "camera_counts": {design["camera"]: 8},
        "movement_counts": {design["movement"]: 8},
        "framing_counts": {framing["framing_type"]: 8},
        "purpose_counts": {"speaker": 3, "reaction": 2, "relationship": 3},
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    error = next(e for e in errors if e["type"] == "director_scene_design_monoculture")
    assert error["must_change_any_of_paths"] == [
        "director.execution_shot_design.camera",
        "director.execution_shot_design.movement",
        "director.execution_framing.framing_type",
    ]
    policy = RuntimeV20._repair_policy("director_shot", [error])
    assert policy["must_change_targeted_fields"] is False
    assert policy["must_change_any_of_paths"] == error["must_change_any_of_paths"]
    assert policy["repair_targets"] == error["repair_targets"]


def test_pc_final_prompt_has_no_ir_labels_and_time_warning_needs_authority():
    shot = _shot()
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    prompt = result["prompt_seedance"]
    assert "人物连续性：" not in prompt
    assert "场景连续性：" not in prompt
    assert "当前子空间：" not in prompt

    timed_shot = copy.deepcopy(shot)
    timed_shot["authoritative_scene_time"] = "下午"
    warning = _time_inconsistency_warning(timed_shot, {
        "scene": "修鞋摊 下午",
        "scene_state_anchor": "下午自然光",
        "spatial_blocking": "老周坐在摊后",
        "performance_text": "老周在深夜灯光下抬眼",
        "environment_sfx": "",
    })
    assert warning and warning["code"] == "W008_TIME_INCONSISTENCY"
    no_authority = copy.deepcopy(timed_shot)
    no_authority.pop("authoritative_scene_time", None)
    assert _time_inconsistency_warning(no_authority, {"performance_text": "深夜抬眼"}) is None

    compiled = {"shot_prompts": [copy.deepcopy(result)], "character_prompts": [], "scene_prompts": []}
    compiled["shot_prompts"][0]["shot_consumption_manifest"]["character_continuity_anchor"] = ""
    readiness = validate_production_readiness(compiled_project=compiled, shot_specs=[shot], script=_script())
    e023 = [e for e in readiness["errors"] if e["type"] == "E023_SHOT_NOT_SELF_CONTAINED"]
    assert len(e023) == 1



def test_pc_visible_character_definition_uses_shared_union_not_broad_allowlist():
    shot = {
        "character_refs": ["char_001", "char_002", "char_003", "char_004"],
        "director": {
            "primary_subject_refs": ["char_001"],
            "reaction_target_refs": ["char_002"],
        },
        "state_in": {
            "characters": {
                "char_003": {"position": "门口"},
                "char_004": {},
            }
        },
    }
    assert visible_character_refs(shot, legacy_fallback=False) == ["char_001", "char_002", "char_003"]


def test_pc_ir_whitelist_rejects_unknown_top_level_field_once():
    shot = _shot()
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    tampered = copy.deepcopy(result)
    tampered["prompt_seedance"] += "\n内部字段：不得泄漏"
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [tampered], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot],
        script=_script(),
    )
    errors = [e for e in readiness["errors"] if e["type"] == "E022_RENDERED_PROMPT_IR_LEAKAGE"]
    assert len(errors) == 1


def test_pc_w010_only_warns_for_unresolved_ambiguous_pronoun():
    story = copy.deepcopy(_story())
    story.setdefault("characters", []).append({"character_id": "char_002", "canonical_name": "另一个人"})
    shot = _shot()
    shot["director"]["performance_actions"] = [{"character_ref": "char_001", "action": "他们同时抬手"}]
    warning = _ambiguous_subject_warning(shot, ["char_001", "char_002"], story)
    assert warning and warning["code"] == "W010_ACTION_AMBIGUOUS_SUBJECT"
    shot["director"]["performance_actions"] = [{"character_ref": "char_001", "action": "他抬手"}]
    assert _ambiguous_subject_warning(shot, ["char_001", "char_002"], story) is None


def test_pc_build_change_drops_stale_repair_hints_but_preserves_resume_scope(tmp_path, monkeypatch):
    runtime = RuntimeV20(
        model=object(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    monkeypatch.setattr(runtime, "BUILD_ID", "new-build")
    run = {
        "run_id": "run_build_change",
        "build_id": "old-build",
        "source_text": "测试",
        "status": "paused",
        "error": {"unit_id": "director:SH017", "stage": "director"},
        "units": {"story_bible": {"stage": "story_bible", "status": "completed"}},
        "artifacts": {},
        "validations": {},
        "events": [],
        "recovery": {
            "source_repair_hints": {
                "director:SH017": {
                    "validation_errors": [{"type": "director_scene_design_monoculture", "path": "director.execution_shot_design"}],
                    "invalid_output": {"director": {}},
                }
            }
        },
    }

    def stop_after_build_prepare(current_run, source_text):
        assert current_run["recovery"]["source_repair_hints"] == {}
        # Existing units/checkpoints are not eagerly invalidated by the build change.
        assert "story_bible" in current_run["units"]
        raise RuntimePaused("stop after build preparation")

    monkeypatch.setattr(runtime, "_run_story_bible_stage", stop_after_build_prepare)
    result = runtime._execute(run)
    assert result is run
    assert run["status"] == "paused"
    assert run["build_id"] == "new-build"
    assert any(event.get("type") == "stale_repair_hints_cleared" for event in run["events"])


def test_pc_visual_target_focus_mismatch_has_precise_repair_scope():
    context = _context()
    context["shot"]["character_refs"] = ["char_001", "char_002"]
    context["assets"]["characters"]["char_002"] = {"character_id": "char_002", "canonical_name": "老周"}
    context["program_owned"]["allowed_character_refs"] = ["char_001", "char_002"]
    raw = _director()
    raw["primary_subject_refs"] = ["char_001", "char_002"]
    raw["visual_target"] = {"target_type": "character", "character_refs": ["char_001"], "prop_refs": [], "environment_keys": []}
    raw["visual_focus"] = {
        "focus_type": "character",
        "subject_refs": ["char_002"],
        "body_regions": {"char_002": ["face"]},
        "prop_refs": [],
        "environment_keys": [],
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    error = next(e for e in errors if e["type"] == "director_visual_target_focus_mismatch")
    assert error["repair_targets"] == [
        "director.visual_focus.subject_refs",
        "director.visual_focus.body_regions",
    ]
    assert error["allowed_character_refs"] == ["char_001"]
    assert error["preserve_visual_target"]["character_refs"] == ["char_001"]


def test_pc_repeated_execution_design_requires_real_any_of_change():
    context = _context()
    context["program_owned"]["recent_shot_designs"] = [
        {"shot_id": "SH001", "shot_size": "medium", "camera": "eye_level", "movement": "static", "shot_purpose": "speaker", "visual_target": {"target_type": "character", "character_refs": ["char_001"], "prop_refs": [], "environment_keys": []}},
        {"shot_id": "SH002", "shot_size": "medium", "camera": "eye_level", "movement": "static", "shot_purpose": "speaker", "visual_target": {"target_type": "character", "character_refs": ["char_001"], "prop_refs": [], "environment_keys": []}},
    ]
    raw = _director()
    raw["shot_purpose"] = "speaker"
    raw["execution_shot_design"] = {"shot_size": "medium", "camera": "eye_level", "movement": "static"}
    raw["visual_target"] = {"target_type": "reaction", "character_refs": ["char_001"], "prop_refs": [], "environment_keys": []}
    raw["visual_focus"] = {"focus_type": "reaction", "subject_refs": ["char_001"], "body_regions": {}, "prop_refs": [], "environment_keys": []}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=False)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=False)
    error = next(e for e in errors if e["type"] == "director_repeated_execution_design")
    assert error["must_change_any_of_paths"] == [
        "director.execution_shot_design.shot_size",
        "director.execution_shot_design.camera",
        "director.execution_shot_design.movement",
    ]
    assert "medium" not in error["allowed_alternative_values"]["director.execution_shot_design.shot_size"]
    policy = RuntimeV20._repair_policy("director_shot", [error])
    assert policy["must_change_targeted_fields"] is False
    assert policy["must_change_any_of_paths"] == error["must_change_any_of_paths"]


def test_pc_readiness_hash_gate_ignores_nonvisible_context_character():
    shot = _shot()
    shot["character_refs"] = ["char_001", "char_002"]
    shot["director"]["primary_subject_refs"] = ["char_001"]
    shot["director"]["reaction_target_refs"] = []
    compiled_result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    visible_hash = compiled_result["shot_consumption_manifest"]["provenance"]["character_asset_hashes"]["char_001"]
    compiled = {
        "shot_prompts": [compiled_result],
        "character_prompts": [
            {"character_id": "char_001", "asset_hash": visible_hash},
            {"character_id": "char_002", "asset_hash": "canonical-but-not-rendered"},
        ],
        "scene_prompts": [],
    }
    readiness = validate_production_readiness(compiled_project=compiled, shot_specs=[shot], script=_script())
    mismatches = [e for e in readiness["errors"] if e["type"] == "character_asset_source_of_truth_mismatch"]
    assert mismatches == []


def test_pc_e021_and_compiler_collapse_canonical_name_plus_pronoun():
    context = _context()
    owner = context["assets"]["characters"]["char_001"]["canonical_name"]
    raw = _director()
    raw["performance_actions"][0]["character_ref"] = "char_001"
    raw["performance_actions"][0]["action"] = f"{owner}他抬眼看向前方"
    canonical, changes = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert changes >= 1
    assert canonical["performance_actions"][0]["action"] == "抬眼看向前方"
    assert not any(e["type"] == "director_performance_subject_mismatch" for e in errors)

    shot = _shot()
    semantics = _semantics()
    semantics["visual_events"] = [{
        "action": "他侧头看向门口",
        "character_refs": ["char_001"],
        "prop_refs": [],
        "source_evidence": [{"quote": "侧头看向门口"}],
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    visual = result["shot_consumption_manifest"]["visual_content"]
    assert "年轻人他" not in visual
    assert "年轻人侧头看向门口" in visual


def test_pc_picture_content_drops_internal_appearance_label_and_scene_light_pollution():
    shot = _shot()
    shot["composition"] = "年轻人面部近景，夕阳照在脸上"
    semantics = _semantics()
    semantics["appearance_overlays"] = [{
        "character_ref": "char_001",
        "narrative_context_ref": "",
        "overrides": {"age_appearance": "年轻人，脸部在夕阳里显得疲惫"},
        "source_evidence": [{"quote": "年轻人抬头"}],
    }]
    semantics["visual_events"] = [{
        "action": "年轻人抬头，脸部在夕阳里显得疲惫",
        "character_refs": ["char_001"], "prop_refs": [], "source_evidence": [{"quote": "年轻人抬头"}],
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    prompt = result["prompt_seedance"]
    assert "人物阶段：" not in prompt
    assert "夕阳" not in result["shot_consumption_manifest"]["visual_content"]
    assert "夕阳" not in result["shot_consumption_manifest"]["spatial_blocking"]


def test_pc_readiness_rejects_unknown_inline_visual_label():
    shot = _shot()
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    tampered = copy.deepcopy(result)
    manifest = tampered["shot_consumption_manifest"]
    manifest["visual_content"] = "人物阶段：年轻人。" + manifest["visual_content"]
    lines = tampered["prompt_seedance"].splitlines()
    for index, line in enumerate(lines):
        if line.startswith("画面内容："):
            lines[index] = "画面内容：" + manifest["visual_content"]
            break
    tampered["prompt_seedance"] = "\n".join(lines)
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [tampered], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot], script=_script(),
    )
    errors = [e for e in readiness["errors"] if e["type"] == "E022_RENDERED_PROMPT_IR_LEAKAGE"]
    assert len(errors) == 1
    assert "人物阶段" in errors[0]["detail"]


def test_pc_scene_anchor_is_landmarks_plus_compact_color_not_material_or_plot_prop_detail():
    story = _story()
    story["scenes"][0]["visual_lock"].update({
        "layout": "一台手摇补鞋机；一个木头工具箱；几把塑料凳",
        "materials": "手摇补鞋机为铸铁机身配木柄摇轮",
        "color": "整体以旧木棕、铸铁黑、塑料红蓝与灰白地面为主，黄铜钥匙为局部暖金点缀",
    })
    result = compile_shot_consumption_prompt_v2d(
        _shot(), _semantics(), story, _script(), _pvb(), {"scenes": []}, _style()
    )
    anchor = result["shot_consumption_manifest"]["scene_continuity_anchor"]
    assert "手摇补鞋机" in anchor and "木头工具箱" in anchor
    assert "铸铁机身配木柄摇轮" not in anchor
    assert "黄铜钥匙" not in anchor
    assert "旧木棕、铸铁黑为主" in anchor
    assert not any(w.get("code") == "W009_CONTINUITY_BUDGET_HIGH" for w in result["warnings"])


def test_pc_short_dialogue_substring_is_not_false_positive_but_real_speech_copy_still_fails():
    from runtime.shot_manifest import render_shot_prompt

    shot = _shot(dialogue=True, purpose="speaker")
    shot["dialogue"] = [{"character_id": "char_001", "line": "好"}]
    shot["director"]["performance_actions"] = []
    semantics = _semantics(dialogue=True)
    semantics["dialogue"] = [{"character_id": "char_001", "line": "好", "offscreen": False}]
    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {"scenes": []}, _style()
    )
    result["consumption_view"]["dialogue"] = copy.deepcopy(semantics["dialogue"])
    manifest = result["shot_consumption_manifest"]
    manifest["visual_content"] = "人物状态良好，呼吸平稳。"
    result["prompt_seedance"] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness["errors"] if e.get("type") == "exact_dialogue_repeated_in_visual_content"]

    manifest["visual_content"] = "人物低声说：好。"
    result["prompt_seedance"] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={"shot_prompts": [result], "character_prompts": [], "scene_prompts": []},
        shot_specs=[shot], script=None,
    )
    assert [e for e in readiness["errors"] if e.get("type") == "exact_dialogue_repeated_in_visual_content"]

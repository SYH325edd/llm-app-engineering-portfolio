from __future__ import annotations

import copy

from tests.runtime.test_production_semantics_v1a import _context, _valid_candidate


def _v1b_candidate():
    value = _valid_candidate()
    value.update({
        "dialogue": [{"character_id": "char_001", "line": "我回来了。", "offscreen": False, "delivery_mode": "direct", "embedded_quotes": []}],
        "diegetic_text": [],
        "production_choices": [],
    })
    return value


def _no_story_change():
    return {
        "new_characters": [],
        "new_relationships": [],
        "new_plot_outcomes": [],
        "new_dialogue_information": [],
        "new_locations": [],
        "new_key_props": [],
    }


def test_v1b_contract_adds_only_choice_dialogue_and_diegetic_text():
    from runtime.stages.production_semantics import CONTRACT_VERSION, build_production_semantics_payload

    payload = build_production_semantics_payload(_context(), unit_id="production_semantics:SH001")
    assert CONTRACT_VERSION == "production_semantics_shot.v1j"
    assert set(payload["output_template"]) == {
        "visual_events", "audio_events", "renderability_status", "renderability_issues",
        "dialogue_delivery", "diegetic_text", "production_choices", "appearance_overlays",
    }


def test_v1b_accepts_evidence_bound_no_story_change_production_choice():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _v1b_candidate()
    candidate["production_choices"] = [{
        "type": "minimal_action_mechanism",
        "choice": "甲把现有信封放到桌上。",
        "affected_character_refs": ["char_001"],
        "affected_prop_refs": ["prop_001"],
        "narrative_context_ref": "",
        "impact": "no_story_change",
        "rationale": "只把原文已明确的放置信封结果具体化为当前镜头可见动作，不改变剧情结果。",
        "story_changes": _no_story_change(),
        "source_evidence": [{"quote": "甲把信封放到桌上。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, _context())
    assert validate_production_semantics_output(value, _context()) == []


def test_v1b_rejects_choice_without_evidence_wrong_context_or_declared_story_change():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _v1b_candidate()
    candidate["production_choices"] = [{
        "type": "minimal_action_mechanism",
        "choice": "甲去另一个城市寻找乙。",
        "affected_character_refs": ["char_001"],
        "affected_prop_refs": [],
        "narrative_context_ref": "context_wrong",
        "impact": "no_story_change",
        "rationale": "错误示例",
        "story_changes": dict(_no_story_change(), new_plot_outcomes=["找到乙"]),
        "source_evidence": [],
    }]
    value, _ = canonicalize_production_semantics(candidate, _context())
    kinds = {item["type"] for item in validate_production_semantics_output(value, _context())}
    assert value["production_choices"][0]["narrative_context_ref"] == ""
    assert "production_semantics_missing_evidence" in kinds
    assert "production_choice_context_mismatch" not in kinds
    assert "production_choice_changes_story" in kinds


def test_v1f_dialogue_text_speaker_and_offscreen_are_program_owned():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _v1b_candidate()
    candidate["dialogue"] = [{"character_id": "char_wrong", "line": "篡改对白", "offscreen": True}]
    value, changes = canonicalize_production_semantics(candidate, _context())
    assert changes >= 1
    assert value["dialogue"] == [{"character_id": "char_001", "line": "我回来了。", "offscreen": False, "delivery_mode": "direct", "embedded_quotes": []}]
    assert validate_production_semantics_output(value, _context()) == []


def test_v1b_diegetic_text_must_be_exact_source_text_on_existing_carrier():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context()
    ctx["shot"]["description"] += "信封表面写着A17。"
    ctx["shot"]["source_evidence"].append({"quote": "信封表面写着A17。"})
    ctx["program_owned"]["current_shot_evidence"].append("信封表面写着A17。")
    candidate = _v1b_candidate()
    candidate["diegetic_text"] = [{
        "content": "A17",
        "carrier_type": "prop",
        "carrier_ref": "prop_001",
        "required_visible": True,
        "source_evidence": [{"quote": "信封表面写着A17。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert validate_production_semantics_output(value, ctx) == []

    bad = copy.deepcopy(candidate)
    bad["diegetic_text"][0]["content"] = "B99"
    value, _ = canonicalize_production_semantics(bad, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_unanchored_diegetic_text" in kinds


def test_v1b_rejects_diegetic_text_carrier_outside_current_shot():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context()
    ctx["shot"]["description"] += "信封表面写着A17。"
    ctx["program_owned"]["current_shot_evidence"].append("信封表面写着A17。")
    candidate = _v1b_candidate()
    candidate["diegetic_text"] = [{
        "content": "A17",
        "carrier_type": "prop",
        "carrier_ref": "prop_999",
        "required_visible": True,
        "source_evidence": [{"quote": "信封表面写着A17。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_invalid_text_carrier" in kinds


def test_v1f_model_may_omit_dialogue_entirely_because_runtime_reconstructs_it():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    candidate = _v1b_candidate()
    candidate.pop("dialogue", None)
    value, changes = canonicalize_production_semantics(candidate, _context())
    assert changes >= 1
    assert value["dialogue"] == [{"character_id": "char_001", "line": "我回来了。", "offscreen": False, "delivery_mode": "direct", "embedded_quotes": []}]
    assert validate_production_semantics_output(value, _context()) == []


def test_v1f_derives_dialogue_visibility_from_current_shot_instead_of_model_boolean():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    # Model-side dialogue is ignored entirely; visible speaker => onscreen.
    candidate = _v1b_candidate()
    candidate["dialogue"][0]["offscreen"] = "可能"
    value, changes = canonicalize_production_semantics(candidate, _context())
    assert changes >= 1
    assert value["dialogue"][0]["offscreen"] is False
    assert validate_production_semantics_output(value, _context()) == []

    # The same frozen line over a reaction/empty visual Shot is deterministically offscreen.
    ctx = _context()
    ctx["shot"]["character_refs"] = []
    ctx["program_owned"]["allowed_character_refs"] = []
    candidate = _v1b_candidate()
    candidate["visual_events"] = []
    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert value["dialogue"] == [{"character_id": "char_001", "line": "我回来了。", "offscreen": True, "delivery_mode": "direct", "embedded_quotes": []}]
    assert validate_production_semantics_output(value, ctx) == []


def test_v1e_normalizes_required_visible_boolean_representation_only():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context()
    ctx["shot"]["description"] += "信封表面写着A17。"
    ctx["program_owned"]["current_shot_evidence"].append("信封表面写着A17。")
    candidate = _v1b_candidate()
    candidate["diegetic_text"] = [{
        "content": "A17",
        "carrier_type": "prop",
        "carrier_ref": "prop_001",
        "required_visible": "true",
        "source_evidence": [{"quote": "信封表面写着A17。"}],
    }]
    value, changes = canonicalize_production_semantics(candidate, ctx)
    assert changes >= 1
    assert value["diegetic_text"][0]["required_visible"] is True
    assert validate_production_semantics_output(value, ctx) == []

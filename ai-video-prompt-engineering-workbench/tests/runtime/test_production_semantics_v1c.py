from __future__ import annotations

import copy

from tests.runtime.test_production_semantics_v1a import _context, _valid_candidate


def _candidate():
    value = _valid_candidate()
    value["appearance_overlays"] = []
    return value


def _context_with_age_evidence():
    ctx = _context()
    ctx["context_ref"] = "context_001"
    ctx["assets"]["context"] = {"context_id": "context_001", "temporal_mode": "flashback"}
    ctx["shot"]["description"] = "十六岁的甲站在桌边。"
    ctx["shot"]["source_evidence"].append({"quote": "十六岁的甲站在桌边。"})
    ctx["program_owned"]["current_shot_evidence"].append("十六岁的甲站在桌边。")
    return ctx


def test_v1c_contract_adds_only_appearance_overlays():
    from runtime.stages.production_semantics import CONTRACT_VERSION, build_production_semantics_payload

    payload = build_production_semantics_payload(_context(), unit_id="production_semantics:SH001")
    assert CONTRACT_VERSION == "production_semantics_shot.v1j"
    assert "appearance_overlays" in payload["output_template"]
    assert set(payload["output_contract"]["allowed_appearance_override_keys"]) == {
        "age_appearance", "temporary_injury", "temporary_clothing_change"
    }


def test_v1c_accepts_evidence_bound_age_overlay_for_current_character_and_context():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context_with_age_evidence()
    candidate = _candidate()
    candidate["visual_events"] = []
    candidate["audio_events"] = []
    candidate["appearance_overlays"] = [{
        "character_ref": "char_001",
        "narrative_context_ref": "context_001",
        "overrides": {"age_appearance": "十六岁少年时期"},
        "source_evidence": [{"quote": "十六岁的甲站在桌边。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert validate_production_semantics_output(value, ctx) == []


def test_v1c_rejects_overlay_without_evidence_wrong_character_or_wrong_context():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context_with_age_evidence()
    candidate = _candidate()
    candidate["appearance_overlays"] = [{
        "character_ref": "char_999",
        "narrative_context_ref": "context_wrong",
        "overrides": {"age_appearance": "十六岁少年时期"},
        "source_evidence": [],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert value["appearance_overlays"][0]["narrative_context_ref"] == "context_001"
    assert "production_semantics_missing_evidence" in kinds
    assert "appearance_overlay_unknown_character" in kinds
    assert "appearance_overlay_context_mismatch" not in kinds


def test_v1c_rejects_identity_or_base_visual_fields_in_overlay():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context_with_age_evidence()
    candidate = _candidate()
    candidate["appearance_overlays"] = [{
        "character_ref": "char_001",
        "narrative_context_ref": "context_001",
        "overrides": {"hair": "寸头", "face": "另一张脸"},
        "source_evidence": [{"quote": "十六岁的甲站在桌边。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "appearance_overlay_forbidden_key" in kinds


def test_v1c_overlay_does_not_mutate_character_asset():
    from runtime.stages.production_semantics import canonicalize_production_semantics

    ctx = _context_with_age_evidence()
    before = copy.deepcopy(ctx["assets"]["characters"]["char_001"])
    candidate = _candidate()
    candidate["appearance_overlays"] = [{
        "character_ref": "char_001",
        "narrative_context_ref": "context_001",
        "overrides": {"age_appearance": "十六岁少年时期"},
        "source_evidence": [{"quote": "十六岁的甲站在桌边。"}],
    }]
    canonicalize_production_semantics(candidate, ctx)
    assert ctx["assets"]["characters"]["char_001"] == before


def test_v1e_does_not_reject_authorized_latin_text_on_language_alone():
    from runtime.stages.production_semantics import canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context_with_age_evidence()
    candidate = _candidate()
    candidate["visual_events"][0]["action"] = "甲把 envelope 放到桌上。"
    candidate["production_choices"] = [{
        "type": "spatial_adjustment",
        "choice": "camera 靠近桌边",
        "affected_character_refs": ["char_001"],
        "affected_prop_refs": [],
        "narrative_context_ref": "context_001",
        "impact": "no_story_change",
        "rationale": "保持原剧情",
        "story_changes": {
            "new_characters": [], "new_dialogue_information": [], "new_key_props": [],
            "new_locations": [], "new_plot_outcomes": [], "new_relationships": [],
        },
        "source_evidence": [{"quote": "甲把信封放到桌上。"}],
    }]
    candidate["appearance_overlays"] = [{
        "character_ref": "char_001",
        "narrative_context_ref": "context_001",
        "overrides": {"age_appearance": "16-year-old 少年时期"},
        "source_evidence": [{"quote": "十六岁的甲站在桌边。"}],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_non_chinese_visual_event" not in kinds
    assert "production_semantics_non_chinese_production_choice" not in kinds
    assert "production_semantics_non_chinese_appearance_overlay" not in kinds


def test_v1e_program_owns_nested_narrative_context_refs_and_model_contract_does_not_require_them():
    from runtime.stages.production_semantics import build_production_semantics_payload, canonicalize_production_semantics, validate_production_semantics_output

    ctx = _context_with_age_evidence()
    ctx["program_owned"]["current_narrative_context_ref"] = "context_001"
    payload = build_production_semantics_payload(ctx, unit_id="production_semantics:SH001")
    assert payload["program_owned"]["current_narrative_context_ref"] == "context_001"
    assert "narrative_context_ref" not in payload["output_contract"]["item_fields"]["production_choices"]
    assert "narrative_context_ref" not in payload["output_contract"]["item_fields"]["appearance_overlays"]

    candidate = _candidate()
    candidate["production_choices"] = [{
        "type": "natural_reaction",
        "choice": "甲短暂停顿。",
        "affected_character_refs": ["char_001"],
        "affected_prop_refs": [],
        "impact": "no_story_change",
        "rationale": "只补充不改变剧情的自然反应。",
        "story_changes": {
            "new_characters": [], "new_relationships": [], "new_plot_outcomes": [],
            "new_dialogue_information": [], "new_locations": [], "new_key_props": [],
        },
        "source_evidence": [{"quote": "甲把信封放到桌上。"}],
    }]
    candidate["appearance_overlays"] = [{
        "character_ref": "char_001",
        "overrides": {"age_appearance": "十六岁少年时期"},
        "source_evidence": [{"quote": "十六岁的甲站在桌边。"}],
    }]
    value, changes = canonicalize_production_semantics(candidate, ctx)
    assert changes >= 2
    assert value["production_choices"][0]["narrative_context_ref"] == "context_001"
    assert value["appearance_overlays"][0]["narrative_context_ref"] == "context_001"
    assert "production_choice_context_mismatch" not in {e["type"] for e in validate_production_semantics_output(value, ctx)}
    assert "appearance_overlay_context_mismatch" not in {e["type"] for e in validate_production_semantics_output(value, ctx)}

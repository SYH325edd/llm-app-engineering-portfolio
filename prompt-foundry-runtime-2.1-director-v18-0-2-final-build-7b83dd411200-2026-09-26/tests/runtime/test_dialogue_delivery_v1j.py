from __future__ import annotations

from runtime.shot_manifest import _dialogue_text
from runtime.stages.production_semantics import (
    canonicalize_production_semantics,
    validate_production_semantics_output,
)
from tests.runtime.test_production_semantics_v1a import _context, _valid_candidate


def test_dialogue_delivery_defaults_to_direct_without_consuming_repair():
    ctx = _context()
    candidate = _valid_candidate()
    candidate.pop("dialogue", None)
    value, changes = canonicalize_production_semantics(candidate, ctx)
    assert changes > 0
    assert value["dialogue_delivery"] == []
    assert value["dialogue"] == [{
        "character_id": "char_001",
        "line": "我回来了。",
        "offscreen": False,
        "delivery_mode": "direct",
        "embedded_quotes": [],
    }]
    assert validate_production_semantics_output(value, ctx) == []


def test_dialogue_delivery_override_is_independent_from_offscreen_visibility_and_reaches_prompt_label():
    ctx = _context()
    ctx["program_owned"]["allowed_character_refs"] = []
    candidate = _valid_candidate()
    candidate["dialogue_delivery"] = [{"dialogue_index": 0, "mode": "quoted"}]
    candidate["visual_events"] = []
    candidate.pop("dialogue", None)
    value, _ = canonicalize_production_semantics(candidate, ctx)
    assert value["dialogue"][0]["delivery_mode"] == "quoted"
    assert value["dialogue"][0]["offscreen"] is True
    assert validate_production_semantics_output(value, ctx) == []

    text = _dialogue_text(
        value,
        ctx["shot"],
        {"characters": [{"character_id": "char_001", "canonical_name": "甲"}]},
    )
    assert text == "甲（画外转述）：“我回来了。”"


def test_dialogue_delivery_rejects_duplicate_or_out_of_range_override_indices():
    ctx = _context()
    candidate = _valid_candidate()
    candidate["dialogue_delivery"] = [
        {"dialogue_index": 0, "mode": "quoted"},
        {"dialogue_index": 0, "mode": "voiceover"},
        {"dialogue_index": 9, "mode": "direct"},
    ]
    candidate.pop("dialogue", None)
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_dialogue_delivery_duplicate" in kinds
    assert "production_semantics_dialogue_delivery_index_invalid" in kinds


def test_v1j_embedded_quote_is_program_extracted_model_selects_index_and_compiler_marks_outer_direct():
    from runtime.context_builder import _embedded_quote_candidates

    line = "半夜跑了。临走把钥匙塞给我，说‘周哥，帮我收着，我回来拿’。"
    candidates = _embedded_quote_candidates(line)
    assert candidates == [{"quote_index": 0, "text": "周哥，帮我收着，我回来拿"}]

    ctx = _context()
    ctx["shot"]["dialogue"] = [{"character_id": "char_001", "line": line}]
    ctx["program_owned"]["dialogue_pairs"] = [{
        "character_id": "char_001",
        "line": line,
        "embedded_quote_candidates": candidates,
    }]
    ctx["program_owned"]["current_shot_evidence"] = [
        "甲把信封放到桌上。",
        "走廊外传来脚步声。",
        line,
    ]

    candidate = _valid_candidate()
    candidate["dialogue_delivery"] = [{
        "dialogue_index": 0,
        "mode": "direct",
        "embedded_quote_indices": [0],
    }]
    candidate.pop("dialogue", None)
    value, _ = canonicalize_production_semantics(candidate, ctx)

    assert value["dialogue"][0] == {
        "character_id": "char_001",
        "line": line,
        "offscreen": False,
        "delivery_mode": "direct",
        "embedded_quotes": [{"text": "周哥，帮我收着，我回来拿", "mode": "quoted"}],
    }
    assert validate_production_semantics_output(value, ctx) == []

    text = _dialogue_text(
        value,
        ctx["shot"],
        {"characters": [{"character_id": "char_001", "canonical_name": "老周"}]},
    )
    assert text == f"老周（画内，含转述原话）：“{line}”"


def test_v1j_embedded_quote_selection_rejects_unknown_index_and_non_direct_mode():
    line = "他说‘明天见’。"
    ctx = _context()
    ctx["shot"]["dialogue"] = [{"character_id": "char_001", "line": line}]
    ctx["program_owned"]["dialogue_pairs"] = [{
        "character_id": "char_001",
        "line": line,
        "embedded_quote_candidates": [{"quote_index": 0, "text": "明天见"}],
    }]

    candidate = _valid_candidate()
    candidate.pop("dialogue", None)
    candidate["dialogue_delivery"] = [{
        "dialogue_index": 0,
        "mode": "quoted",
        "embedded_quote_indices": [0],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_embedded_quote_mode_invalid" in kinds

    candidate["dialogue_delivery"] = [{
        "dialogue_index": 0,
        "mode": "direct",
        "embedded_quote_indices": [9],
    }]
    value, _ = canonicalize_production_semantics(candidate, ctx)
    kinds = {item["type"] for item in validate_production_semantics_output(value, ctx)}
    assert "production_semantics_embedded_quote_index_invalid" in kinds

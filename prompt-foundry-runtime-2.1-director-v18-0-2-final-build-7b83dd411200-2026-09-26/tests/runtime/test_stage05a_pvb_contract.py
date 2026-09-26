from __future__ import annotations

import copy

import pytest

from runtime.stages.pvb import (
    CONTRACT_VERSION,
    SYSTEM_PROMPT,
    build_pvb_character_payload,
    canonicalize_pvb_character,
    validate_pvb_character_candidate,
    validate_pvb_character_model_output,
)


def _story_char() -> dict:
    return {
        "character_id": "char_001",
        "canonical_name": "阿宁",
        "role_type": "main",
        "visual_lock": {"face": "圆脸"},
    }


def _draft() -> dict:
    return {
        "visual_identity": {
            "age_appearance": "二十多岁",
            "face": "模型不应覆盖的脸",
            "hair": "黑色短发",
            "body": "中等身形",
            "skin": "自然肤色",
        },
        "wardrobe": {
            "default": "日常简洁衣着",
            "outerwear": "深色外套",
            "shirt": "浅色上衣",
            "footwear": "简洁鞋履",
            "accessory": "",
        },
    }


def test_pvb_payload_exposes_values_only_and_marks_all_metadata_program_owned():
    payload = build_pvb_character_payload(_story_char(), unit_id="pvb:char_001")
    assert payload["contract_version"] == CONTRACT_VERSION
    char = payload["output_template"]["character"]
    assert set(char) == {"visual_identity", "wardrobe"}
    assert all(isinstance(value, str) for value in char["visual_identity"].values())
    assert all(isinstance(value, str) for value in char["wardrobe"].values())
    assert set(payload["field_policy"]["story_owned_fields"]) == {"visual_identity.face"}
    assert payload["output_contract"]["program_owned_fields"] == [
        "character_id", "canonical_leaf.source", "canonical_leaf.status", "status", "version"
    ]
    assert "不要输出 character_id/source/status/version" in SYSTEM_PROMPT


def test_pvb_canonicalizer_builds_frozen_candidate_shape_without_model_metadata():
    value, changes = canonicalize_pvb_character(_story_char(), _draft())
    assert changes > 0
    assert value["character_id"] == "char_001"
    assert value["status"] == "candidate"
    assert value["version"] == 1
    assert value["visual_identity"]["face"] == {"value": "", "source": "", "status": "skipped"}
    assert value["visual_identity"]["hair"] == {"value": "黑色短发", "source": "production_design", "status": "candidate"}
    assert value["wardrobe"]["accessory"] == {"value": "", "source": "", "status": "optional_absent"}
    assert validate_pvb_character_candidate(_story_char(), value) == []


def test_pvb_model_output_rejects_unknown_fields_and_non_string_values():
    value = _draft()
    value["biography"] = "越权"
    value["visual_identity"]["hair"] = ["黑发"]
    value["wardrobe"]["hat"] = "帽子"
    errors = validate_pvb_character_model_output(value)
    kinds = {e["type"] for e in errors}
    assert "extra_pvb_model_field" in kinds
    assert "invalid_pvb_model_value" in kinds


def test_pvb_candidate_rejects_metadata_or_leaf_shape_tampering():
    value, _ = canonicalize_pvb_character(_story_char(), _draft())
    value["visual_identity"]["hair"]["status"] = "locked"
    value["wardrobe"]["accessory"] = {"value": "无明显配饰", "source": "production_design", "status": "candidate"}
    value["debug"] = True
    errors = validate_pvb_character_candidate(_story_char(), value)
    kinds = {e["type"] for e in errors}
    assert "invalid_pvb_candidate_metadata" in kinds
    assert "extra_pvb_candidate_field" in kinds
    assert "pseudo_content_accessory" in kinds


def test_pvb_payload_allows_low_role_when_runtime_determines_character_is_visually_required():
    char = _story_char()
    char["role_type"] = "background"
    payload = build_pvb_character_payload(char, unit_id="pvb:char_001")
    assert payload["story_character"]["role_type"] == "background"
    assert payload["unit_id"] == "pvb:char_001"


def test_pvb_legacy_model_metadata_is_discarded_and_runtime_rebuilds_authority():
    legacy = {
        "character_id": "model_wrong",
        "visual_identity": {
            "age_appearance": {"value": "二十多岁", "source": "story_bible", "status": "locked"},
            "face": {"value": "模型覆盖脸", "source": "production_design", "status": "locked"},
            "hair": {"value": "黑色短发", "source": "other", "status": "confirmed"},
            "body": {"value": "中等身形", "source": "other", "status": "locked"},
            "skin": {"value": "自然肤色", "source": "other", "status": "locked"},
        },
        "wardrobe": {
            "default": {"value": "日常简洁衣着", "source": "other", "status": "locked"},
            "outerwear": {"value": "深色外套", "source": "other", "status": "locked"},
            "shirt": {"value": "浅色上衣", "source": "other", "status": "locked"},
            "footwear": {"value": "简洁鞋履", "source": "other", "status": "locked"},
            "accessory": {"value": "", "source": "other", "status": "locked"},
        },
        "status": "locked",
        "version": 99,
    }
    assert validate_pvb_character_model_output(legacy) == []
    canonical, _ = canonicalize_pvb_character(_story_char(), legacy)
    assert canonical["character_id"] == "char_001"
    assert canonical["status"] == "candidate"
    assert canonical["version"] == 1
    assert canonical["visual_identity"]["face"] == {"value": "", "source": "", "status": "skipped"}
    assert canonical["visual_identity"]["hair"] == {"value": "黑色短发", "source": "production_design", "status": "candidate"}
    assert canonical["wardrobe"]["accessory"] == {"value": "", "source": "", "status": "optional_absent"}


def test_pvb_v3_1_rejects_all_empty_production_asset_when_story_has_no_usable_anchor():
    story = _story_char()
    story["visual_lock"] = {}
    draft = _draft()
    for section in ("visual_identity", "wardrobe"):
        for field in draft[section]:
            draft[section][field] = ""
    canonical, _ = canonicalize_pvb_character(story, draft)
    errors = validate_pvb_character_candidate(story, canonical)
    assert [e for e in errors if e.get("type") == "pvb_missing_identity_anchor"]


def test_pvb_v3_1_accepts_minimum_anchor_without_forcing_every_optional_field_nonempty():
    story = _story_char()
    story["visual_lock"] = {}
    draft = _draft()
    for section in ("visual_identity", "wardrobe"):
        for field in draft[section]:
            draft[section][field] = ""
    draft["visual_identity"]["hair"] = "黑色短发"
    canonical, _ = canonicalize_pvb_character(story, draft)
    errors = validate_pvb_character_candidate(story, canonical)
    assert not [e for e in errors if e.get("type") == "pvb_missing_identity_anchor"]
    assert canonical["wardrobe"]["accessory"]["status"] == "optional_absent"


def test_pvb_v3_1_does_not_treat_latin_only_story_lock_as_consumable_anchor():
    story = _story_char()
    story["visual_lock"] = {"face": "young adult face"}
    draft = _draft()
    for section in ("visual_identity", "wardrobe"):
        for field in draft[section]:
            draft[section][field] = ""
    canonical, _ = canonicalize_pvb_character(story, draft)
    errors = validate_pvb_character_candidate(story, canonical)
    assert [e for e in errors if e.get("type") == "pvb_missing_identity_anchor"]

from __future__ import annotations

import copy

from runtime.stages.story_bible import (
    build_story_bible_payload,
    canonicalize_story_bible,
    validate_story_bible_output,
)


def _candidate():
    return {
        "bible_id": "model_owned",
        "project_id": "model_owned",
        "version": 99,
        "characters": [
            {
                "character_id": "dup",
                "canonical_name": "阿宁",
                "aliases": [],
                "role_type": "main",
                "explicit_facts": ["阿宁站在窗边"],
                "inferred_facts": [],
                "identity_lock": {},
                "visual_lock": {},
                "source_evidence": [{"quote": "阿宁站在窗边"}],
            },
            {
                "character_id": "dup",
                "canonical_name": "老周",
                "aliases": [],
                "role_type": "supporting",
                "explicit_facts": ["老周走进房间"],
                "inferred_facts": [],
                "identity_lock": {},
                "visual_lock": {},
                "source_evidence": [{"quote": "老周走进房间"}],
            },
        ],
        "scenes": [
            {
                "scene_id": "bad",
                "canonical_name": "房间",
                "name": "房间",
                "time": "白天",
                "weather": "",
                "explicit_facts": [],
                "visual_lock": {},
                "source_evidence": [{"quote": "房间"}],
            }
        ],
        "props": [
            {
                "prop_id": "bad",
                "canonical_name": "信封",
                "name": "信封",
                "aliases": [],
                "narrative_importance": "medium",
                "visual_presence": "present",
                "visual_asset_required": True,
                "explicit_facts": [],
                "source_evidence": [{"quote": "信封"}],
            }
        ],
        "narrative_contexts": [
            {
                "context_id": "bad",
                "reality_status": "reality",
                "temporal_mode": "present",
                "representation_mode": "direct",
                "source_evidence": [{"quote": "阿宁站在窗边"}],
            }
        ],
    }


def test_story_bible_program_owns_metadata_and_all_stable_ids():
    normalized, changes = canonicalize_story_bible(_candidate(), run_id="run_abc123")
    assert changes > 0
    assert normalized["bible_id"] == "bible_abc123"
    assert normalized["project_id"] == "run_abc123"
    assert normalized["version"] == 1
    assert [x["character_id"] for x in normalized["characters"]] == ["char_001", "char_002"]
    assert [x["scene_id"] for x in normalized["scenes"]] == ["scene_001"]
    assert [x["prop_id"] for x in normalized["props"]] == ["prop_001"]
    assert [x["context_id"] for x in normalized["narrative_contexts"]] == ["context_001"]


def test_story_bible_payload_freezes_narrative_context_schema_and_marks_ids_program_owned():
    payload = build_story_bible_payload("阿宁站在窗边。", unit_id="story_bible")
    contract = payload["output_contract"]
    assert payload["contract_version"] == "story_bible.v14"
    assert "source_text" not in payload
    assert payload["source_index"] == [{"source_ref": "SRC0001", "text": "阿宁站在窗边。"}]
    assert "start" not in payload["source_index"][0] and "end" not in payload["source_index"][0]
    assert "character_id" in contract["program_owned_fields"]
    assert "scene_id" in contract["program_owned_fields"]
    assert "prop_id" in contract["program_owned_fields"]
    assert "context_id" in contract["program_owned_fields"]
    context_template = payload["output_template"]["narrative_contexts"][0]
    assert list(context_template) == [
        "context_id", "reality_status", "temporal_mode", "representation_mode", "source_evidence"
    ]


def test_story_bible_rejects_missing_required_scalar_and_bad_evidence_quote():
    source = "阿宁站在窗边。老周走进房间。桌上有一个信封。"
    value, _ = canonicalize_story_bible(_candidate(), run_id="run_abc123")
    value["characters"][0].pop("canonical_name")
    value["characters"][1]["source_evidence"] = [{"quote": "原文里不存在的句子"}]
    errors = validate_story_bible_output(value, source_text=source)
    types = {e["type"] for e in errors}
    assert "missing_story_bible_field" in types
    assert "evidence_quote_not_in_source" in types


def test_story_bible_rejects_incomplete_narrative_context_contract():
    source = "阿宁回忆起三年前的雨夜。"
    value, _ = canonicalize_story_bible(_candidate(), run_id="run_abc123")
    value["narrative_contexts"][0].pop("representation_mode")
    errors = validate_story_bible_output(value, source_text=source)
    assert any(
        e["type"] == "missing_story_bible_field" and e.get("field") == "representation_mode"
        for e in errors
    )


def test_story_bible_rejects_exact_duplicate_canonical_entities_after_program_id_assignment():
    source = "阿宁站在窗边。阿宁走到门口。"
    value = _candidate()
    value["characters"][1]["canonical_name"] = "阿宁"
    value["characters"][1]["source_evidence"] = [{"quote": "阿宁走到门口"}]
    normalized, _ = canonicalize_story_bible(value, run_id="run_dup")
    errors = validate_story_bible_output(normalized, source_text=source)
    assert any(e["type"] == "duplicate_story_entity" and e.get("entity_type") == "character" for e in errors)


def test_runtime_stage01_canonicalizes_model_ids_before_downstream_without_repair(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.api.fixtures.mock_story_run import MockModel

    class BadIdModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            value = super().generate_json(stage, system_prompt, user_payload)
            if stage == "story_bible":
                value = copy.deepcopy(value)
                value["bible_id"] = "whatever"
                value["project_id"] = "whatever"
                value["version"] = 999
                value["characters"][0]["character_id"] = "person-x"
                value["scenes"][0]["scene_id"] = "place-x"
                value["props"][0]["prop_id"] = "thing-x"
            return value

    model = BadIdModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="Stage 1 wiring")
    assert run["status"] == "completed"
    story = run["artifacts"]["story_bible"]
    assert story["project_id"] == run["run_id"]
    assert story["bible_id"] == f"bible_{run['run_id'][4:]}"
    assert story["characters"][0]["character_id"] == "char_001"
    assert story["scenes"][0]["scene_id"] == "scene_001"
    assert story["props"][0]["prop_id"] == "prop_001"
    assert run["units"]["story_bible"]["repair_count"] == 0


def test_story_bible_v4_rejects_undeclared_entity_and_evidence_fields():
    source = "阿宁站在窗边。老周走进房间。桌上有一个信封。"
    value, _ = canonicalize_story_bible(_candidate(), run_id="run_exact")
    value["characters"][0]["mood"] = "平静"
    value["characters"][0]["source_evidence"][0]["confidence"] = 0.9
    errors = validate_story_bible_output(value, source_text=source)
    extras = [e for e in errors if e["type"] == "extra_story_bible_field"]
    assert any(e.get("field") == "mood" for e in extras)
    assert any("source_evidence[0]" in e.get("path", "") for e in extras)

from __future__ import annotations

from runtime.stages.style_guide import (
    CONTRACT_VERSION,
    SYSTEM_PROMPT,
    build_style_guide_payload,
    canonicalize_style_guide,
    validate_style_guide_candidate,
    validate_style_guide_model_output,
)


def _story() -> dict:
    return {
        "bible_id": "bible_run",
        "project_id": "run",
        "version": 1,
        "characters": [],
        "scenes": [],
        "props": [],
        "narrative_contexts": [],
    }


def _draft() -> dict:
    return {
        "era": "当代",
        "region": "中国城市生活语境",
        "genre": "现实主义都市剧情",
        "tone": "克制、自然、生活化",
        "visual_reference": "写实真人影视质感，真实材质与自然光比",
    }


def test_style_payload_uses_source_and_story_without_reference_manifest_and_model_owns_values_only():
    payload = build_style_guide_payload("原文", _story(), unit_id="style_guide")
    assert payload["contract_version"] == CONTRACT_VERSION
    assert payload["source_text"] == "原文"
    assert payload["story_bible"] == _story()
    assert "reference_manifest" not in payload
    assert payload["output_template"] == _draft() | {
        "era": "", "region": "", "genre": "", "tone": "", "visual_reference": ""
    }
    assert payload["output_contract"]["program_owned_fields"] == ["*.source", "*.status"]
    assert "不要输出 source/status" in SYSTEM_PROMPT


def test_style_canonicalizer_builds_candidate_metadata_from_values_only():
    value, changes = canonicalize_style_guide(_draft())
    assert changes > 0
    assert value["era"] == {"value": "当代", "source": "production_design", "status": "candidate"}
    assert value["visual_reference"]["status"] == "candidate"
    assert validate_style_guide_candidate(value) == []


def test_style_model_output_rejects_missing_extra_non_string_or_blank_values():
    value = _draft()
    value.pop("region")
    value["tone"] = ["克制"]
    value["genre"] = "   "
    value["lighting"] = "夜景"
    errors = validate_style_guide_model_output(value)
    kinds = {e["type"] for e in errors}
    assert "missing_style_model_field" in kinds
    assert "extra_style_model_field" in kinds
    assert "invalid_style_model_value" in kinds
    assert "blank_style_candidate_value" in kinds


def test_style_legacy_leaf_metadata_is_ignored_and_rebuilt():
    legacy = {
        key: {"value": val, "source": "story_bible", "status": "locked"}
        for key, val in _draft().items()
    }
    assert validate_style_guide_model_output(legacy) == []
    canonical, _ = canonicalize_style_guide(legacy)
    assert canonical["tone"] == {
        "value": "克制、自然、生活化", "source": "production_design", "status": "candidate"
    }


def test_style_candidate_rejects_metadata_tampering_or_unknown_fields():
    value, _ = canonicalize_style_guide(_draft())
    value["era"]["status"] = "locked"
    value["tone"]["source"] = "model"
    value["debug"] = {"value": "x", "source": "production_design", "status": "candidate"}
    errors = validate_style_guide_candidate(value)
    kinds = {e["type"] for e in errors}
    assert "invalid_style_candidate_metadata" in kinds
    assert "extra_style_candidate_field" in kinds


def test_runtime_wires_values_only_style_without_repair(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_unitization import MultiUnitModel

    class ValuesOnlyStyleModel(MultiUnitModel):
        def generate_json(self, stage, system_prompt, payload):
            if stage == "style_guide":
                return {
                    "era": "当代",
                    "region": "中国城市生活语境",
                    "genre": "现实主义都市剧情",
                    "tone": "克制、自然、生活化",
                    "visual_reference": "写实真人影视质感",
                }
            return super().generate_json(stage, system_prompt, payload)

    model = ValuesOnlyStyleModel()
    run = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    ).start("甲在房间。乙在走廊。", "Style Stage05C wiring")

    assert run["status"] == "completed"
    candidate = run["artifacts"]["style_guide_candidate"]
    assert candidate["era"] == {"value": "当代", "source": "production_design", "status": "candidate"}
    assert run["units"]["style_guide"]["repair_count"] == 0


def test_runtime_repair_contract_targets_blank_style_fields_without_blank_template_anchor(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_unitization import MultiUnitModel

    class BlankThenRepairStyleModel(MultiUnitModel):
        def generate_json(self, stage, system_prompt, payload):
            if stage != "style_guide":
                return super().generate_json(stage, system_prompt, payload)
            repair = payload.get("repair_instruction") or {}
            if not repair:
                return {
                    "era": "当代",
                    "region": "未限定",
                    "genre": "",
                    "tone": "克制写实",
                    "visual_reference": "",
                }
            expected = {"genre", "visual_reference"}
            assert set(repair.get("repair_targets") or []) == expected
            assert set(repair.get("must_be_nonempty_paths") or []) == expected
            assert "output_template" not in payload
            assert "TARGETED REPAIR EXECUTION CONTRACT" in system_prompt
            invalid = dict(repair.get("invalid_output") or {})
            invalid["genre"] = "现实主义剧情"
            invalid["visual_reference"] = "写实真人影视质感"
            return invalid

    run = RuntimeV20(
        model=BlankThenRepairStyleModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    ).start("甲在房间。乙在走廊。", "Style targeted blank repair")

    assert run["status"] == "completed"
    assert run["units"]["style_guide"]["repair_count"] == 1
    assert run["artifacts"]["style_guide_candidate"]["genre"]["value"] == "现实主义剧情"
    assert run["artifacts"]["style_guide_candidate"]["visual_reference"]["value"] == "写实真人影视质感"

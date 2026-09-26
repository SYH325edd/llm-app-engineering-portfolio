from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from runtime.stages.story_bible import (
    canonicalize_story_bible,
    sanitize_unproven_identity_attributes,
    sanitize_unverifiable_explicit_facts,
    validate_story_bible_output,
)
from tests.api.fixtures.mock_story_run import MockModel, RESPONSES


def test_hard_fact_not_supported_error_exposes_exact_repair_target_for_visual_lock():
    source = "阿宁站在窗边。"
    candidate = {
        "characters": [{
            "canonical_name": "阿宁", "aliases": [], "role_type": "main",
            "explicit_facts": [], "inferred_facts": [],
            "identity_lock": {}, "visual_lock": {"hair": "银白色长发"},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["visual_lock.hair"]}],
        }],
        "scenes": [{
            "canonical_name": "未明确空间", "name": "未明确空间", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_target", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    error = next(e for e in errors if e["type"] == "story_bible_fact_not_supported")

    assert error["path"] == "characters[0]"
    assert error["evidence_index"] == 0
    assert error["evidence_path"] == "characters[0].source_evidence[0]"
    assert error["support_path"] == "visual_lock.hair"
    assert error["target_path"] == "characters[0].visual_lock.hair"
    assert error["source_refs"] == ["SRC0001"]
    assert "source_refs" in error["repair_action"]
    assert "support_path" in error["repair_action"]


def test_story_bible_runtime_drops_unverifiable_optional_explicit_fact_without_repair(tmp_path):
    class HallucinatedSummaryModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            if stage != "story_bible":
                return super().generate_json(stage, system_prompt, user_payload)
            self.calls.append(stage)
            value = copy.deepcopy(RESPONSES["story_bible"])
            value["characters"][0]["explicit_facts"].append("阿宁是总统")
            value["characters"][0]["source_evidence"][0]["supports"].append("explicit_facts[1]")
            return value

    runtime = RuntimeV20(
        model=HallucinatedSummaryModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="optional fact quarantine")

    assert run["status"] == "completed"
    assert run["units"]["story_bible"]["repair_count"] == 0
    facts = run["artifacts"]["story_bible"]["characters"][0]["explicit_facts"]
    assert "阿宁是总统" not in facts
    warning_types = {w["type"] for w in run["units"]["story_bible"].get("quality_warnings") or []}
    assert "story_bible_unverifiable_explicit_fact_dropped" in warning_types


def test_scene_visual_lock_environment_rejects_synthesized_location_but_accepts_source_faithful_leaf():
    source = "她路过那间旧书店，现在是家咖啡店，灯亮着。"
    candidate = {
        "characters": [],
        "scenes": [{
            "canonical_name": "街区",
            "name": "街区",
            "time": "",
            "weather": "",
            "explicit_facts": [],
            "visual_lock": {"environment": "主街路口，附近有旧书店（现为咖啡店）"},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["visual_lock.environment"]}],
        }],
        "props": [],
        "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_spatial", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    error = next(e for e in errors if e["type"] == "story_bible_fact_not_supported")
    assert error["target_path"] == "scenes[0].visual_lock.environment"
    assert "smallest contiguous source window" in error["repair_action"]
    assert "distant/noncontiguous evidence" in error["repair_action"]

    candidate["scenes"][0]["visual_lock"]["environment"] = "旧书店现为咖啡店"
    repaired, _ = canonicalize_story_bible(candidate, run_id="run_spatial", source_text=source)
    repaired_errors = validate_story_bible_output(repaired, source_text=source, require_fact_provenance=True)
    assert not [e for e in repaired_errors if e["type"] == "story_bible_fact_not_supported"]


def test_story_bible_auto_expands_smallest_contiguous_evidence_window_for_ellipsis():
    source = '年轻人指着钥匙。\n老周没抬头。\n“柜子的。”'
    candidate = {
        "characters": [{
            "canonical_name": "老周", "aliases": [], "role_type": "main",
            "explicit_facts": ["老周说钥匙是柜子的。"], "inferred_facts": [],
            "identity_lock": {}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0003"], "supports": ["explicit_facts[0]"]}],
        }],
        "scenes": [{
            "canonical_name": "未明确空间", "name": "未明确空间", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }

    value, _ = canonicalize_story_bible(candidate, run_id="run_ellipsis", source_text=source)
    evidence = value["characters"][0]["source_evidence"][0]

    assert evidence["source_refs"] == ["SRC0001", "SRC0002", "SRC0003"]
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    assert not [error for error in errors if error["type"] == "story_bible_fact_not_supported"]


def test_story_bible_same_invalid_hard_repair_is_reported_as_no_effect(tmp_path):
    class NoEffectRepairModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            if stage != "story_bible":
                return super().generate_json(stage, system_prompt, user_payload)
            self.calls.append(stage)
            value = copy.deepcopy(RESPONSES["story_bible"])
            value["characters"][0]["visual_lock"]["hair"] = "银白色长发"
            value["characters"][0]["source_evidence"][0]["supports"].append("visual_lock.hair")
            return value

    runtime = RuntimeV20(
        model=NoEffectRepairModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="no effect hard repair")

    assert run["status"] == "paused"
    errors = run["units"]["story_bible"]["attempts"][-1]["errors"]
    assert any(error["type"] == "story_bible_fact_not_supported" for error in errors)
    no_effect = next(error for error in errors if error["type"] == "repair_no_effect")
    assert "characters[0].visual_lock.hair" in no_effect["repair_targets"]



def test_identity_lock_normalized_attribute_keeps_hard_provenance_but_lexical_gap_is_soft():
    source = "她在医院给病人看诊已经十年。"
    candidate = {
        "characters": [{
            "canonical_name": "她", "aliases": [], "role_type": "main",
            "explicit_facts": [], "inferred_facts": [],
            "identity_lock": {"occupation": "医生"}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["identity_lock.occupation"]}],
        }],
        "scenes": [{
            "canonical_name": "医院", "name": "医院", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_identity", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)

    assert not [e for e in errors if e["type"] == "story_bible_fact_not_supported"]
    warning = next(e for e in errors if e["type"] == "story_bible_identity_lock_weak_lexical_anchor")
    assert warning["support_path"] == "identity_lock.occupation"
    assert warning["source_refs"] == ["SRC0001"]


def test_identity_lock_still_requires_real_provenance_binding():
    source = "她在医院给病人看诊已经十年。"
    candidate = {
        "characters": [{
            "canonical_name": "她", "aliases": [], "role_type": "main",
            "explicit_facts": [], "inferred_facts": [],
            "identity_lock": {"occupation": "医生"}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "scenes": [{
            "canonical_name": "医院", "name": "医院", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_identity_missing", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)

    missing = next(e for e in errors if e["type"] == "story_bible_fact_provenance_missing")
    assert "identity_lock.occupation" in missing["missing_supports"]


def test_explicit_fact_weak_paraphrase_is_soft_and_runtime_sanitizer_drops_it():
    source = "阿宁站在窗边。"
    candidate = {
        "characters": [{
            "canonical_name": "阿宁", "aliases": [], "role_type": "main",
            "explicit_facts": ["阿宁是总统"], "inferred_facts": [],
            "identity_lock": {}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["explicit_facts[0]"]}],
        }],
        "scenes": [{
            "canonical_name": "未明确空间", "name": "未明确空间", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_explicit_guard", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    assert not [e for e in errors if e["type"] == "story_bible_fact_not_supported"]
    assert any(e["type"] == "story_bible_explicit_fact_weak_lexical_anchor" for e in errors)
    sanitized, warnings, _ = sanitize_unverifiable_explicit_facts(value)
    assert sanitized["characters"][0]["explicit_facts"] == []
    assert warnings[0]["type"] == "story_bible_unverifiable_explicit_fact_dropped"



def test_dialogue_paraphrase_summary_is_quarantined_instead_of_pausing_story_bible():
    source = '年轻人看向老周。\n“您家里的？”\n老周没答话。'
    candidate = {
        "characters": [{
            "canonical_name": "年轻人", "aliases": [], "role_type": "supporting",
            "explicit_facts": ["年轻人问老周是不是他家里的。"], "inferred_facts": [],
            "identity_lock": {}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0002", "SRC0003"], "supports": ["explicit_facts[0]"]}],
        }],
        "scenes": [{
            "canonical_name": "未明确空间", "name": "未明确空间", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_dialogue_summary", source_text=source)
    sanitized, warnings, _ = sanitize_unverifiable_explicit_facts(value)
    errors = validate_story_bible_output(sanitized, source_text=source, require_fact_provenance=True)

    assert sanitized["characters"][0]["explicit_facts"] == []
    assert any(w["type"] == "story_bible_unverifiable_explicit_fact_dropped" for w in warnings)
    assert not [e for e in errors if e["type"] == "story_bible_fact_not_supported"]


def test_story_bible_authority_manifest_keeps_identity_lock_as_source_derived_attribute():
    from runtime.authority_contract import authority_manifest

    policy = authority_manifest("story_bible")["*.identity_lock.*"]
    assert policy["mode"] == "source_derived_attribute"
    assert policy["hard_verifiable"] is False


def test_unproven_optional_identity_attribute_is_quarantined_before_runtime_gate():
    source = "她在医院给病人看诊已经十年。"
    candidate = {
        "characters": [{
            "canonical_name": "她", "aliases": [], "role_type": "main",
            "explicit_facts": [], "inferred_facts": [],
            "identity_lock": {"occupation": "医生", "age": "中年"}, "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": ["identity_lock.occupation"]}],
        }],
        "scenes": [{
            "canonical_name": "医院", "name": "医院", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_identity_quarantine", source_text=source)
    sanitized, warnings, changes = sanitize_unproven_identity_attributes(value)
    errors = validate_story_bible_output(sanitized, source_text=source, require_fact_provenance=True)

    assert changes == 1
    assert sanitized["characters"][0]["identity_lock"] == {"occupation": "医生"}
    assert any(w["type"] == "story_bible_unproven_identity_attribute_dropped" for w in warnings)
    assert not [e for e in errors if e["type"] == "story_bible_fact_provenance_missing"]


def test_story_bible_runtime_quarantines_missing_identity_support_without_repair(tmp_path):
    class MissingIdentitySupportModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            if stage != "story_bible":
                return super().generate_json(stage, system_prompt, user_payload)
            self.calls.append(stage)
            value = copy.deepcopy(RESPONSES["story_bible"])
            value["characters"][0]["identity_lock"] = {"age": "年轻成年人"}
            # Deliberately omit identity_lock.age from every supports array.
            return value

    runtime = RuntimeV20(
        model=MissingIdentitySupportModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="identity provenance quarantine")

    assert run["status"] == "completed"
    assert run["units"]["story_bible"]["repair_count"] == 0
    assert run["artifacts"]["story_bible"]["characters"][0]["identity_lock"] == {}
    warning_types = {w["type"] for w in run["units"]["story_bible"].get("quality_warnings") or []}
    assert "story_bible_unproven_identity_attribute_dropped" in warning_types


def test_scene_composite_visual_lock_accepts_union_of_atomic_local_evidence():
    source = "室内有咖啡香。\n傍晚的斜光照进门口。\n旧书店现在是咖啡店，灯亮着。"
    candidate = {
        "characters": [],
        "scenes": [{
            "canonical_name": "街区", "name": "街区", "time": "", "weather": "",
            "explicit_facts": [],
            "visual_lock": {"environment": "室内有咖啡香；傍晚的斜光照进门口；旧书店现在是咖啡店，灯亮着"},
            "source_evidence": [
                {"source_refs": ["SRC0001"], "supports": ["visual_lock.environment"]},
                {"source_refs": ["SRC0002"], "supports": ["visual_lock.environment"]},
                {"source_refs": ["SRC0003"], "supports": ["visual_lock.environment"]},
            ],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_atomic_visual", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    assert not [e for e in errors if e["type"] == "story_bible_fact_not_supported"]


def test_scene_composite_visual_lock_reports_only_uncovered_atomic_clause():
    source = "室内有咖啡香。\n傍晚的斜光照进门口。"
    candidate = {
        "characters": [],
        "scenes": [{
            "canonical_name": "街区", "name": "街区", "time": "", "weather": "",
            "explicit_facts": [],
            "visual_lock": {"environment": "室内有咖啡香；傍晚的斜光照进门口；窗外停着一辆蓝色巴士"},
            "source_evidence": [
                {"source_refs": ["SRC0001"], "supports": ["visual_lock.environment"]},
                {"source_refs": ["SRC0002"], "supports": ["visual_lock.environment"]},
            ],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_atomic_visual_missing", source_text=source)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    error = next(e for e in errors if e["type"] == "story_bible_fact_not_supported")
    assert error["support_path"] == "visual_lock.environment"
    assert error["unsupported_atoms"] == ["窗外停着一辆蓝色巴士"]


def test_story_bible_infers_multiple_evidence_bindings_for_composite_visual_lock():
    source = "墙面是粗糙水泥。\n门口挂着旧木牌。"
    candidate = {
        "characters": [],
        "scenes": [{
            "canonical_name": "门店", "name": "门店", "time": "", "weather": "",
            "explicit_facts": [],
            "visual_lock": {"materials": "粗糙水泥墙面；门口旧木牌"},
            "source_evidence": [
                {"source_refs": ["SRC0001"], "supports": []},
                {"source_refs": ["SRC0002"], "supports": []},
            ],
        }],
        "props": [], "narrative_contexts": [],
    }
    value, _ = canonicalize_story_bible(candidate, run_id="run_atomic_visual_infer", source_text=source)
    supports = [set(ev.get("supports") or []) for ev in value["scenes"][0]["source_evidence"]]
    assert all("visual_lock.materials" in row for row in supports)
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    assert not [e for e in errors if e["type"] in {"story_bible_fact_provenance_missing", "story_bible_fact_not_supported"}]


def test_story_bible_canonicalization_prunes_dangling_support_paths_without_repair():
    source = "阿宁站在窗边。"
    candidate = {
        "characters": [{
            "canonical_name": "阿宁", "aliases": [], "role_type": "main",
            "explicit_facts": ["阿宁站在窗边。"], "inferred_facts": [],
            "identity_lock": {}, "visual_lock": {},
            "source_evidence": [
                {"source_refs": ["SRC0001"], "supports": ["explicit_facts[27]"]},
                {"source_refs": ["SRC0001"], "supports": ["explicit_facts[28]"]},
            ],
        }],
        "scenes": [{
            "canonical_name": "未明确空间", "name": "未明确空间", "time": "", "weather": "",
            "explicit_facts": [], "visual_lock": {},
            "source_evidence": [{"source_refs": ["SRC0001"], "supports": []}],
        }],
        "props": [], "narrative_contexts": [],
    }

    value, changes = canonicalize_story_bible(candidate, run_id="run_dangling_support", source_text=source)
    character = value["characters"][0]

    assert changes > 0
    assert all(
        "explicit_facts[27]" not in (ev.get("supports") or [])
        and "explicit_facts[28]" not in (ev.get("supports") or [])
        for ev in character["source_evidence"]
    )
    # Existing provenance may be deterministically rebound to the real fact it proves.
    assert any("explicit_facts[0]" in (ev.get("supports") or []) for ev in character["source_evidence"])
    errors = validate_story_bible_output(value, source_text=source, require_fact_provenance=True)
    assert not [e for e in errors if e["type"] == "story_bible_invalid_support_path"]


def test_story_bible_runtime_dangling_support_pointer_is_self_healed_without_model_repair(tmp_path):
    class DanglingSupportModel(MockModel):
        def generate_json(self, stage, system_prompt, user_payload):
            if stage != "story_bible":
                return super().generate_json(stage, system_prompt, user_payload)
            self.calls.append(stage)
            value = copy.deepcopy(RESPONSES["story_bible"])
            value["characters"][0]["source_evidence"].append({
                "source_refs": ["SRC0001"],
                "supports": ["explicit_facts[27]", "explicit_facts[28]"],
            })
            return value

    model = DanglingSupportModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )
    run = runtime.start("阿宁站在窗边，手里拿着信封。", title="dangling support pointer hygiene")

    assert run["status"] == "completed"
    assert run["units"]["story_bible"]["repair_count"] == 0
    assert model.calls.count("story_bible") == 1
    errors = [
        error
        for attempt in run["units"]["story_bible"].get("attempts") or []
        for error in attempt.get("errors") or []
    ]
    assert not [e for e in errors if e.get("type") == "story_bible_invalid_support_path"]
    assert not [e for e in errors if e.get("type") == "repair_no_effect"]

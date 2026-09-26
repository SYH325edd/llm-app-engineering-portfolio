from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from tests.api.fixtures.mock_story_run import MockModel, RESPONSES


def _runtime(tmp_path, model):
    return RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
    )


class RecoveringScenePlanModel(MockModel):
    def __init__(self):
        super().__init__()
        self.scene_plan_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "scene_plan":
            self.calls.append(stage)
            self.scene_plan_attempts += 1
            if self.scene_plan_attempts == 1:
                bad = copy.deepcopy(RESPONSES["scene_plan"])
                bad["scenes"][0]["context_ref"] = "context_001, context_002"
                return bad
            repair = payload.get("repair_instruction") or {}
            assert repair.get("mode") == "repair_current_unit_only"
            assert repair.get("validation_errors")
            assert repair.get("invalid_output")
            return copy.deepcopy(RESPONSES["scene_plan"])
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_repairs_scene_plan_unit_once_without_restarting_run(tmp_path):
    model = RecoveringScenePlanModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "恢复测试")
    assert run["status"] == "completed"
    assert model.scene_plan_attempts == 2
    unit = run["units"]["scene_plan"]
    assert unit["repair_count"] == 1
    assert unit["attempts"][0]["status"] == "validation_failed"
    assert unit["attempts"][1]["status"] == "passed"


class NeverRepairsScenePlanModel(MockModel):
    def __init__(self):
        super().__init__()
        self.scene_plan_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "scene_plan":
            self.calls.append(stage)
            self.scene_plan_attempts += 1
            bad = copy.deepcopy(RESPONSES["scene_plan"])
            bad["scenes"][0]["context_ref"] = "context_001, context_002"
            return bad
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_pauses_only_failed_unit_after_one_repair(tmp_path):
    model = NeverRepairsScenePlanModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "失败隔离")
    assert run["status"] == "paused"
    assert model.scene_plan_attempts == 2
    assert run["error"]["unit_id"] == "scene_plan"
    assert run["units"]["story_bible"]["status"] == "completed"
    assert run["units"]["scene_plan"]["status"] == "failed_recoverable"


class RecoveringDirectorShapeModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot":
            self.calls.append(stage)
            self.director_attempts += 1
            value = super().generate_json(stage, system_prompt, payload)
            # super() already recorded the call; keep call-count semantics irrelevant here.
            if self.director_attempts == 1:
                bad = copy.deepcopy(value)
                bad["director"]["visual_focus"]["body_regions"] = ["hands"]
                return bad
            repair = payload.get("repair_instruction") or {}
            assert any(e.get("type", "").startswith("shape_") for e in repair.get("validation_errors", []))
            return value
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_shape_gate_repairs_one_director_shot(tmp_path):
    model = RecoveringDirectorShapeModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Director Shape")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 1
    assert unit["attempts"][0]["status"] == "validation_failed"


class BadDirectorRelationsModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot":
            value = super().generate_json(stage, system_prompt, payload)
            d = value["director"]
            d["speaker_target_refs"] = []  # program-owned field: ignored/overwritten
            # A known current-shot prop is now deterministically removable from
            # primary_subject_refs. Use a truly unknown ref here to keep asserting
            # that the runtime never guesses or silently drops unsupported refs.
            d["primary_subject_refs"] = ["char_missing"]
            return value
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_does_not_silently_rewrite_unknown_model_owned_director_ref(tmp_path):
    model = BadDirectorRelationsModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Director 关系")
    assert run["status"] == "paused"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 1
    errors = unit["attempts"][-1]["errors"]
    assert any(e["type"] == "invalid_primary_subject_ref" for e in errors)
    assert all(e.get("invalid_ref") in {None, "char_missing"} for e in errors if e["type"] == "invalid_primary_subject_ref")


class ExplodingStoryboardModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "storyboard_scene":
            raise RuntimeError("provider exploded during storyboard")
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_persists_model_call_failure_in_unit_attempt_history(tmp_path):
    run = _runtime(tmp_path, ExplodingStoryboardModel()).start("阿宁站在窗边，手里拿着信封。", "模型调用失败记录")
    assert run["status"] == "paused"
    unit = run["units"]["storyboard:SC001"]
    assert unit["status"] == "failed_recoverable"
    assert unit["attempts"]
    assert unit["attempts"][-1]["status"] == "model_failed"
    assert "provider exploded during storyboard" in unit["attempts"][-1]["error"]


class FailOnceStoryboardModel(MockModel):
    def __init__(self):
        super().__init__()
        self.storyboard_failures = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "storyboard_scene" and self.storyboard_failures == 0:
            self.storyboard_failures += 1
            raise RuntimeError("temporary storyboard provider failure")
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_keeps_failure_history_after_successful_resume(tmp_path):
    model = FailOnceStoryboardModel()
    runtime = _runtime(tmp_path, model)
    paused = runtime.start("阿宁站在窗边，手里拿着信封。", "失败历史保留")
    assert paused["status"] == "paused"
    assert paused.get("failure_history")
    first = paused["failure_history"][-1]
    assert first["unit_id"] == "storyboard:SC001"
    assert "temporary storyboard provider failure" in first["message"]
    assert first["attempts"][-1]["status"] == "model_failed"

    resumed = runtime.resume(paused["run_id"])
    assert resumed["status"] == "completed"
    assert resumed.get("failure_history")
    assert "temporary storyboard provider failure" in resumed["failure_history"][-1]["message"]


class RepairingStoryboardPropByIndexModel(MockModel):
    def __init__(self):
        super().__init__()
        self.storyboard_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage != "storyboard_scene":
            return super().generate_json(stage, system_prompt, payload)
        self.calls.append(stage)
        self.storyboard_attempts += 1
        value = {"scene": copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])}
        # Model-owned raw output deliberately omits program-owned IDs, matching the real contract.
        for shot in value["scene"]["shots"]:
            shot.pop("shot_id", None)
            shot.pop("scene_id", None)
        if self.storyboard_attempts == 1:
            value["scene"]["shots"][0]["prop_refs"] = []
            return value
        repair = payload.get("repair_instruction") or {}
        errors = repair.get("validation_errors") or []
        missing = next(e for e in errors if e.get("type") == "storyboard_missing_visible_prop_ref")
        assert missing["shot_index"] == 0
        assert missing["beat_id"] == "B001"
        assert missing["prop_ref"] == "prop_001"
        raw = copy.deepcopy(repair["invalid_output"])
        raw["scene"]["shots"][missing["shot_index"]]["prop_refs"].append(missing["prop_ref"])
        return raw


def test_runtime_storyboard_prop_repair_can_locate_raw_shot_by_index_without_program_owned_shot_id(tmp_path):
    model = RepairingStoryboardPropByIndexModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Storyboard prop repair index")
    assert run["status"] == "completed"
    assert model.storyboard_attempts == 2
    unit = run["units"]["storyboard:SC001"]
    assert unit["repair_count"] == 1
    assert unit["attempts"][0]["status"] == "validation_failed"
    assert unit["attempts"][1]["status"] == "passed"

class NeverRepairsStoryboardQualityModel(MockModel):
    def __init__(self):
        super().__init__()
        self.storyboard_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage != "storyboard_scene":
            return super().generate_json(stage, system_prompt, payload)
        self.calls.append(stage)
        self.storyboard_attempts += 1
        value = {"scene": copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])}
        for shot in value["scene"]["shots"]:
            shot.pop("shot_id", None)
            shot.pop("scene_id", None)
        value["scene"]["shots"][0]["description"] = "阿宁站在窗边，手里拿着信封，持续找了一个小时。"
        return value


def test_storyboard_quality_issue_warns_without_triggering_model_repair(tmp_path):
    model = NeverRepairsStoryboardQualityModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Storyboard quality soft gate")
    assert run["status"] == "completed"
    assert model.storyboard_attempts == 1
    unit = run["units"]["storyboard:SC001"]
    assert unit["status"] == "completed"
    assert unit["repair_count"] == 0
    warnings = unit.get("quality_warnings") or []
    assert any(w.get("type") == "storyboard_non_atomic_time_window" for w in warnings)
    assert any(w.get("unit_id") == "storyboard:SC001" for w in (run.get("quality_warnings") or []))
    compiled = next(x for x in run["artifacts"]["compiled_project"]["shot_prompts"] if x.get("shot_id") == "SH001")
    assert compiled["compile_status"] != "blocked"
    assert not any(w.get("code") == "W010_NON_ATOMIC_TIME_WINDOW" for w in compiled.get("warnings", []))


class NeverRepairsStoryboardHardErrorModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage != "storyboard_scene":
            return super().generate_json(stage, system_prompt, payload)
        value = {"scene": copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])}
        for shot in value["scene"]["shots"]:
            shot.pop("shot_id", None)
            shot.pop("scene_id", None)
        value["scene"]["shots"][0]["prop_refs"] = []
        return value


def test_storyboard_hard_binding_error_still_pauses_after_repair_exhausted(tmp_path):
    run = _runtime(tmp_path, NeverRepairsStoryboardHardErrorModel()).start("阿宁站在窗边，手里拿着信封。", "Storyboard hard gate")
    assert run["status"] == "paused"
    unit = run["units"]["storyboard:SC001"]
    assert unit["status"] == "failed_recoverable"
    assert any(e.get("type") == "storyboard_missing_visible_prop_ref" for e in unit["attempts"][-1]["errors"])


def test_retry_clears_stale_storyboard_quality_warnings_before_rebuild(tmp_path):
    model = NeverRepairsStoryboardQualityModel()
    rt = _runtime(tmp_path, model)
    run = rt.start("阿宁站在窗边，手里拿着信封。", "warning lifecycle")
    assert any(w.get("stage") == "storyboard" for w in run.get("quality_warnings") or [])
    stored = rt.store.get(run["run_id"])
    rt._invalidate_from(stored, "storyboard:SC001")
    assert not [w for w in (stored.get("quality_warnings") or []) if w.get("stage") == "storyboard"]


def test_reused_storyboard_checkpoint_restores_run_level_quality_warnings(tmp_path):
    model = NeverRepairsStoryboardQualityModel()
    rt = _runtime(tmp_path, model)
    run = rt.start("阿宁站在窗边，手里拿着信封。", "warning reuse")
    assert run["status"] == "completed"
    stored = rt.store.get(run["run_id"])
    stored["quality_warnings"] = []
    # Force orchestration to revisit Storyboard while keeping its completed checkpoint reusable.
    for key in ["storyboard_base", "storyboard", "shot_specs", "compiled_project", "legacy_compiled_project", "static_evaluation", "consumption_evaluation"]:
        stored.get("artifacts", {}).pop(key, None)
    stored["status"] = "pending"
    rt.store.save(stored)
    resumed = rt.execute(run["run_id"])
    assert any(w.get("unit_id") == "storyboard:SC001" for w in resumed.get("quality_warnings") or [])

class MixedHardAndQualityStoryboardModel(MockModel):
    def __init__(self):
        super().__init__()
        self.storyboard_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage != "storyboard_scene":
            return super().generate_json(stage, system_prompt, payload)
        self.calls.append(stage)
        self.storyboard_attempts += 1
        if self.storyboard_attempts == 1:
            value = {"scene": copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])}
            for shot in value["scene"]["shots"]:
                shot.pop("shot_id", None)
                shot.pop("scene_id", None)
            value["scene"]["shots"][0]["prop_refs"] = []
            value["scene"]["shots"][0]["description"] = "阿宁持续找了一个小时，手里仍拿着信封。"
            return value
        repair = payload.get("repair_instruction") or {}
        errors = repair.get("validation_errors") or []
        assert errors
        assert all(e.get("type") != "storyboard_non_atomic_time_window" for e in errors)
        missing = next(e for e in errors if e.get("type") == "storyboard_missing_visible_prop_ref")
        raw = copy.deepcopy(repair["invalid_output"])
        raw["scene"]["shots"][missing["shot_index"]]["prop_refs"].append(missing["prop_ref"])
        return raw


def test_storyboard_repair_targets_only_hard_errors_and_preserves_quality_issue_as_warning(tmp_path):
    model = MixedHardAndQualityStoryboardModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "mixed gate")
    assert run["status"] == "completed"
    assert model.storyboard_attempts == 2
    unit = run["units"]["storyboard:SC001"]
    assert unit["repair_count"] == 1
    assert any(w.get("type") == "storyboard_non_atomic_time_window" for w in unit.get("quality_warnings") or [])


class LowOverlapScenePlanSummaryModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "scene_plan":
            self.calls.append(stage)
            value = copy.deepcopy(RESPONSES["scene_plan"])
            value["scenes"][0]["beat_list"][0]["description"] = "她在原地维持当前状态，手中的纸质物件保持不变。"
            return value
        return super().generate_json(stage, system_prompt, payload)


def test_scene_plan_semantic_summary_low_overlap_is_warning_not_pause(tmp_path):
    model = LowOverlapScenePlanSummaryModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Scene Plan authority separation")
    assert run["status"] == "completed"
    unit = run["units"]["scene_plan"]
    assert unit["repair_count"] == 0
    assert any(w.get("type") == "scene_plan_beat_low_source_overlap" for w in unit.get("quality_warnings") or [])
    assert run["artifacts"]["compiled_project"]["shot_prompts"]


class LowOverlapStoryboardDescriptionModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "storyboard_scene":
            self.calls.append(stage)
            value = {"scene": copy.deepcopy(RESPONSES["storyboard_base"]["scenes"][0])}
            for shot in value["scene"]["shots"]:
                shot.pop("shot_id", None)
                shot.pop("scene_id", None)
            value["scene"]["shots"][0]["description"] = "她靠近采光边界静立，双手控制一件纸质物件。"
            return value
        return super().generate_json(stage, system_prompt, payload)


def test_storyboard_semantic_visual_transform_low_overlap_is_warning_not_pause(tmp_path):
    model = LowOverlapStoryboardDescriptionModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Storyboard authority separation")
    assert run["status"] == "completed"
    unit = run["units"]["storyboard:SC001"]
    assert unit["repair_count"] == 0
    warning_types = {w.get("type") for w in unit.get("quality_warnings") or []}
    assert "storyboard_description_not_supported_by_evidence" in warning_types
    assert run["artifacts"]["compiled_project"]["shot_prompts"]


class LowOverlapProductionSemanticsModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "production_semantics_shot":
            self.calls.append(stage)
            shot = payload.get("shot") or {}
            evidence = (payload.get("program_owned") or {}).get("current_shot_evidence") or []
            quote = next((str(x).strip() for x in evidence if isinstance(x, str) and str(x).strip()), "")
            return {"production_semantics": {
                "visual_events": [{
                    "action": "她靠近采光边界静立，双手控制一件纸质物件。",
                    "character_refs": list(shot.get("character_refs") or []),
                    "prop_refs": list(shot.get("prop_refs") or []),
                    "source_evidence": [{"quote": quote}],
                }],
                "audio_events": [],
                "renderability_status": "renderable",
                "renderability_issues": [],
                "diegetic_text": [],
                "production_choices": [],
                "appearance_overlays": [],
            }}
        return super().generate_json(stage, system_prompt, payload)


def test_production_semantics_visual_transform_low_overlap_is_warning_not_pause(tmp_path):
    model = LowOverlapProductionSemanticsModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Production semantics authority separation")
    assert run["status"] == "completed"
    unit = run["units"]["production_semantics:SH001"]
    assert unit["repair_count"] == 0
    warning_types = {w.get("type") for w in unit.get("quality_warnings") or []}
    assert "production_semantics_visual_event_not_supported" in warning_types
    assert run["artifacts"]["compiled_project"]["shot_prompts"]


class RecoveringDirectorEvidenceModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot":
            self.director_attempts += 1
            value = super().generate_json(stage, system_prompt, payload)
            if self.director_attempts == 1:
                bad = copy.deepcopy(value)
                bad["director"]["performance_actions"][0]["source_evidence"] = []
                return bad
            repair = payload.get("repair_instruction") or {}
            error = next(
                e for e in repair.get("validation_errors", [])
                if e.get("type") == "director_missing_performance_evidence"
            )
            assert error.get("target_path") == "director.performance_actions[0]"
            assert error.get("available_current_shot_action_evidence")
            assert repair.get("repair_targets") == ["director.performance_actions[0]"]
            return value
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_repairs_missing_director_performance_evidence_with_explicit_authority(tmp_path):
    model = RecoveringDirectorEvidenceModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Director Evidence Repair")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 1
    assert unit["attempts"][0]["status"] == "validation_failed"
    assert unit["attempts"][1]["status"] in {"passed", "passed_with_quality_warnings"}


class RecoveringDirectorShotSizeFocusModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_attempts = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot":
            self.director_attempts += 1
            value = super().generate_json(stage, system_prompt, payload)
            if self.director_attempts == 1:
                bad = copy.deepcopy(value)
                d = bad["director"]
                d["shot_purpose"] = "action"
                d["visual_target"] = {
                    "target_type": "character",
                    "character_refs": ["char_001"],
                    "prop_refs": [],
                    "environment_keys": [],
                }
                d["visual_focus"] = {
                    "focus_type": "body_region",
                    "subject_refs": ["char_001"],
                    "body_regions": {"char_001": ["hands"]},
                    "prop_refs": [],
                    "environment_keys": [],
                }
                d["execution_shot_design"] = {
                    "shot_size": "wide",
                    "camera": "eye_level",
                    "movement": "static",
                }
                return bad
            repair = payload.get("repair_instruction") or {}
            error = next(
                e for e in repair.get("validation_errors", [])
                if e.get("type") == "director_shot_size_focus_conflict"
            )
            assert repair.get("repair_targets") == ["director.execution_shot_design.shot_size"]
            assert error.get("repair_action") == "change_shot_size_keep_precision_focus"
            assert error.get("allowed_repair_values") == ["medium_close", "close", "extreme_close"]
            fixed = copy.deepcopy(repair["invalid_output"])
            fixed["director"]["execution_shot_design"]["shot_size"] = "medium_close"
            return fixed
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_stabilizes_director_wide_precision_focus_conflict_without_model_repair(tmp_path):
    model = RecoveringDirectorShotSizeFocusModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Director shot size focus stabilization")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 0
    assert len(unit["attempts"]) == 1
    assert unit["attempts"][0]["status"] in {"passed", "passed_with_quality_warnings"}
    assert model.director_attempts == 1
    shot_spec = next(x for x in run["artifacts"]["shot_specs"] if x.get("shot_id") == "SH001")
    director = shot_spec["director"]
    assert director["execution_shot_design"]["shot_size"] == "medium_close"
    assert director["visual_focus"]["body_regions"] == {"char_001": ["hands"]}


class NeverRepairsDirectorShotSizeFocusModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot":
            value = super().generate_json(stage, system_prompt, payload)
            d = value["director"]
            d["shot_purpose"] = "action"
            d["visual_target"] = {
                "target_type": "character", "character_refs": ["char_001"],
                "prop_refs": [], "environment_keys": [],
            }
            d["visual_focus"] = {
                "focus_type": "body_region", "subject_refs": ["char_001"],
                "body_regions": {"char_001": ["hands"]}, "prop_refs": [], "environment_keys": [],
            }
            d["execution_shot_design"] = {"shot_size": "wide", "camera": "eye_level", "movement": "static"}
            d["primary_subject_refs"] = ["char_missing"]
            return value
        return super().generate_json(stage, system_prompt, payload)


class RecoversLegacyDirectorShotSizeFocusModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot" and payload.get("repair_instruction"):
            repair = payload["repair_instruction"]
            error = next(e for e in repair.get("validation_errors", []) if e.get("type") == "director_shot_size_focus_conflict")
            assert set(error) == {"type", "detail", "path"}
            assert "兼容旧 checkpoint" in system_prompt
            fixed = copy.deepcopy(repair["invalid_output"])
            fixed["director"]["execution_shot_design"]["shot_size"] = "medium_close"
            return fixed
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_resume_repairs_legacy_paused_focus_conflict_without_restarting_upstream(tmp_path):
    runtime = _runtime(tmp_path, NeverRepairsDirectorShotSizeFocusModel())
    paused = runtime.start("阿宁站在窗边，手里拿着信封。", "Legacy Director focus conflict")
    assert paused["status"] == "paused"
    run_id = paused["run_id"]
    saved = runtime.store.get(run_id)
    hint = saved["recovery"]["source_repair_hints"]["director:SH001"]
    # Current v17.4 stabilizes this contradiction before any Repair. Reconstruct a
    # minimal old-build pause hint to verify backwards recovery still works.
    legacy_director = hint["invalid_output"]["director"]
    legacy_director["primary_subject_refs"] = ["char_001"]
    legacy_director["shot_purpose"] = "action"
    legacy_director["visual_target"] = {
        "target_type": "character", "character_refs": ["char_001"],
        "prop_refs": [], "environment_keys": [],
    }
    legacy_director["visual_focus"] = {
        "focus_type": "body_region", "subject_refs": ["char_001"],
        "body_regions": {"char_001": ["hands"]}, "prop_refs": [], "environment_keys": [],
    }
    legacy_director["execution_shot_design"] = {"shot_size": "wide", "camera": "eye_level", "movement": "static"}
    if isinstance(legacy_director.get("camera_execution"), dict):
        legacy_director["camera_execution"].update({"shot_size": "wide", "camera": "eye_level", "movement": "static"})
    hint["validation_errors"] = [{
        "type": "director_shot_size_focus_conflict",
        "detail": "wide cannot carry precision body focus: ['hands']",
        "path": "director.execution_shot_design.shot_size",
    }]
    runtime.store.save(saved)

    resumed_runtime = RuntimeV20(
        model=RecoversLegacyDirectorShotSizeFocusModel(),
        store=runtime.store,
        checkpoints=runtime.checkpoints,
    )
    resumed = resumed_runtime.resume(run_id)
    assert resumed["status"] == "completed"
    shot_spec = next(x for x in resumed["artifacts"]["shot_specs"] if x.get("shot_id") == "SH001")
    assert shot_spec["director"]["execution_shot_design"]["shot_size"] == "medium_close"
    assert shot_spec["director"]["visual_focus"]["body_regions"] == {"char_001": ["hands"]}


class NeverRepairsDirectorReactionBundleModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot":
            value = super().generate_json(stage, system_prompt, payload)
            d = value["director"]
            d["performance_actions"] = []
            d["reaction_target_refs"] = ["char_001"]
            d["shot_purpose"] = "reaction"
            d["visual_target"] = {
                "target_type": "reaction", "character_refs": ["char_001"],
                "prop_refs": [], "environment_keys": [],
            }
            d["visual_focus"] = {
                "focus_type": "reaction", "subject_refs": ["char_001"],
                "body_regions": {}, "prop_refs": [], "environment_keys": [],
            }
            d["execution_framing"] = {"framing_type": "reaction", "foreground_character_refs": []}
            d["execution_shot_design"] = {"shot_size": "wide", "camera": "eye_level", "movement": "static"}
            d["primary_subject_refs"] = ["char_missing"]
            return value
        return super().generate_json(stage, system_prompt, payload)


class RepairsDirectorReactionBundleModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot" and payload.get("repair_instruction"):
            repair = payload["repair_instruction"]
            errors = repair.get("validation_errors") or []
            reaction_error = next(e for e in errors if e.get("type") == "reaction_target_without_performance")
            scale_error = next(
                e for e in errors
                if e.get("type") == "director_shot_purpose_design_conflict"
                and "reaction requires a readable reaction scale" in str(e.get("detail") or "")
            )
            assert reaction_error["available_character_reaction_evidence"]
            assert scale_error["allowed_repair_values"] == ["medium_close", "close", "extreme_close"]
            fixed = copy.deepcopy(repair["invalid_output"])
            evidence = reaction_error["available_character_reaction_evidence"][0]
            fixed["director"]["performance_actions"] = [{
                "character_ref": reaction_error["reaction_target_ref"],
                "action": evidence,
                "transformation_type": "visible_state_expression",
                "dependency_tags": [],
                "source_evidence": [{"quote": evidence}],
            }]
            fixed["director"]["execution_shot_design"]["shot_size"] = "medium_close"
            return fixed
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_stabilizes_reaction_bundle_without_model_repair(tmp_path):
    model = RepairsDirectorReactionBundleModel()
    # First director attempt must be invalid; use a thin wrapper flag inside the instance.
    original_generate = model.generate_json
    state = {"director_calls": 0}

    def generate(stage, system_prompt, payload):
        if stage == "director_shot" and not payload.get("repair_instruction"):
            state["director_calls"] += 1
            value = MockModel.generate_json(model, stage, system_prompt, payload)
            d = value["director"]
            d["performance_actions"] = []
            d["reaction_target_refs"] = ["char_001"]
            d["shot_purpose"] = "reaction"
            d["visual_target"] = {"target_type": "reaction", "character_refs": ["char_001"], "prop_refs": [], "environment_keys": []}
            d["visual_focus"] = {"focus_type": "reaction", "subject_refs": ["char_001"], "body_regions": {}, "prop_refs": [], "environment_keys": []}
            d["execution_framing"] = {"framing_type": "reaction", "foreground_character_refs": []}
            d["execution_shot_design"] = {"shot_size": "wide", "camera": "eye_level", "movement": "static"}
            return value
        return original_generate(stage, system_prompt, payload)

    model.generate_json = generate
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Director reaction bundle")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 0
    assert len(unit["attempts"]) == 1
    assert unit["attempts"][0]["status"] in {"passed", "passed_with_quality_warnings"}
    assert state["director_calls"] == 1
    shot_spec = next(x for x in run["artifacts"]["shot_specs"] if x.get("shot_id") == "SH001")
    director = shot_spec["director"]
    assert director["execution_shot_design"]["shot_size"] == "medium_close"
    assert director["reaction_target_refs"] == ["char_001"]
    assert director["performance_actions"] == []


class RecoversLegacyDirectorReactionBundleModel(MockModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == "director_shot" and payload.get("repair_instruction"):
            repair = payload["repair_instruction"]
            errors = repair.get("validation_errors") or []
            reaction_errors = [e for e in errors if e.get("type") == "reaction_target_without_performance"]
            assert reaction_errors
            assert all(set(e).issubset({"type", "detail", "path"}) for e in reaction_errors)
            assert "reaction bundle" in system_prompt
            evidence_map = payload["program_owned"]["reaction_performance_evidence_by_character"]
            fixed = copy.deepcopy(repair["invalid_output"])
            ref = fixed["director"]["reaction_target_refs"][0]
            evidence = evidence_map[ref][0]
            fixed["director"]["performance_actions"] = [{
                "character_ref": ref,
                "action": evidence,
                "transformation_type": "visible_state_expression",
                "dependency_tags": [],
                "source_evidence": [{"quote": evidence}],
            }]
            fixed["director"]["execution_shot_design"]["shot_size"] = "medium_close"
            return fixed
        return super().generate_json(stage, system_prompt, payload)


def test_runtime_resume_repairs_legacy_paused_reaction_bundle_without_restarting_upstream(tmp_path):
    runtime = _runtime(tmp_path, NeverRepairsDirectorReactionBundleModel())
    paused = runtime.start("阿宁站在窗边，手里拿着信封。", "Legacy reaction bundle")
    assert paused["status"] == "paused"
    run_id = paused["run_id"]
    saved = runtime.store.get(run_id)
    hint = saved["recovery"]["source_repair_hints"]["director:SH001"]
    # v17.4 repairs the reaction bundle deterministically on new runs. Restore the
    # old invalid bundle explicitly so resume compatibility is tested rather than
    # relying on the current runtime to reproduce an obsolete pause state.
    legacy_director = hint["invalid_output"]["director"]
    legacy_director["primary_subject_refs"] = ["char_001"]
    legacy_director["performance_actions"] = []
    legacy_director["reaction_target_refs"] = ["char_001"]
    legacy_director["shot_purpose"] = "reaction"
    legacy_director["visual_target"] = {
        "target_type": "reaction", "character_refs": ["char_001"],
        "prop_refs": [], "environment_keys": [],
    }
    legacy_director["visual_focus"] = {
        "focus_type": "reaction", "subject_refs": ["char_001"],
        "body_regions": {}, "prop_refs": [], "environment_keys": [],
    }
    legacy_director["execution_framing"] = {"framing_type": "reaction", "foreground_character_refs": []}
    legacy_director["execution_shot_design"] = {"shot_size": "wide", "camera": "eye_level", "movement": "static"}
    if isinstance(legacy_director.get("camera_execution"), dict):
        legacy_director["camera_execution"].update({
            "framing_type": "reaction", "foreground_character_refs": [],
            "shot_size": "wide", "camera": "eye_level", "movement": "static",
        })
    hint["validation_errors"] = [{
        "type": "reaction_target_without_performance",
        "detail": "reaction target char_001 requires same-character performance evidence",
        "path": "director.reaction_target_refs",
    }]
    # Simulate a real upgrade from the previous runtime. Across a build boundary,
    # validator-specific repair hints are intentionally discarded and rebuilt.
    saved["build_id"] = "legacy-runtime-build"
    runtime.store.save(saved)

    resumed_runtime = RuntimeV20(
        model=RecoversLegacyDirectorReactionBundleModel(),
        store=runtime.store,
        checkpoints=runtime.checkpoints,
    )
    resumed = resumed_runtime.resume(run_id)
    assert resumed["status"] == "completed"
    assert (resumed.get("recovery") or {}).get("source_repair_hints", {}).get("director:SH001") is None
    assert any(event.get("type") == "stale_repair_hints_cleared" for event in resumed.get("events", []))


class EstablishSpaceWideHandsModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_calls = 0

    def generate_json(self, stage, system_prompt, payload):
        value = super().generate_json(stage, system_prompt, payload)
        if stage == "director_shot":
            self.director_calls += 1
            d = value["director"]
            d["shot_purpose"] = "establish_space"
            d["reaction_target_refs"] = []
            d["visual_target"] = {
                "target_type": "character", "character_refs": ["char_001"],
                "prop_refs": [], "environment_keys": [],
            }
            d["visual_focus"] = {
                "focus_type": "body_region", "subject_refs": ["char_001"],
                "body_regions": {"char_001": ["hands"]}, "prop_refs": [], "environment_keys": [],
            }
            d["execution_framing"] = {"framing_type": "single", "foreground_character_refs": []}
            d["execution_shot_design"] = {"shot_size": "wide", "camera": "eye_level", "movement": "static"}
        return value


def test_runtime_deterministically_keeps_establish_space_wide_and_relaxes_precision_focus(tmp_path):
    model = EstablishSpaceWideHandsModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Establish wide hands stabilization")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 0
    assert model.director_calls == 1
    shot_spec = next(x for x in run["artifacts"]["shot_specs"] if x.get("shot_id") == "SH001")
    director = shot_spec["director"]
    assert director["shot_purpose"] == "establish_space"
    assert director["execution_shot_design"]["shot_size"] == "wide"
    assert director["visual_focus"]["body_regions"] == {}
    assert director["visual_focus"]["focus_type"] == "character"


class SubjectConflictWithIndependentReactionTargetModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_calls = 0

    def generate_json(self, stage, system_prompt, payload):
        value = super().generate_json(stage, system_prompt, payload)
        if stage != "director_shot":
            return value
        self.director_calls += 1
        d = value["director"]
        # Emulate the production failure class: objective evidence belongs to the
        # speaker, while the camera independently keeps the listener as reaction target.
        d["primary_subject_refs"] = ["char_001"]
        d["reaction_target_refs"] = ["char_001"]
        d["performance_actions"] = []
        return value


def test_runtime_allows_reaction_target_without_forcing_objective_action_or_repair(tmp_path):
    model = SubjectConflictWithIndependentReactionTargetModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Independent reaction target")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 0
    assert model.director_calls == 1
    shot_spec = next(x for x in run["artifacts"]["shot_specs"] if x.get("shot_id") == "SH001")
    assert shot_spec["director"]["reaction_target_refs"] == ["char_001"]
    assert shot_spec["director"]["performance_actions"] == []


class UnsupportedReactionTargetOnlyModel(MockModel):
    def __init__(self):
        super().__init__()
        self.director_calls = 0

    def generate_json(self, stage, system_prompt, payload):
        if stage == "production_semantics_shot":
            return {"production_semantics": {
                "visual_events": [],
                "audio_events": [],
                "renderability_status": "renderable",
                "renderability_issues": [],
                "dialogue": [],
                "diegetic_text": [],
                "production_choices": [],
                "appearance_overlays": [],
            }}
        value = super().generate_json(stage, system_prompt, payload)
        if stage == "director_shot":
            self.director_calls += 1
            d = value["director"]
            d["performance_actions"] = []
            d["reaction_target_refs"] = ["char_001"]
            d["shot_purpose"] = "continuity"
            d["visual_target"] = {
                "target_type": "character", "character_refs": ["char_001"],
                "prop_refs": [], "environment_keys": [],
            }
            d["visual_focus"] = {
                "focus_type": "character", "subject_refs": ["char_001"],
                "body_regions": {}, "prop_refs": [], "environment_keys": [],
            }
            d["execution_framing"] = {"framing_type": "single", "foreground_character_refs": []}
            d["execution_shot_design"] = {"shot_size": "medium", "camera": "eye_level", "movement": "static"}
        return value


def test_runtime_preserves_visual_reaction_target_without_objective_performance_or_model_retry(tmp_path):
    model = UnsupportedReactionTargetOnlyModel()
    run = _runtime(tmp_path, model).start("阿宁站在窗边，手里拿着信封。", "Unsupported reaction stabilization")
    assert run["status"] == "completed"
    unit = run["units"]["director:SH001"]
    assert unit["repair_count"] == 0
    assert model.director_calls == 1
    shot_spec = next(x for x in run["artifacts"]["shot_specs"] if x.get("shot_id") == "SH001")
    director = shot_spec["director"]
    assert director["reaction_target_refs"] == ["char_001"]
    assert director["performance_actions"] == []
    assert director["shot_purpose"] == "continuity"

from __future__ import annotations

import copy

import pytest

from app.store import RunStore
from app.ark import ArkPermanentError, ArkTransientError
from runtime.checkpoints import CheckpointStore, unit_input_hash
from runtime.model_router import ModelRouter
from runtime.orchestrator import RuntimePaused, RuntimeV20
from runtime.stage_contracts import extract_model_stage_output


class _SequenceModel:
    def __init__(self, values):
        self.values = list(values)
        self.calls = 0

    def generate_json(self, stage, system_prompt, payload):
        value = self.values[self.calls]
        self.calls += 1
        return copy.deepcopy(value)


def _runtime(tmp_path, model, repair=None):
    return RuntimeV20(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoints=CheckpointStore(tmp_path / "checkpoints"),
        router=ModelRouter(default_model=model, direction_model=model, repair_model=repair or model),
    )


def test_model_stage_envelope_is_exact_and_repairable_at_owning_unit(tmp_path):
    first = _SequenceModel([{"director": {"ok": True}, "extra": "must-not-be-silent"}])
    repair = _SequenceModel([{"director": {"ok": True}}])
    runtime = _runtime(tmp_path, first, repair)
    run = runtime.create("测试文本", title="envelope")

    result = runtime._execute_unit(
        run,
        unit_id="director:SH001",
        stage="director",
        model_stage="director_shot",
        payload={"unit_id": "director:SH001"},
        prompt="director",
        extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "bad"}], 0),
        enforce_model_envelope=True,
    )

    assert result == {"ok": True}
    assert first.calls == 1 and repair.calls == 1
    assert run["units"]["director:SH001"]["attempts"][0]["errors"][0]["type"] == "model_output_envelope_mismatch"


def test_legacy_checkpoint_is_revalidated_and_promoted_without_model_call(tmp_path):
    model = _SequenceModel([{"scene": {"ok": True}}])
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="checkpoint migration")
    payload = {"unit_id": "storyboard:SC001"}
    runtime.checkpoints.save(run["run_id"], "storyboard:SC001", {
        "unit_id": "storyboard:SC001",
        "stage": "storyboard",
        "status": "completed",
        "input_hash": unit_input_hash(payload),
        "attempts": [],
        "repair_count": 0,
        "normalization_count": 0,
        "quality_warnings": [],
        "output": {"ok": True},
    })

    result = runtime._execute_unit(
        run,
        unit_id="storyboard:SC001",
        stage="storyboard",
        model_stage="storyboard_scene",
        payload=payload,
        prompt="storyboard",
        extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "bad"}], 0),
        enforce_model_envelope=True,
    )

    assert result == {"ok": True}
    assert model.calls == 0
    stored = runtime.checkpoints.get(run["run_id"], "storyboard:SC001")
    assert stored["contract_id"].startswith(RuntimeV20.CONTRACTS["storyboard"])
    assert run["units"]["storyboard:SC001"]["checkpoint_migrated"] is True


def test_production_semantics_gate_stops_before_director(tmp_path):
    model = _SequenceModel([])
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="semantic gate")

    with pytest.raises(RuntimePaused):
        runtime._enforce_production_semantics_readiness(run, {
            "shots": [{
                "shot_id": "SH002",
                "renderability_status": "needs_adaptation",
                "renderability_issues": [{"type": "time_compression", "detail": "需要拆镜"}],
            }]
        })

    assert run["status"] == "paused"
    assert run["current_unit"] == "production_semantics:gate"
    assert run["error"]["failure_kind"] == "production_semantics_readiness_gate"
    assert run["error"]["source_unit_ids"] == ["production_semantics:SH002"]
    assert run["validations"]["production_semantics"]["passed"] is False
    assert not any(uid.startswith("director:SH") for uid in run["units"])


def test_retrying_gate_invalidates_owning_source_unit_instead_of_looping_on_gate(tmp_path, monkeypatch):
    model = _SequenceModel([])
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="gate retry")
    source_id = "production_semantics:SH002"
    gate_id = "production_semantics:gate"
    payload = {"shot_id": "SH002"}
    source_record = {
        "unit_id": source_id, "stage": "production_semantics", "status": "completed",
        "input_hash": unit_input_hash(payload), "contract_id": "legacy", "output": {"shot_id": "SH002"},
    }
    runtime.checkpoints.save(run["run_id"], source_id, source_record)
    run["units"][source_id] = copy.deepcopy(source_record)
    run["units"][gate_id] = {
        "unit_id": gate_id, "stage": "production_semantics", "status": "failed_recoverable",
        "source_unit_ids": [source_id], "failure_kind": "production_semantics_readiness_gate",
    }
    runtime.store.save(run)
    monkeypatch.setattr(runtime, "_execute", lambda current: current)

    retried = runtime.retry_unit(run["run_id"], gate_id)

    assert source_id not in retried["units"]
    assert gate_id not in retried["units"]
    assert runtime.checkpoints.get(run["run_id"], source_id) is None
    event = retried["events"][-1]
    assert event["type"] == "unit_retry_requested"
    assert source_id in event["message"]



def test_resume_gate_failure_invalidates_recorded_source_units_before_execute(tmp_path, monkeypatch):
    model = _SequenceModel([])
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="gate resume")
    source_id = "director:SH009"
    gate_id = "director:gate"
    source_record = {
        "unit_id": source_id, "stage": "director", "status": "completed",
        "input_hash": unit_input_hash({"shot_id": "SH009"}), "contract_id": "legacy", "output": {"ok": True},
    }
    runtime.checkpoints.save(run["run_id"], source_id, source_record)
    run["units"][source_id] = copy.deepcopy(source_record)
    run["units"][gate_id] = {
        "unit_id": gate_id, "stage": "director", "status": "failed_recoverable",
        "source_unit_ids": [source_id], "failure_kind": "director_assembly_gate",
    }
    run["status"] = "paused"
    run["error"] = {
        "unit_id": gate_id, "stage": "director", "message": "gate failed",
        "failure_kind": "director_assembly_gate", "retryable": True,
        "retry_mode": "regenerate_source_units", "source_unit_ids": [source_id],
    }
    runtime.store.save(run)
    monkeypatch.setattr(runtime, "_execute", lambda current: current)

    resumed = runtime.resume(run["run_id"])

    assert source_id not in resumed["units"]
    assert gate_id not in resumed["units"]
    assert runtime.checkpoints.get(run["run_id"], source_id) is None
    assert resumed["events"][-1]["type"] == "run_resume_sources_invalidated"



class _TransportFailureModel:
    def __init__(self):
        self.calls = 0

    def generate_json(self, stage, system_prompt, payload):
        self.calls += 1
        raise ArkTransientError(
            "rate limited", kind="provider_tpm_rate_limited", status_code=429, transport_attempts=2,
            provider_code="RateLimitExceeded.EndpointTPMExceeded",
            provider_message="endpoint TPM exceeded", request_id="req-runtime-429", retry_after_seconds=60,
        )


def test_transport_failure_does_not_consume_semantic_repair_budget(tmp_path):
    model = _TransportFailureModel()
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="transport isolation")

    with pytest.raises(RuntimePaused):
        runtime._execute_unit(
            run, unit_id="storyboard:SC002", stage="storyboard", model_stage="storyboard_scene",
            payload={"unit_id": "storyboard:SC002"}, prompt="storyboard", extract=lambda x: x,
            validate=lambda value: (value, [], 0), enforce_model_envelope=True,
        )

    unit = run["units"]["storyboard:SC002"]
    assert model.calls == 1
    assert unit["repair_count"] == 0
    assert run["recovery"]["total_repairs"] == 0
    assert run["error"]["failure_kind"] == "provider_tpm_rate_limited"
    assert run["error"]["status_code"] == 429
    assert run["error"]["transport_attempts"] == 2
    assert run["error"]["provider_code"] == "RateLimitExceeded.EndpointTPMExceeded"
    assert run["error"]["provider_message"] == "endpoint TPM exceeded"
    assert run["error"]["request_id"] == "req-runtime-429"
    assert run["error"]["retry_after_seconds"] == 60



class _PermanentFailureModel:
    def generate_json(self, stage, system_prompt, payload):
        raise ArkPermanentError(
            "unauthorized", kind="provider_http_permanent", status_code=401, transport_attempts=1
        )


def test_permanent_provider_failure_is_not_marked_recoverable(tmp_path):
    model = _PermanentFailureModel()
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="permanent provider failure")

    with pytest.raises(RuntimePaused):
        runtime._execute_unit(
            run, unit_id="storyboard:SC002", stage="storyboard", model_stage="storyboard_scene",
            payload={"unit_id": "storyboard:SC002"}, prompt="storyboard", extract=lambda x: x,
            validate=lambda value: (value, [], 0), enforce_model_envelope=True,
        )

    assert run["units"]["storyboard:SC002"]["status"] == "failed"
    assert run["error"]["retryable"] is False
    assert run["error"]["retry_mode"] == "inspect_runtime"
    assert run["events"][-1]["status"] == "failed"


def test_state_shotspec_deterministic_failure_does_not_offer_same_input_retry(tmp_path, monkeypatch):
    model = _SequenceModel([])
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="state deterministic failure")
    monkeypatch.setattr(
        "runtime.orchestrator.build_state_shot_specs",
        lambda storyboard, scene_plan=None: ([], [{"type": "shot_spec_build_failure", "detail": "boom"}]),
    )

    with pytest.raises(RuntimePaused):
        runtime._run_state_shotspec_stage(run, {"scenes": []}, {"scenes": []})

    assert run["units"]["state_shotspec"]["status"] == "failed"
    assert run["error"]["retryable"] is False
    assert run["error"]["retry_mode"] == "inspect_runtime"


def test_gate_retry_reinjects_gate_errors_and_previous_output_into_source_unit(tmp_path, monkeypatch):
    model = _SequenceModel([{"scene": {"ok": True}}])
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="gate targeted repair")
    source_id = "storyboard:SC001"
    gate_id = "storyboard:gate"
    payload = {"unit_id": source_id}
    source_record = {
        "unit_id": source_id, "stage": "storyboard", "status": "completed",
        "input_hash": unit_input_hash(payload), "contract_id": "legacy",
        "output": {"ok": False, "old": "canonical"},
    }
    runtime.checkpoints.save(run["run_id"], source_id, source_record)
    run["units"][source_id] = copy.deepcopy(source_record)

    with pytest.raises(RuntimePaused):
        runtime._enforce_stage_gate(
            run, stage="storyboard", unit_id=gate_id,
            errors=[{"type": "assembled_problem", "scene_id": "SC001"}],
            validation_key="storyboard_base", failure_kind="storyboard_assembly_gate",
            message="gate failed", source_unit_ids=[source_id],
        )

    runtime._invalidate_from(run, source_id)
    result = runtime._execute_unit(
        run, unit_id=source_id, stage="storyboard", model_stage="storyboard_scene",
        payload=payload, prompt="storyboard", extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "bad"}], 0),
        enforce_model_envelope=True,
    )

    assert result == {"ok": True}
    assert source_id not in (run.get("recovery") or {}).get("source_repair_hints", {})


class _CapturePayloadModel:
    def __init__(self, response):
        self.response = response
        self.payloads = []

    def generate_json(self, stage, system_prompt, payload):
        self.payloads.append(copy.deepcopy(payload))
        return copy.deepcopy(self.response)


def test_source_repair_hint_is_sent_on_first_retry_call(tmp_path):
    model = _CapturePayloadModel({"scene": {"ok": True}})
    runtime = _runtime(tmp_path, model)
    run = runtime.create("测试文本", title="repair hint payload")
    unit_id = "storyboard:SC001"
    run.setdefault("recovery", {}).setdefault("source_repair_hints", {})[unit_id] = {
        "origin_gate": "storyboard:gate",
        "validation_errors": [{"type": "assembled_problem"}],
        "invalid_output": {"ok": False},
    }

    result = runtime._execute_unit(
        run, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene",
        payload={"unit_id": unit_id}, prompt="storyboard", extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "bad"}], 0),
        enforce_model_envelope=True,
    )

    assert result == {"ok": True}
    instruction = model.payloads[0]["repair_instruction"]
    assert instruction["mode"] == "repair_from_stage_gate"
    assert instruction["origin_gate"] == "storyboard:gate"
    assert instruction["invalid_output"] == {"ok": False}


def test_paused_contract_failure_keeps_last_invalid_output_for_next_retry(tmp_path, monkeypatch):
    failing = _CapturePayloadModel({"scene": {"ok": False}})
    runtime = _runtime(tmp_path, failing)
    run = runtime.create("测试文本", title="contract retry memory")
    unit_id = "storyboard:SC001"

    with pytest.raises(RuntimePaused):
        runtime._execute_unit(
            run, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene",
            payload={"unit_id": unit_id}, prompt="storyboard", extract=lambda x: x,
            validate=lambda value: (value, [{"type": "must_fix", "detail": "x"}], 0),
            enforce_model_envelope=True,
        )

    hint = run["recovery"]["source_repair_hints"][unit_id]
    assert hint["validation_errors"][0]["type"] == "must_fix"
    assert hint["invalid_output"] == {"scene": {"ok": False}}

    succeeding = _CapturePayloadModel({"scene": {"ok": True}})
    runtime.router.default_model = succeeding
    runtime.router.direction_model = succeeding
    runtime.router.repair_model = succeeding
    monkeypatch.setattr(runtime, "_execute", lambda current: runtime._execute_unit(
        current, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene",
        payload={"unit_id": unit_id}, prompt="storyboard", extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "must_fix"}], 0),
        enforce_model_envelope=True,
    ) or current)

    # Execute the targeted unit directly after invalidation to isolate retry payload behavior.
    runtime._invalidate_from(run, unit_id)
    result = runtime._execute_unit(
        run, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene",
        payload={"unit_id": unit_id}, prompt="storyboard", extract=lambda x: x,
        validate=lambda value: (value, [] if value.get("ok") else [{"type": "must_fix"}], 0),
        enforce_model_envelope=True,
    )
    assert result == {"ok": True}
    assert succeeding.payloads[0]["repair_instruction"]["mode"] == "repair_from_previous_failure"
    assert succeeding.payloads[0]["repair_instruction"]["invalid_output"] == {"scene": {"ok": False}}


def test_stage_gate_retry_uses_original_model_envelope_not_canonical_checkpoint(tmp_path):
    first_model = _CapturePayloadModel({"scene": {"ok": False}})
    runtime = _runtime(tmp_path, first_model)
    run = runtime.create("测试文本", title="raw envelope repair seed")
    unit_id = "storyboard:SC001"
    payload = {"unit_id": unit_id}

    first = runtime._execute_unit(
        run, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene",
        payload=payload, prompt="storyboard", extract=lambda x: x,
        validate=lambda value: (value, [], 0), enforce_model_envelope=True,
    )
    assert first == {"ok": False}
    checkpoint = runtime.checkpoints.get(run["run_id"], unit_id)
    assert checkpoint["raw_model_output"] == {"scene": {"ok": False}}
    assert checkpoint["output"] == {"ok": False}

    with pytest.raises(RuntimePaused):
        runtime._enforce_stage_gate(
            run, stage="storyboard", unit_id="storyboard:gate",
            errors=[{"type": "assembled_problem", "scene_id": "SC001"}],
            validation_key="storyboard_base", failure_kind="storyboard_assembly_gate",
            message="gate failed", source_unit_ids=[unit_id],
        )

    hint = run["recovery"]["source_repair_hints"][unit_id]
    assert hint["invalid_output"] == {"scene": {"ok": False}}

    runtime._invalidate_from(run, unit_id)
    succeeding = _CapturePayloadModel({"scene": {"ok": True}})
    runtime.router.default_model = succeeding
    runtime.router.structure_model = succeeding
    runtime.router.repair_model = succeeding
    result = runtime._execute_unit(
        run, unit_id=unit_id, stage="storyboard", model_stage="storyboard_scene",
        payload=payload, prompt="storyboard", extract=lambda x: x,
        validate=lambda value: (value, [], 0), enforce_model_envelope=True,
    )
    assert result == {"ok": True}
    instruction = succeeding.payloads[0]["repair_instruction"]
    assert instruction["mode"] == "repair_from_stage_gate"
    assert instruction["invalid_output"] == {"scene": {"ok": False}}


def test_legacy_checkpoint_gate_repair_reconstructs_expected_model_envelope(tmp_path):
    runtime = _runtime(tmp_path, _SequenceModel([]))
    run = runtime.create("测试文本", title="legacy envelope fallback")
    unit_id = "storyboard:SC001"
    legacy = {
        "unit_id": unit_id,
        "stage": "storyboard",
        "status": "completed",
        "input_hash": "legacy",
        "contract_id": "legacy",
        "output": {"shots": [{"beat_id": "B001"}]},
    }
    runtime.checkpoints.save(run["run_id"], unit_id, legacy)
    run["units"][unit_id] = copy.deepcopy(legacy)

    with pytest.raises(RuntimePaused):
        runtime._enforce_stage_gate(
            run, stage="storyboard", unit_id="storyboard:gate",
            errors=[{"type": "assembled_problem", "scene_id": "SC001"}],
            validation_key="storyboard_base", failure_kind="storyboard_assembly_gate",
            message="gate failed", source_unit_ids=[unit_id],
        )

    hint = run["recovery"]["source_repair_hints"][unit_id]
    assert hint["invalid_output"] == {"scene": {"shots": [{"beat_id": "B001"}]}}


def test_paused_model_unit_exposes_build_contract_and_repair_count(tmp_path):
    first = _SequenceModel([{"scene": {"ok": False}}])
    repair = _SequenceModel([{"scene": {"ok": False}}])
    runtime = _runtime(tmp_path, first, repair)
    run = runtime.create("测试文本", title="diagnostics")

    with pytest.raises(Exception):
        runtime._execute_unit(
            run,
            unit_id="storyboard:SC001",
            stage="storyboard",
            model_stage="storyboard_scene",
            payload={"unit_id": "storyboard:SC001"},
            prompt="storyboard",
            extract=lambda x: x,
            validate=lambda value: (value, [{"type": "bad", "path": "scene.ok"}], 0),
            enforce_model_envelope=True,
        )

    assert run["error"]["build_id"] == runtime.BUILD_ID
    assert run["error"]["contract_id"].startswith(runtime.CONTRACTS["storyboard"])
    assert run["error"]["repair_count"] == 1


def test_repair_policy_never_returns_empty_scope_for_hard_errors():
    from runtime.orchestrator import RuntimeV20

    policy = RuntimeV20._repair_policy(
        'script_scene',
        [{'type': 'some_hard_stage_error', 'detail': 'legacy error without a field path'}],
    )
    assert policy['repair_targets'] == ['$']
    assert policy['must_change_targeted_fields'] is True


def test_repair_policy_intersects_multiple_must_change_groups_when_one_change_can_satisfy_all():
    errors = [
        {
            'type': 'director_repeated_execution_design',
            'repair_targets': [
                'director.execution_shot_design.shot_size',
                'director.execution_shot_design.camera',
                'director.execution_shot_design.movement',
            ],
            'must_change_any_of_paths': [
                'director.execution_shot_design.shot_size',
                'director.execution_shot_design.camera',
                'director.execution_shot_design.movement',
            ],
        },
        {
            'type': 'director_scene_camera_distribution_pressure',
            'repair_targets': [
                'director.execution_shot_design.camera',
                'director.execution_shot_design.movement',
            ],
            'must_change_any_of_paths': [
                'director.execution_shot_design.camera',
                'director.execution_shot_design.movement',
            ],
        },
    ]
    policy = RuntimeV20._repair_policy('director_shot', errors)
    assert policy['must_change_any_of_paths'] == [
        'director.execution_shot_design.camera',
        'director.execution_shot_design.movement',
    ]
    assert policy['must_change_groups'] == [
        [
            'director.execution_shot_design.shot_size',
            'director.execution_shot_design.camera',
            'director.execution_shot_design.movement',
        ],
        [
            'director.execution_shot_design.camera',
            'director.execution_shot_design.movement',
        ],
    ]

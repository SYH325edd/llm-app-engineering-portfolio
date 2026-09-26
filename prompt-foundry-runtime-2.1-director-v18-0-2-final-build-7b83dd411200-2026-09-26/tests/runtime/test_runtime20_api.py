from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from tests.runtime.test_runtime20_foundations import TwoShotModel


def test_runtime20_api_sync_run_exposes_unit_progress_resume_and_outputs(tmp_path):
    model = TwoShotModel(fail_once_on="director:SH002")
    app = create_app(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=True,
    )
    client = TestClient(app)

    response = client.post("/api/runs", json={"title": "Runtime 2", "source_text": "阿宁站在窗边，手里拿着信封。阿宁转身。"})
    assert response.status_code == 200
    run = response.json()
    assert run["runtime_version"] == "2.1"
    assert run["framework_version"] == "1.3-frozen"
    assert run["status"] == "paused"
    assert run["current_unit"] == "director:SH002"

    events = client.get(f"/api/runs/{run['run_id']}/events")
    assert events.status_code == 200
    assert any(e["type"] == "unit_failed" for e in events.json())

    resumed = client.post(f"/api/runs/{run['run_id']}/resume")
    assert resumed.status_code == 200
    final = resumed.json()
    assert final["status"] == "completed"
    assert len(final["artifacts"]["compiled_project"]["character_prompts"]) == 1
    assert len(final["artifacts"]["compiled_project"]["scene_prompts"]) == 1
    assert len(final["artifacts"]["compiled_project"]["shot_prompts"]) == 2
    assert final["artifacts"]["static_evaluation"]["passed"] is True


def test_runtime20_health_identifies_runtime_and_frozen_core(tmp_path):
    app = create_app(
        model=TwoShotModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=True,
    )
    health = TestClient(app).get("/api/health").json()
    assert health["version"] == "2.1.0"
    assert health["runtime"] == "2.1"
    assert health["framework"] == "1.3-frozen"


def test_paused_run_keeps_validated_upstream_outputs_without_running_stage08(tmp_path):
    model = TwoShotModel(fail_once_on="director:SH002")
    app = create_app(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=True,
    )
    client = TestClient(app)
    run = client.post("/api/runs", json={"title":"partial","source_text":"阿宁站在窗边，手里拿着信封。阿宁转身。"}).json()
    assert run["status"] == "paused"
    outputs = client.get(f"/api/runs/{run['run_id']}/outputs").json()
    assert outputs["script"] is not None
    assert outputs["storyboard"] is not None
    assert outputs["character_prompts"]
    assert outputs["scene_prompts"]
    assert outputs["shot_prompts"] == []
    shots = [shot for scene in outputs["storyboard"]["scenes"] for shot in scene.get("shots", [])]
    assert shots[0].get("director") is not None
    assert shots[1].get("director") is None


def test_server_restart_marks_orphaned_running_run_recoverable(tmp_path):
    store = RunStore(tmp_path / "runs")
    store.save({
        "run_id": "run_orphaned",
        "runtime_version": "2.0",
        "framework_version": "1.3-frozen",
        "title": "重启恢复",
        "status": "running",
        "created_at": "2026-09-15T00:00:00Z",
        "updated_at": "2026-09-15T00:01:00Z",
        "current_stage": "director",
        "current_unit": "director:SH012",
        "source_text": "x",
        "units": {"director:SH011": {"unit_id":"director:SH011","stage":"director","status":"completed"}},
        "stages": [], "events": [], "validations": {}, "artifacts": {}, "counts": {}, "recovery": {}, "error": None,
    })
    create_app(model=TwoShotModel(), store=store, checkpoint_store=CheckpointStore(tmp_path / "checkpoints"), sync_runs=False)
    recovered = store.get("run_orphaned")
    assert recovered["status"] == "paused"
    assert recovered["current_unit"] == "director:SH012"
    assert recovered["error"]["type"] == "runtime_restarted"
    assert recovered["units"]["director:SH011"]["status"] == "completed"


def test_production_mode_runs_in_background_and_can_be_polled(tmp_path):
    import time

    app = create_app(
        model=TwoShotModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=False,
    )
    client = TestClient(app)
    created = client.post("/api/runs", json={"title":"background","source_text":"阿宁站在窗边，手里拿着信封。阿宁转身。"})
    assert created.status_code == 200
    run_id = created.json()["run_id"]

    final = None
    for _ in range(100):
        final = client.get(f"/api/runs/{run_id}").json()
        if final["status"] in {"completed", "paused"}:
            break
        time.sleep(0.02)
    assert final is not None
    assert final["status"] == "completed"
    assert final["runtime_version"] == "2.1"
    assert len(final["artifacts"]["compiled_project"]["shot_prompts"]) == 2


def test_health_and_run_expose_exact_build_and_stage_contracts(tmp_path):
    app = create_app(
        model=TwoShotModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=True,
    )
    client = TestClient(app)
    health = client.get("/api/health").json()
    assert isinstance(health.get("build_id"), str) and len(health["build_id"]) >= 8
    contracts = health.get("contracts") or {}
    assert contracts.get("storyboard") == "storyboard_scene.v16"
    assert contracts.get("director") == "director_shot.v18_0_2"

    run = client.post("/api/runs", json={"title": "build identity", "source_text": "阿宁站在窗边，手里拿着信封。阿宁转身。"}).json()
    assert run.get("build_id") == health["build_id"]
    assert run.get("contracts") == contracts


def test_redistribute_overloaded_endpoint_is_safe_when_no_shot_requires_apply(tmp_path):
    model = TwoShotModel()
    app = create_app(
        model=model,
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        sync_runs=True,
    )
    client = TestClient(app)
    run = client.post(
        "/api/runs",
        json={"title": "redistribution api", "source_text": "阿宁站在窗边，手里拿着信封。阿宁转身。"},
    ).json()
    assert run["status"] == "completed"

    response = client.post(f"/api/runs/{run['run_id']}/redistribute-overloaded")
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "completed"
    assert result["storyboard_redistribution"]["status"] == "no_safe_apply"
    assert result["counts"]["shots"] == run["counts"]["shots"]

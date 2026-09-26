from __future__ import annotations

import time

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from tests.api.fixtures.mock_story_run import MockModel
from tests.runtime.test_contract_rebalance_acceptance import ContractAcceptanceModel, SOURCE
from tests.runtime.test_runtime20_recovery import FailOnceStoryboardModel


def _wait_for_terminal(client: TestClient, run_id: str, *, timeout_seconds: float = 10.0) -> dict:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run.get("status") in {"completed", "paused", "failed"}:
            return run
        time.sleep(0.02)
    raise AssertionError(f"run {run_id} did not reach a terminal state")


def test_framework_native_async_api_runs_current_contract_chain_to_final_prompt(tmp_path):
    app = create_app(
        model=ContractAcceptanceModel(),
        store=RunStore(tmp_path / "runs"),
        checkpoint_store=CheckpointStore(tmp_path / "checkpoints"),
        autoload_model=False,
        sync_runs=False,
    )
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        contracts = health.json()["contracts"]
        assert contracts["story_bible"] == "story_bible.v14"
        assert contracts["scene_plan"] == "scene_plan.v8"
        assert contracts["script"] == "script_scene.v12"
        assert contracts["storyboard"] == "storyboard_scene.v16"
        assert contracts["production_semantics"] == "production_semantics_shot.v1j"
        assert contracts["state_shotspec"] == "state_shotspec.v2"

        created = client.post("/api/runs", json={"title": "Framework native E2E", "source_text": SOURCE})
        assert created.status_code == 200
        run = _wait_for_terminal(client, created.json()["run_id"])

        assert run["status"] == "completed", run.get("error")
        assert run["compile_status"] == "ok"
        assert run["artifacts"]["static_evaluation"]["passed"] is True
        assert run["artifacts"]["consumption_evaluation"]["passed"] is True
        assert all(unit.get("status") == "completed" for unit in run["units"].values())

        outputs = client.get(f"/api/runs/{run['run_id']}/outputs")
        assert outputs.status_code == 200
        prompts = run["artifacts"]["compiled_project"]["shot_prompts"]
        assert len(prompts) == 2
        for prompt in prompts:
            text = prompt["prompt_seedance"]
            for label in (
                "镜号：", "时长：", "场景：", "人物空间站位：", "景别：", "摄法：",
                "画面内容：", "旁白：", "台词：", "动作音效：", "环境音效：", "氛围音效：", "配乐：",
            ):
                assert label in text
        assert "Sophia视线短暂停在手机上" in prompts[0]["prompt_seedance"]
        assert "Tom（画内）：\u201c医生马上来。\u201d" in prompts[1]["prompt_seedance"]


def test_framework_native_persisted_pause_resumes_after_app_instance_restart(tmp_path):
    runs_path = tmp_path / "runs"
    checkpoints_path = tmp_path / "checkpoints"

    first_app = create_app(
        model=FailOnceStoryboardModel(),
        store=RunStore(runs_path),
        checkpoint_store=CheckpointStore(checkpoints_path),
        autoload_model=False,
        sync_runs=False,
    )
    with TestClient(first_app) as client:
        created = client.post(
            "/api/runs",
            json={"title": "Restart recovery", "source_text": "阿宁站在窗边，手里拿着信封。"},
        )
        run_id = created.json()["run_id"]
        paused = _wait_for_terminal(client, run_id)
        assert paused["status"] == "paused"
        assert paused["error"]["unit_id"] == "storyboard:SC001"
        assert paused["units"]["story_bible"]["status"] == "completed"
        assert paused["units"]["scene_plan"]["status"] == "completed"

    second_app = create_app(
        model=MockModel(),
        store=RunStore(runs_path),
        checkpoint_store=CheckpointStore(checkpoints_path),
        autoload_model=False,
        sync_runs=False,
    )
    with TestClient(second_app) as client:
        persisted = client.get(f"/api/runs/{run_id}").json()
        assert persisted["status"] == "paused"
        assert persisted.get("failure_history")

        resumed = client.post(f"/api/runs/{run_id}/resume")
        assert resumed.status_code == 200
        completed = _wait_for_terminal(client, run_id)
        assert completed["status"] == "completed", completed.get("error")
        assert completed["compile_status"] == "ok"
        assert completed["units"]["story_bible"]["status"] == "completed"
        assert completed["units"]["scene_plan"]["status"] == "completed"
        assert completed["units"]["storyboard:SC001"]["status"] == "completed"
        assert len(completed["artifacts"]["compiled_project"]["shot_prompts"]) == 1

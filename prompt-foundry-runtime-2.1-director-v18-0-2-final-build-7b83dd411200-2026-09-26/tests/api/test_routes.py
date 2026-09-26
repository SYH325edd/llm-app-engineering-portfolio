from fastapi.testclient import TestClient

from app.main import create_app
from app.store import RunStore
from tests.api.fixtures.mock_story_run import MockModel


class MockModelWithPing(MockModel):
    api_key = "route-test-secret-9876"
    model = "deepseek-test"
    base_url = "https://ark.example/api/v3"

    def generate_text(self, system_prompt, user_prompt, temperature=0.0):
        return "pong"


def test_health_and_config_never_expose_api_key(tmp_path):
    app = create_app(model=MockModelWithPing(), store=RunStore(tmp_path))
    client = TestClient(app)
    health = client.get("/api/health").json()
    assert health["status"] == "ok"
    assert health["version"] == "2.1.0"
    assert health["runtime"] == "2.1"
    assert health["framework"] == "1.3-frozen"
    config_response = client.get("/api/config")
    config = config_response.json()
    assert config["configured"] is True
    assert config["model"] == "deepseek-test"
    assert config["api_key_configured"] is True
    assert config["api_key_hint"] == "••••9876"
    assert "route-test-secret-9876" not in config_response.text


def test_create_list_and_fetch_run(tmp_path):
    app = create_app(model=MockModelWithPing(), store=RunStore(tmp_path))
    client = TestClient(app)
    response = client.post("/api/runs", json={"title": "测试故事", "source_text": "阿宁站在窗边，手里拿着信封。"})
    assert response.status_code == 200
    run = response.json()
    assert run["status"] == "completed"
    run_id = run["run_id"]
    rows = client.get("/api/runs").json()
    assert rows[0]["run_id"] == run_id
    assert client.get(f"/api/runs/{run_id}").json()["run_id"] == run_id


def test_create_run_rejects_blank_source(tmp_path):
    app = create_app(model=MockModelWithPing(), store=RunStore(tmp_path))
    response = TestClient(app).post("/api/runs", json={"source_text": "   "})
    assert response.status_code == 422


def test_model_test_uses_backend_model_only(tmp_path):
    app = create_app(model=MockModelWithPing(), store=RunStore(tmp_path))
    response = TestClient(app).post("/api/model/test")
    assert response.status_code == 200
    assert response.json()["ok"] is True


def test_root_serves_web_app(tmp_path):
    app = create_app(model=MockModelWithPing(), store=RunStore(tmp_path))
    response = TestClient(app).get("/")
    assert response.status_code == 200
    assert "提示词工坊" in response.text
    assert "人物提示词" in response.text


def test_injected_run_store_never_falls_back_to_project_checkpoint_directory(tmp_path):
    store = RunStore(tmp_path / "isolated-runs")
    app = create_app(model=MockModelWithPing(), store=store)
    assert app.state.checkpoints.root == tmp_path / "isolated-runs" / "checkpoints"

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import RunStore


def test_web_config_saves_and_returns_max_completion_tokens(tmp_path):
    env_path = tmp_path / ".env"
    app = create_app(model=None, store=RunStore(tmp_path / "runs"), config_path=env_path, autoload_model=False)
    client = TestClient(app)

    response = client.put(
        "/api/config",
        json={
            "api_key": "secret",
            "model": "deepseek-endpoint",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "timeout_seconds": 300,
            "max_completion_tokens": 16384,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["max_completion_tokens"] == 16384
    assert "ARK_MAX_COMPLETION_TOKENS=16384" in env_path.read_text(encoding="utf-8")

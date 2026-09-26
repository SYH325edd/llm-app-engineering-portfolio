from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from app.store import RunStore


def test_web_can_save_ark_config_without_echoing_api_key(tmp_path):
    env_path = tmp_path / ".env"
    app = create_app(model=None, store=RunStore(tmp_path / "runs"), config_path=env_path, autoload_model=False)
    client = TestClient(app)

    response = client.put(
        "/api/config",
        json={
            "api_key": "secret-key-123456",
            "model": "deepseek-v3-test",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "timeout_seconds": 90,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert payload["api_key_configured"] is True
    assert payload["model"] == "deepseek-v3-test"
    assert "secret-key-123456" not in response.text
    assert "secret-key-123456" in env_path.read_text(encoding="utf-8")


def test_web_config_blank_key_preserves_existing_saved_key(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "ARK_API_KEY=existing-secret\nARK_MODEL=old-model\nARK_BASE_URL=https://ark.cn-beijing.volces.com/api/v3\nARK_TIMEOUT_SECONDS=120\n",
        encoding="utf-8",
    )
    app = create_app(model=None, store=RunStore(tmp_path / "runs"), config_path=env_path, autoload_model=True)
    client = TestClient(app)

    response = client.put(
        "/api/config",
        json={
            "api_key": "",
            "model": "new-model",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "timeout_seconds": 120,
        },
    )
    assert response.status_code == 200
    assert "ARK_API_KEY=existing-secret" in env_path.read_text(encoding="utf-8")
    assert response.json()["model"] == "new-model"
    assert "existing-secret" not in response.text


def test_saving_model_config_preserves_existing_transport_retry_policy(tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "ARK_API_KEY=existing-secret\nARK_MODEL=old-model\n"
        "ARK_MAX_TRANSPORT_RETRIES=6\nARK_RETRY_BASE_SECONDS=2.5\nARK_RETRY_MAX_SECONDS=15\n",
        encoding="utf-8",
    )
    app = create_app(model=None, store=RunStore(tmp_path / "runs"), config_path=env_path, autoload_model=True)
    client = TestClient(app)

    response = client.put(
        "/api/config",
        json={
            "api_key": "",
            "model": "new-model",
            "base_url": "https://ark.cn-beijing.volces.com/api/v3",
            "timeout_seconds": 120,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["max_transport_retries"] == 6
    assert payload["retry_base_seconds"] == 2.5
    assert payload["retry_max_seconds"] == 15.0

import os
from app.config import load_env_file


def test_load_env_file_sets_missing_values_but_preserves_existing(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text('ARK_API_KEY="file-key"\nARK_MODEL=deepseek-test\n', encoding="utf-8")
    monkeypatch.setenv("ARK_API_KEY", "existing-key")
    monkeypatch.delenv("ARK_MODEL", raising=False)
    load_env_file(env_file)
    assert os.environ["ARK_API_KEY"] == "existing-key"
    assert os.environ["ARK_MODEL"] == "deepseek-test"

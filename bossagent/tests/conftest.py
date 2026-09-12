from __future__ import annotations

import os
from datetime import datetime, timezone
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def project_root() -> Path:
    return PROJECT_ROOT


@pytest.fixture(autouse=True)
def stable_test_cwd(monkeypatch):
    monkeypatch.chdir(PROJECT_ROOT)


@pytest.fixture(autouse=True)
def mock_audit_writer(monkeypatch):
    """Keep normal tests independent from local PostgreSQL audit state."""
    import lakejob.safety.audit as audit_log
    import lakejob.safety.quota as quota_policy

    class FakeCursor:
        def execute(self, query, params=None):
            return None

        def fetchone(self):
            return ("test-audit-id",)

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def cursor(self):
            return FakeCursor()

    monkeypatch.setattr(audit_log, "db_conn", lambda: FakeConnection())
    monkeypatch.setattr(quota_policy, "clamp_run_limit", lambda value: max(0, int(value or 0)))


@pytest.fixture
def tmp_dir(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def temp_dir(tmp_path: Path) -> Path:
    return tmp_path


@pytest.fixture
def tmp_runtime_dir(tmp_path: Path) -> Path:
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    return runtime


@pytest.fixture
def mock_env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("LAKEJOB_AI_PROVIDER", "mock")
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    return os.environ.copy()


@pytest.fixture
def config():
    return {
        "jobradar": {
            "enabled": True,
            "mode": "mock",
            "dry_run": True,
            "allow_real_apply": False,
            "keyword": "Python",
            "city": "",
            "skills": "Python,FastAPI",
            "limit": 1,
        },
        "recruitradar": {
            "enabled": True,
            "mode": "mock",
            "dry_run": True,
            "allow_real_message": False,
            "keyword": "Python",
            "city": "",
            "skills": "Python,FastAPI",
            "limit": 1,
        },
        "resume_center": {"enabled": True},
        "system": {"safety_guard_enabled": True, "scheduler_enabled": False},
    }


@pytest.fixture
def fake_clock():
    return lambda: datetime(2026, 6, 11, 9, 0, tzinfo=timezone.utc)


@pytest.fixture
def fake_ai_provider():
    from lakejob.infrastructure.ai.mock_provider import MockAIProvider

    return MockAIProvider()


@pytest.fixture
def mock_adapter():
    class Adapter:
        def __init__(self, **kwargs):
            self.started = False

        def set_safety_context(self, **kwargs):
            return None

        def start(self):
            self.started = True

        def close(self):
            self.started = False

        def search_candidates(self, *args, **kwargs):
            return []

    return Adapter


@pytest.fixture
def test_client():
    from fastapi.testclient import TestClient
    from lakejob.app.console import app

    return TestClient(app)


def pytest_collection_modifyitems(config, items):
    if os.getenv("RUN_LIVE_TESTS") == "1":
        return
    marker = pytest.mark.skip(reason="live external test; set RUN_LIVE_TESTS=1")
    for item in items:
        if "live" in item.nodeid.lower():
            item.add_marker(marker)

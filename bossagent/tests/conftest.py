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
    """Keep normal tests independent from the local audit_logs migration state."""
    import audit_log
    import quota_policy

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
    monkeypatch.setattr(
        quota_policy,
        "clamp_run_limit",
        lambda value: max(0, int(value or 0)),
    )

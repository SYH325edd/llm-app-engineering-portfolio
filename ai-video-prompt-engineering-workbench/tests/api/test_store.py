from app.store import RunStore


def test_run_store_persists_and_lists_newest_first(tmp_path):
    store = RunStore(tmp_path)
    store.save({"run_id": "run-1", "created_at": "2026-09-15T10:00:00Z", "title": "A"})
    store.save({"run_id": "run-2", "created_at": "2026-09-15T11:00:00Z", "title": "B"})

    assert store.get("run-1")["title"] == "A"
    assert [row["run_id"] for row in store.list()] == ["run-2", "run-1"]


def test_run_store_rejects_path_like_run_id(tmp_path):
    store = RunStore(tmp_path)
    assert store.get("../secret") is None


def test_run_list_exposes_runtime_and_current_unit(tmp_path):
    store = RunStore(tmp_path)
    store.save({
        "run_id": "run_runtime20",
        "title": "Runtime",
        "status": "paused",
        "created_at": "2026-09-15T00:00:00Z",
        "updated_at": "2026-09-15T00:01:00Z",
        "runtime_version": "2.0",
        "framework_version": "1.3-frozen",
        "current_stage": "director",
        "current_unit": "director:SH012",
        "counts": {},
    })
    row = store.list()[0]
    assert row["runtime_version"] == "2.0"
    assert row["framework_version"] == "1.3-frozen"
    assert row["current_unit"] == "director:SH012"


def test_run_store_serializes_read_while_save_is_replacing(tmp_path, monkeypatch):
    import threading
    import time
    from pathlib import Path

    store = RunStore(tmp_path)
    store.save({"run_id": "run-lock", "created_at": "2026-09-16T00:00:00Z", "title": "old"})

    original_replace = Path.replace
    replace_entered = threading.Event()
    release_replace = threading.Event()
    read_finished = threading.Event()

    def blocking_replace(self, target):
        replace_entered.set()
        assert release_replace.wait(timeout=2)
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", blocking_replace)

    writer = threading.Thread(
        target=lambda: store.save({"run_id": "run-lock", "created_at": "2026-09-16T00:00:00Z", "title": "new"})
    )
    writer.start()
    assert replace_entered.wait(timeout=2)

    def reader():
        store.get("run-lock")
        read_finished.set()

    reader_thread = threading.Thread(target=reader)
    reader_thread.start()
    time.sleep(0.05)
    assert not read_finished.is_set()

    release_replace.set()
    writer.join(timeout=2)
    reader_thread.join(timeout=2)
    assert read_finished.is_set()
    assert store.get("run-lock")["title"] == "new"


def test_run_store_retries_transient_permission_error_on_replace(tmp_path, monkeypatch):
    from pathlib import Path

    store = RunStore(tmp_path)
    original_replace = Path.replace
    attempts = {"count": 0}

    def flaky_replace(self, target):
        attempts["count"] += 1
        if attempts["count"] < 3:
            exc = PermissionError(13, "temporary Windows file lock")
            exc.winerror = 5
            raise exc
        return original_replace(self, target)

    monkeypatch.setattr(Path, "replace", flaky_replace)
    store.save({"run_id": "run-retry", "created_at": "2026-09-16T00:00:00Z", "title": "ok"})

    assert attempts["count"] == 3
    assert store.get("run-retry")["title"] == "ok"

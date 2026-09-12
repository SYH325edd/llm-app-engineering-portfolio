from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
from pathlib import Path

from lakejob.paths import PROJECT_ROOT
from typing import Any

from .models import FinalResult, ResultLock, TaskRecord, utc_now_iso


ROOT = PROJECT_ROOT
DEFAULT_RUNTIME_DIR = Path(os.getenv("LAKEJOB_ORCHESTRATION_DIR", str(ROOT / "runtime" / "orchestration")))
_SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def canonical_json(data: Any) -> str:
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def sha256_json(data: Any) -> str:
    return hashlib.sha256(canonical_json(data).encode("utf-8")).hexdigest()


class OrchestrationStore:
    """Local JSON store with atomic writes and append-only hash-chained audit logs."""

    def __init__(self, base_dir: Path | str | None = None) -> None:
        self.base_dir = Path(base_dir or DEFAULT_RUNTIME_DIR)
        self.tasks_dir = self.base_dir / "tasks"
        self.audit_dir = self.base_dir / "audit"
        self.locks_dir = self.base_dir / "locked"
        self.secret_path = self.base_dir / ".lock_secret"
        for path in (self.tasks_dir, self.audit_dir, self.locks_dir):
            path.mkdir(parents=True, exist_ok=True)

    def _safe_task_id(self, task_id: str) -> str:
        if not _SAFE_ID.fullmatch(task_id):
            raise ValueError("invalid task id")
        return task_id

    def task_path(self, task_id: str) -> Path:
        return self.tasks_dir / f"{self._safe_task_id(task_id)}.json"

    def audit_path(self, task_id: str) -> Path:
        return self.audit_dir / f"{self._safe_task_id(task_id)}.jsonl"

    def lock_path(self, task_id: str) -> Path:
        return self.locks_dir / f"{self._safe_task_id(task_id)}.lock.json"

    def save(self, record: TaskRecord) -> Path:
        if record.status.value == "LOCKED" and self.lock_path(record.task_id).exists():
            if record.final_result is None:
                raise PermissionError("locked task must contain a final result")
            stored_lock = ResultLock.model_validate_json(
                self.lock_path(record.task_id).read_text(encoding="utf-8")
            )
            candidate_hash = sha256_json(record.final_result.model_dump(mode="json", exclude={"lock"}))
            if not hmac.compare_digest(stored_lock.content_hash, candidate_hash):
                raise PermissionError("locked task result cannot be modified")
        record.updated_at = utc_now_iso()
        path = self.task_path(record.task_id)
        self._atomic_write_json(path, record.model_dump(mode="json"))
        return path

    def load(self, task_id: str) -> TaskRecord:
        path = self.task_path(task_id)
        if not path.exists():
            raise FileNotFoundError(task_id)
        return TaskRecord.model_validate_json(path.read_text(encoding="utf-8"))

    def list_records(self, limit: int = 50) -> list[TaskRecord]:
        records: list[TaskRecord] = []
        paths = sorted(self.tasks_dir.glob("*.json"), key=lambda item: item.stat().st_mtime, reverse=True)
        for path in paths[: max(1, min(limit, 200))]:
            try:
                records.append(TaskRecord.model_validate_json(path.read_text(encoding="utf-8")))
            except Exception:
                continue
        return records

    def append_audit(self, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        path = self.audit_path(task_id)
        previous_hash = ""
        if path.exists():
            lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
            if lines:
                previous_hash = str(json.loads(lines[-1]).get("entry_hash") or "")
        entry = dict(payload)
        entry["previous_hash"] = previous_hash
        entry["entry_hash"] = sha256_json({key: value for key, value in entry.items() if key != "entry_hash"})
        with path.open("a", encoding="utf-8", newline="\n") as handle:
            handle.write(canonical_json(entry) + "\n")
            handle.flush()
            os.fsync(handle.fileno())
        return entry

    def verify_audit_chain(self, task_id: str) -> bool:
        path = self.audit_path(task_id)
        if not path.exists():
            return True
        previous_hash = ""
        for raw in path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            entry = json.loads(raw)
            if entry.get("previous_hash", "") != previous_hash:
                return False
            stored_hash = str(entry.get("entry_hash") or "")
            calculated = sha256_json({key: value for key, value in entry.items() if key != "entry_hash"})
            if not hmac.compare_digest(stored_hash, calculated):
                return False
            previous_hash = stored_hash
        return True

    def lock(self, record: TaskRecord, final_result: FinalResult) -> ResultLock:
        path = self.lock_path(record.task_id)
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8"))
            existing = ResultLock.model_validate(data)
            expected = sha256_json(final_result.model_dump(mode="json", exclude={"lock"}))
            if not hmac.compare_digest(existing.content_hash, expected):
                raise PermissionError("locked result hash mismatch")
            return existing

        payload = final_result.model_dump(mode="json", exclude={"lock"})
        content_hash = sha256_json(payload)
        signature = self._sign(content_hash)
        lock = ResultLock(
            locked=True,
            locked_at=utc_now_iso(),
            result_version=record.manifest.task_version if record.manifest else "1.0.0",
            content_hash=content_hash,
            signature=signature,
            modifiable=False,
            lock_file=str(path.relative_to(self.base_dir)),
        )
        self._atomic_write_json(path, lock.model_dump(mode="json"))
        try:
            path.chmod(0o444)
        except OSError:
            pass
        return lock

    def verify_lock(self, task_id: str) -> bool:
        record = self.load(task_id)
        if record.final_result is None or record.final_result.lock is None:
            return False
        lock_path = self.lock_path(task_id)
        if not lock_path.exists():
            return False
        stored = ResultLock.model_validate_json(lock_path.read_text(encoding="utf-8"))
        payload = record.final_result.model_dump(mode="json", exclude={"lock"})
        content_hash = sha256_json(payload)
        return (
            hmac.compare_digest(stored.content_hash, content_hash)
            and hmac.compare_digest(stored.signature, self._sign(content_hash))
            and self.verify_audit_chain(task_id)
        )

    def _secret(self) -> bytes:
        env_secret = os.getenv("LAKEJOB_RESULT_LOCK_SECRET")
        if env_secret:
            return env_secret.encode("utf-8")
        if not self.secret_path.exists():
            self.secret_path.parent.mkdir(parents=True, exist_ok=True)
            self.secret_path.write_text(secrets.token_hex(32), encoding="utf-8")
            try:
                self.secret_path.chmod(0o600)
            except OSError:
                pass
        return self.secret_path.read_text(encoding="utf-8").strip().encode("utf-8")

    def _sign(self, content_hash: str) -> str:
        return hmac.new(self._secret(), content_hash.encode("ascii"), hashlib.sha256).hexdigest()

    @staticmethod
    def _atomic_write_json(path: Path, data: dict[str, Any]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2, sort_keys=True)
            handle.write("\n")
            temp_path = Path(handle.name)
        os.replace(temp_path, path)

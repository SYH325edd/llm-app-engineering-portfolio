from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

_RUN_ID = re.compile(r"^[A-Za-z0-9_-]+$")
_REPLACE_ATTEMPTS = 6
_REPLACE_RETRY_SECONDS = 0.05


class RunStore:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def _path(self, run_id: str) -> Path | None:
        if not _RUN_ID.fullmatch(run_id or ""):
            return None
        return self.root / f"{run_id}.json"

    @staticmethod
    def _replace_with_retry(temp: Path, path: Path) -> None:
        for attempt in range(_REPLACE_ATTEMPTS):
            try:
                temp.replace(path)
                return
            except OSError as exc:
                transient_windows_lock = isinstance(exc, PermissionError) or getattr(exc, "winerror", None) in {5, 32}
                if not transient_windows_lock or attempt == _REPLACE_ATTEMPTS - 1:
                    raise
                time.sleep(_REPLACE_RETRY_SECONDS * (attempt + 1))

    def save(self, run: dict[str, Any]) -> dict[str, Any]:
        run_id = str(run.get("run_id", ""))
        path = self._path(run_id)
        if path is None:
            raise ValueError("invalid run_id")
        with self._lock:
            temp = path.with_suffix(".json.tmp")
            temp.write_text(json.dumps(run, ensure_ascii=False, indent=2), encoding="utf-8")
            self._replace_with_retry(temp, path)
        return run

    def get(self, run_id: str) -> dict[str, Any] | None:
        path = self._path(run_id)
        if path is None:
            return None
        with self._lock:
            if not path.exists():
                return None
            return json.loads(path.read_text(encoding="utf-8"))

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            rows: list[dict[str, Any]] = []
            for path in self.root.glob("*.json"):
                try:
                    row = json.loads(path.read_text(encoding="utf-8"))
                except (OSError, json.JSONDecodeError):
                    continue
                rows.append({
                    "run_id": row.get("run_id"),
                    "title": row.get("title"),
                    "status": row.get("status"),
                    "created_at": row.get("created_at"),
                    "updated_at": row.get("updated_at"),
                    "counts": row.get("counts", {}),
                    "runtime_version": row.get("runtime_version"),
                    "framework_version": row.get("framework_version"),
                    "build_id": row.get("build_id"),
                    "current_stage": row.get("current_stage"),
                    "current_unit": row.get("current_unit"),
                })
        rows.sort(key=lambda item: item.get("created_at") or "", reverse=True)
        return rows

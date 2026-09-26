from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

_SAFE = re.compile(r"[^A-Za-z0-9_.-]+")


def unit_input_hash(payload: Any) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _safe_unit_id(unit_id: str) -> str:
    return _SAFE.sub("__", unit_id)


class CheckpointStore:
    """File-backed unit checkpoints. One semantic unit = one recoverable record."""

    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def _run_dir(self, run_id: str) -> Path:
        path = self.root / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _path(self, run_id: str, unit_id: str) -> Path:
        return self._run_dir(run_id) / f"{_safe_unit_id(unit_id)}.json"

    def save(self, run_id: str, unit_id: str, record: dict[str, Any]) -> dict[str, Any]:
        path = self._path(run_id, unit_id)
        temp = path.with_suffix(".json.tmp")
        temp.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding="utf-8")
        temp.replace(path)
        return record

    def get(self, run_id: str, unit_id: str) -> dict[str, Any] | None:
        path = self._path(run_id, unit_id)
        if not path.exists():
            return None
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return value if isinstance(value, dict) else None

    def get_reusable(
        self,
        run_id: str,
        unit_id: str,
        payload: Any,
        *,
        contract_id: str | None = None,
    ) -> dict[str, Any] | None:
        """Return a completed checkpoint only when input and optional contract match.

        contract_id is intentionally independent from the global build id: a change
        in an unrelated stage must not invalidate validated work. The orchestrator
        may deterministically revalidate a legacy/different-contract record and
        promote it to the current contract without another model call.
        """
        record = self.get(run_id, unit_id)
        if not record or record.get("status") != "completed":
            return None
        if record.get("input_hash") != unit_input_hash(payload):
            return None
        if contract_id is not None and record.get("contract_id") != contract_id:
            return None
        return record

    def delete(self, run_id: str, unit_id: str) -> None:
        path = self._path(run_id, unit_id)
        if path.exists():
            path.unlink()

    def list(self, run_id: str) -> list[dict[str, Any]]:
        run_dir = self.root / run_id
        if not run_dir.exists():
            return []
        rows: list[dict[str, Any]] = []
        for path in sorted(run_dir.glob("*.json")):
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if isinstance(value, dict):
                rows.append(value)
        return rows

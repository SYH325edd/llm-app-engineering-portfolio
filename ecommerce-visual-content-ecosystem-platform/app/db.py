import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Optional

from .config import DB_PATH, resolve_data_path, to_data_relative


def now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")


@contextmanager
def _conn():
    con = sqlite3.connect(DB_PATH, timeout=30)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    try:
        yield con
        con.commit()
    finally:
        con.close()


def init_db():
    with _conn() as con:
        con.executescript(
            """
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT DEFAULT '',
                brand TEXT DEFAULT '',
                price TEXT DEFAULT '',
                selling_points TEXT DEFAULT '[]',
                product_params TEXT DEFAULT '{}',
                mode TEXT NOT NULL DEFAULT 'demo',
                status TEXT NOT NULL DEFAULT 'draft',
                product_profile TEXT,
                creative_plan TEXT,
                evidence_bundle TEXT,
                prompt_bundle TEXT,
                prompt_approved_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS assets (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                kind TEXT NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                local_path TEXT,
                remote_url TEXT,
                mime TEXT,
                metadata TEXT DEFAULT '{}',
                created_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                asset_type TEXT NOT NULL,
                label TEXT NOT NULL,
                purpose TEXT DEFAULT '',
                status TEXT NOT NULL DEFAULT 'pending',
                model_role TEXT DEFAULT '',
                prompt TEXT DEFAULT '',
                result_asset_id TEXT,
                qc_json TEXT,
                error TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
            );
            """
        )
        existing = {r['name'] for r in con.execute('PRAGMA table_info(projects)').fetchall()}
        for name, typ in [('evidence_bundle','TEXT'),('prompt_bundle','TEXT'),('prompt_approved_at','TEXT')]:
            if name not in existing:
                con.execute(f'ALTER TABLE projects ADD COLUMN {name} {typ}')


def _decode_project(row: sqlite3.Row) -> dict:
    d = dict(row)
    d["selling_points"] = json.loads(d.get("selling_points") or "[]")
    d["product_params"] = json.loads(d.get("product_params") or "{}")
    d["product_profile"] = json.loads(d["product_profile"]) if d.get("product_profile") else None
    d["creative_plan"] = json.loads(d["creative_plan"]) if d.get("creative_plan") else None
    d["evidence_bundle"] = json.loads(d["evidence_bundle"]) if d.get("evidence_bundle") else None
    d["prompt_bundle"] = json.loads(d["prompt_bundle"]) if d.get("prompt_bundle") else None
    return d


def create_project(payload: dict) -> dict:
    pid = "prj_" + uuid.uuid4().hex[:12]
    ts = now_iso()
    with _conn() as con:
        con.execute(
            """INSERT INTO projects
            (id,name,category,brand,price,selling_points,product_params,mode,status,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (
                pid,
                payload.get("name") or "未命名商品",
                payload.get("category") or "",
                payload.get("brand") or "",
                payload.get("price") or "",
                json.dumps(payload.get("selling_points") or [], ensure_ascii=False),
                json.dumps(payload.get("product_params") or {}, ensure_ascii=False),
                payload.get("mode") or "demo",
                "draft",
                ts,
                ts,
            ),
        )
    return get_project(pid)


def list_projects() -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM projects ORDER BY updated_at DESC").fetchall()
    return [_decode_project(r) for r in rows]


def get_project(project_id: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT * FROM projects WHERE id=?", (project_id,)).fetchone()
    return _decode_project(row) if row else None


def update_project(project_id: str, **fields):
    if not fields:
        return get_project(project_id)
    allowed = {
        "name", "category", "brand", "price", "selling_points", "product_params",
        "mode", "status", "product_profile", "creative_plan", "evidence_bundle", "prompt_bundle", "prompt_approved_at"
    }
    cols, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in {"selling_points", "product_params", "product_profile", "creative_plan", "evidence_bundle", "prompt_bundle"} and v is not None:
            v = json.dumps(v, ensure_ascii=False)
        cols.append(f"{k}=?")
        vals.append(v)
    cols.append("updated_at=?")
    vals.append(now_iso())
    vals.append(project_id)
    with _conn() as con:
        con.execute(f"UPDATE projects SET {', '.join(cols)} WHERE id=?", vals)
    return get_project(project_id)


def add_asset(project_id: str, kind: str, label: str, local_path: str | None = None,
              remote_url: str | None = None, mime: str | None = None, metadata: dict | None = None) -> dict:
    aid = "ast_" + uuid.uuid4().hex[:12]
    stored_path = to_data_relative(local_path) if local_path else None
    with _conn() as con:
        con.execute(
            "INSERT INTO assets VALUES (?,?,?,?,?,?,?,?,?)",
            (aid, project_id, kind, label, stored_path, remote_url, mime,
             json.dumps(metadata or {}, ensure_ascii=False), now_iso()),
        )
    return get_asset(aid)


def get_asset(asset_id: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT * FROM assets WHERE id=?", (asset_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["metadata"] = json.loads(d.get("metadata") or "{}")
    if d.get("local_path"):
        d["local_path"] = str(resolve_data_path(d["local_path"]))
    return d


def list_assets(project_id: str, kind: str | None = None) -> list[dict]:
    with _conn() as con:
        if kind:
            rows = con.execute("SELECT * FROM assets WHERE project_id=? AND kind=? ORDER BY created_at", (project_id, kind)).fetchall()
        else:
            rows = con.execute("SELECT * FROM assets WHERE project_id=? ORDER BY created_at", (project_id,)).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        d["metadata"] = json.loads(d.get("metadata") or "{}")
        if d.get("local_path"):
            d["local_path"] = str(resolve_data_path(d["local_path"]))
        out.append(d)
    return out


def update_asset_metadata(asset_id: str, metadata: dict) -> Optional[dict]:
    with _conn() as con:
        con.execute("UPDATE assets SET metadata=? WHERE id=?", (json.dumps(metadata or {}, ensure_ascii=False), asset_id))
    return get_asset(asset_id)


def delete_asset(asset_id: str):
    with _conn() as con:
        con.execute("DELETE FROM assets WHERE id=?", (asset_id,))


def delete_assets_by_kind(project_id: str, kind: str):
    with _conn() as con:
        con.execute("DELETE FROM assets WHERE project_id=? AND kind=?", (project_id, kind))


def create_task(project_id: str, asset_type: str, label: str, purpose: str, model_role: str, prompt: str) -> dict:
    tid = "tsk_" + uuid.uuid4().hex[:12]
    ts = now_iso()
    with _conn() as con:
        con.execute(
            "INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (tid, project_id, asset_type, label, purpose, "pending", model_role, prompt, None, None, None, ts, ts),
        )
    return get_task(tid)


def get_task(task_id: str) -> Optional[dict]:
    with _conn() as con:
        row = con.execute("SELECT * FROM tasks WHERE id=?", (task_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["qc"] = json.loads(d.pop("qc_json")) if d.get("qc_json") else None
    return d


def list_tasks(project_id: str) -> list[dict]:
    with _conn() as con:
        rows = con.execute("SELECT * FROM tasks WHERE project_id=? ORDER BY created_at", (project_id,)).fetchall()
    out = []
    for row in rows:
        d = dict(row)
        d["qc"] = json.loads(d.pop("qc_json")) if d.get("qc_json") else None
        out.append(d)
    return out


def update_task(task_id: str, **fields) -> dict:
    allowed = {"status", "prompt", "result_asset_id", "qc_json", "error"}
    cols, vals = [], []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k == "qc_json" and v is not None and not isinstance(v, str):
            v = json.dumps(v, ensure_ascii=False)
        cols.append(f"{k}=?")
        vals.append(v)
    cols.append("updated_at=?")
    vals.append(now_iso())
    vals.append(task_id)
    with _conn() as con:
        con.execute(f"UPDATE tasks SET {', '.join(cols)} WHERE id=?", vals)
    return get_task(task_id)


def reset_tasks(project_id: str):
    with _conn() as con:
        con.execute("DELETE FROM tasks WHERE project_id=?", (project_id,))


def delete_project(project_id: str):
    with _conn() as con:
        con.execute("DELETE FROM projects WHERE id=?", (project_id,))

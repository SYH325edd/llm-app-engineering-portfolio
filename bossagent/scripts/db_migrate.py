from __future__ import annotations

import argparse
import hashlib
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "migrations"


def migration_files() -> list[Path]:
    return sorted(path for path in MIGRATIONS.glob("[0-9]*.sql") if path.is_file())


def connect(database_url: str):
    try:
        import psycopg
        return psycopg.connect(database_url)
    except ImportError:
        import psycopg2
        return psycopg2.connect(database_url)


def _execute_script(cur, sql: str) -> None:
    cur.execute(sql)


def migrate(database_url: str, *, initialize: bool = True) -> list[str]:
    applied: list[str] = []
    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())")
            cur.execute("SELECT to_regclass('public.platforms')")
            row = cur.fetchone()
            if initialize and (not row or row[0] is None):
                _execute_script(cur, (MIGRATIONS / "schema.sql").read_text(encoding="utf-8"))
            for path in migration_files():
                sql = path.read_text(encoding="utf-8")
                checksum = hashlib.sha256(sql.encode("utf-8")).hexdigest()
                cur.execute("SELECT checksum FROM schema_migrations WHERE name = %s", (path.name,))
                existing = cur.fetchone()
                if existing:
                    if existing[0] != checksum:
                        raise RuntimeError(f"applied migration changed: {path.name}")
                    continue
                _execute_script(cur, sql)
                cur.execute("INSERT INTO schema_migrations(name, checksum) VALUES (%s, %s)", (path.name, checksum))
                applied.append(path.name)
        conn.commit()
    return applied


def main() -> int:
    parser = argparse.ArgumentParser(description="Initialize and migrate LakeJob PostgreSQL")
    parser.add_argument("--database-url", default=os.getenv("LAKEJOB_DATABASE_URL", ""))
    parser.add_argument("--no-initialize", action="store_true")
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or LAKEJOB_DATABASE_URL is required")
    applied = migrate(args.database_url, initialize=not args.no_initialize)
    print("PASS: " + (", ".join(applied) if applied else "database already current"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

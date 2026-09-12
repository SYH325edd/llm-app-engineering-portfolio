from __future__ import annotations

import os
from typing import Any, Callable


def _driver():
    try:
        import psycopg  # type: ignore

        return psycopg
    except ImportError:
        try:
            import psycopg2  # type: ignore

            return psycopg2
        except ImportError as exc:
            raise RuntimeError("Install psycopg or psycopg2 to use Web Console DB features") from exc


def get_db_connection():
    url = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("Set LAKEJOB_DATABASE_URL or DATABASE_URL")
    return _driver().connect(url)


def _column_name(description: Any) -> str:
    return getattr(description, "name", description[0])


def fetch_dicts(sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        columns = [_column_name(item) for item in cur.description]
        return [dict(zip(columns, row)) for row in cur.fetchall()]


def fetch_scalar(sql: str, params: tuple[Any, ...] = ()) -> Any:
    with get_db_connection() as conn:
        cur = conn.cursor()
        cur.execute(sql, params)
        row = cur.fetchone()
        return row[0] if row else 0


def fetch_one(sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    rows = fetch_dicts(sql, params)
    return rows[0] if rows else None


def db_safe(default: Any, fn: Callable[..., Any], *args: Any) -> Any:
    try:
        return fn(*args)
    except Exception as exc:
        return default if default != "ERR" else str(exc)

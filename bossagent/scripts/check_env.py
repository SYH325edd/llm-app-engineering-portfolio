"""Local development environment checks for LakeJob mock validation."""

from __future__ import annotations

import importlib.util
import os
import platform
import sys


def status(ok: bool, label: str, detail: str = "") -> bool:
    mark = "OK" if ok else "FAIL"
    suffix = f" - {detail}" if detail else ""
    print(f"[{mark}] {label}{suffix}")
    return ok


def importable(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def check_python() -> bool:
    version = platform.python_version()
    ok = sys.version_info >= (3, 10)
    return status(ok, "Python", f"{version} at {sys.executable}")


def check_database_url() -> bool:
    value = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not value:
        return status(False, "Database URL", "set LAKEJOB_DATABASE_URL or DATABASE_URL")
    safe = value.split("@")[-1] if "@" in value else value
    return status(True, "Database URL", safe)


def check_psycopg() -> tuple[bool, str | None]:
    if importable("psycopg"):
        return status(True, "psycopg", "psycopg v3 importable"), "psycopg"
    if importable("psycopg2"):
        return status(True, "psycopg2", "psycopg2 importable"), "psycopg2"
    return status(False, "PostgreSQL driver", "install psycopg[binary] or psycopg2-binary"), None


def check_db_connection(driver_name: str | None) -> bool:
    url = os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")
    if not url or not driver_name:
        return status(False, "Database connection", "skipped")
    try:
        driver = __import__(driver_name)
        conn = driver.connect(url)
        try:
            cur = conn.cursor()
            cur.execute("SELECT 1")
            cur.fetchone()
        finally:
            conn.close()
    except Exception as exc:
        return status(False, "Database connection", str(exc))
    return status(True, "Database connection", "SELECT 1 succeeded")


def check_playwright() -> bool:
    if importable("playwright.sync_api"):
        return status(True, "Playwright", "playwright.sync_api importable")
    return status(False, "Playwright", "install playwright and run: python -m playwright install firefox")


def check_ai_keys() -> bool:
    lakejob_key = bool(os.getenv("LAKEJOB_AI_API_KEY"))
    openai_key = bool(os.getenv("OPENAI_API_KEY"))
    if lakejob_key or openai_key:
        names = ", ".join(name for name, ok in {
            "LAKEJOB_AI_API_KEY": lakejob_key,
            "OPENAI_API_KEY": openai_key,
        }.items() if ok)
        return status(True, "AI API key", names)
    return status(False, "AI API key", "optional for RecruitRadar fallback, required for JobRadar AI")


def main() -> int:
    checks: list[bool] = []
    checks.append(check_python())
    checks.append(check_database_url())
    driver_ok, driver_name = check_psycopg()
    checks.append(driver_ok)
    checks.append(check_db_connection(driver_name))
    checks.append(check_playwright())
    checks.append(check_ai_keys())
    print()
    if all(checks[:5]):
        print("Environment is ready for LakeJob Core mock validation.")
        return 0
    print("Environment is not ready. Fix the failed required checks above.")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())

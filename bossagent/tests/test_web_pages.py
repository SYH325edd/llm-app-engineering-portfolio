"""Dependency-free merged-page acceptance checks."""

from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parent


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    source = (ROOT / "web_console.py").read_text(encoding="utf-8")
    routes = (
        "/control",
        "/auth-center",
        "/job",
        "/recruit",
        "/talent-pool",
        "/jobs",
        "/messages",
        "/message-drafts",
        "/ai-settings",
        "/scheduler",
        "/logs",
        "/config",
    )
    for route in routes:
        assert_true(f'@app.get("{route}")' in source, f"GET {route} is missing")

    templates = (
        "local_control.html",
        "job_flow.html",
        "recruit_flow.html",
        "talent_pool.html",
        "jobs.html",
        "messages.html",
        "message_drafts.html",
        "ai_settings.html",
        "scheduler.html",
        "logs.html",
        "config.html",
    )
    for name in templates:
        assert_true((ROOT / "templates" / name).is_file(), f"template missing: {name}")

    assert_true('"local_control.html"' in source, "/control or /auth-center template mapping is missing")
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

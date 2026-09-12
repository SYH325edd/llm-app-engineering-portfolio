"""Final aggregate acceptance runner for the LakeJob Local MVP.

The runner uses an explicit offline-safe allowlist. It never invokes browser
automation, real-message, real-apply, or real-mode smoke scripts.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def _test_python() -> str:
    candidates = (
        ROOT / "venv" / "Scripts" / "python.exe",
        ROOT / ".venv" / "Scripts" / "python.exe",
        ROOT / "venv" / "bin" / "python",
        ROOT / ".venv" / "bin" / "python",
    )
    return str(next((path for path in candidates if path.is_file()), Path(sys.executable)))


TEST_PYTHON = _test_python()

COMPILE_FILES = (
    "boss_auth_login.py",
    "auth_center.py",
    "web_console.py",
    "local_control.py",
    "i18n.py",
    "ai/provider.py",
    "ai/mock_provider.py",
    "ai/deepseek_provider.py",
    "match_analysis.py",
    "safety_guard.py",
    "scheduler.py",
    "test_web_pages.py",
    "test_ai_provider.py",
    "test_deepseek_live.py",
    "test_match_analysis.py",
    "test_safety_guard.py",
    "test_scheduler.py",
    "test_local_control.py",
    "test_auth_center.py",
    "test_page_responsibility.py",
    "test_release_safety.py",
)

TESTS = (
    ("Page巡检", "test_web_pages.py"),
    ("AI Provider", "test_ai_provider.py"),
    ("DeepSeek Live", "test_deepseek_live.py"),
    ("Match Analysis", "test_match_analysis.py"),
    ("Safety Guard", "test_safety_guard.py"),
    ("Scheduler", "test_scheduler.py"),
    ("Local Control", "test_local_control.py"),
    ("Auth Center", "test_auth_center.py"),
    ("Page Responsibility", "test_page_responsibility.py"),
    ("Release Safety", "test_release_safety.py"),
    ("Job Flow DB", "test_job_flow_db.py"),
    ("Recruit Flow DB", "test_recruit_flow_db.py"),
    ("Talent Pool DB", "test_talent_pool.py"),
)


def _run(command: list[str], *, timeout: int = 180) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    env["LAKEJOB_REAL_ACTIONS_DISABLED"] = "1"
    return subprocess.run(
        command,
        cwd=ROOT,
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )


def _failure_reason(result: subprocess.CompletedProcess[str]) -> str:
    output = "\n".join(part.strip() for part in (result.stdout, result.stderr) if part.strip())
    if not output:
        return f"exit code {result.returncode}"
    lines = output.splitlines()
    return " | ".join(lines[-6:])


def main() -> int:
    failures: list[tuple[str, str]] = []

    missing = [path for path in COMPILE_FILES if not (ROOT / path).is_file()]
    if missing:
        failures.append(("Static Compile", f"missing files: {', '.join(missing)}"))
        print(f"FAILED Static Compile: missing files: {', '.join(missing)}")
    else:
        compile_result = _run([TEST_PYTHON, "-m", "py_compile", *COMPILE_FILES])
        if compile_result.returncode == 0:
            print("PASSED Static Compile")
        else:
            reason = _failure_reason(compile_result)
            failures.append(("Static Compile", reason))
            print(f"FAILED Static Compile: {reason}")

    for name, script in TESTS:
        path = ROOT / script
        if not path.is_file():
            reason = f"missing test script: {script}"
            failures.append((name, reason))
            print(f"FAILED {name}: {reason}")
            continue
        try:
            result = _run([TEST_PYTHON, script])
        except subprocess.TimeoutExpired:
            reason = "timed out after 180 seconds"
            failures.append((name, reason))
            print(f"FAILED {name}: {reason}")
            continue

        output = "\n".join(part for part in (result.stdout, result.stderr) if part).strip()
        skipped = result.returncode == 0 and "SKIPPED" in output.upper()
        if skipped:
            first_skip = next((line.strip() for line in output.splitlines() if "SKIPPED" in line.upper()), "SKIPPED")
            print(f"SKIPPED {name}: {first_skip}")
        elif result.returncode == 0:
            print(f"PASSED {name}")
        else:
            reason = _failure_reason(result)
            failures.append((name, reason))
            print(f"FAILED {name}: {reason}")

    if failures:
        print("\nFailed tests:")
        for name, reason in failures:
            print(f"- {name}: {reason}")
        print("LOCAL_MVP_STATUS: FAILED")
        return 1

    print("LOCAL_MVP_STATUS: PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

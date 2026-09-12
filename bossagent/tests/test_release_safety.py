"""Offline release-safety checks for ignored state and risky launchers."""

from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    local_control = (ROOT / "local_control.py").read_text(encoding="utf-8")
    assert_true('["python"' not in local_control, 'local_control.py contains a hard-coded ["python" launcher')

    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")
    for entry in (
        "venv/",
        "venv_songyinghao/",
        "runtime/",
        "uploads/",
        ".env",
        "lakejobai-job-radar/.boss_profile/",
        "runtime/boss_chromium_profile/",
        "runtime/boss_auth_state.json",
    ):
        assert_true(entry in gitignore, f".gitignore missing {entry}")

    recruit_message_section = local_control.split('if action == "message_smoke":')[-1]
    assert_true('"jobradar"' not in recruit_message_section, "RecruitRadar message smoke falls through to JobRadar")

    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    assert_true(
        "Real BOSS Mode is experimental and not part of the stable Local MVP guarantee." in readme,
        "README missing Real BOSS experimental warning",
    )

    ignored_paths = ("runtime/release-test.json", "uploads/release-test.txt", "venv/release-test.exe")
    check = subprocess.run(
        ["git", "check-ignore", "--no-index", *ignored_paths],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    ignored = set(check.stdout.splitlines())
    assert_true(set(ignored_paths) <= ignored, "runtime/uploads/venv are not all ignored")

    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

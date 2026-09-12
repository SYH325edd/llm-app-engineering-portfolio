from __future__ import annotations

import fnmatch
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "runtime"


REQUIRED_FILES = [
    "README.md",
    ".gitignore",
    ".env.example",
    "runtime/.gitkeep",
]

REQUIRED_GITIGNORE_PATTERNS = [
    "venv/",
    "**pycache**/",
    "*.pyc",
    ".env",
    "runtime/*.json",
    "runtime/*.png",
    "runtime/*.html",
    "runtime/*.log",
    "runtime/debug_*",
    "*.db",
    "*.sqlite",
    "*.sqlite3",
    ".DS_Store",
    ".idea/",
    ".vscode/",
    ".venv/",
    ".pytest_cache/",
    "uploads/",
    "logs/",
    "lakejobai-job-radar/.boss_profile/",
]

SKIP_DIRS = {".git", "venv", ".venv", "env", "__pycache__"}


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT)).replace("\\", "/")


def iter_project_files():
    for path in ROOT.rglob("*"):
        if any(part in SKIP_DIRS for part in path.relative_to(ROOT).parts):
            continue
        yield path


def load_gitignore_patterns() -> set[str]:
    gitignore = ROOT / ".gitignore"
    if not gitignore.exists():
        return set()
    return {
        line.strip()
        for line in gitignore.read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }


def matches_any(path: Path, patterns: list[str]) -> bool:
    normalized = rel(path)
    name = path.name
    return any(fnmatch.fnmatch(normalized, pattern) or fnmatch.fnmatch(name, pattern) for pattern in patterns)


def tracked_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, text=True, capture_output=True, check=False
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git ls-files failed")
    return [ROOT / line for line in result.stdout.splitlines() if line.strip()]


def main() -> int:
    failures: list[str] = []
    warnings: list[str] = []

    for required in REQUIRED_FILES:
        if not (ROOT / required).exists():
            failures.append(f"missing required file: {required}")

    gitignore_patterns = load_gitignore_patterns()
    for pattern in REQUIRED_GITIGNORE_PATTERNS:
        if pattern not in gitignore_patterns:
            failures.append(f".gitignore missing pattern: {pattern}")

    if (ROOT / "venv").exists():
        warnings.append("venv/ exists locally; it is ignored and should not be committed")

    debug_patterns = [
        "runtime/*", "uploads/*", "logs/*", "**/.boss_profile/*",
        "**/browser_profile/*", "**/cookies*.json", "**/session*.json",
        "debug*.html", "debug*.png", "debug*.jpg", "debug*.jpeg",
        "*.db",
        "*.sqlite",
        "*.sqlite3",
        ".venv/*", "venv/*", "**/__pycache__/*", ".pytest_cache/*",
    ]
    for path in tracked_files():
        if path.is_file() and path != RUNTIME / ".gitkeep" and matches_any(path, debug_patterns):
            failures.append(f"forbidden tracked artifact: {rel(path)}")

    for warning in warnings:
        print(f"WARN: {warning}")

    if failures:
        print("FAIL")
        for failure in failures:
            print(f"- {failure}")
        return 1

    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

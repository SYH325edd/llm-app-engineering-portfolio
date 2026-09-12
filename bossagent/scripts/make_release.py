from __future__ import annotations

import argparse
import subprocess
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
DEFAULT_OUTPUT = DIST / "boss-agent-source.zip"
FORBIDDEN_PARTS = {
    ".git", ".venv", "venv", "env", "runtime", "uploads", "logs",
    "__pycache__", ".pytest_cache", ".boss_profile", "playwright-report", "test-results",
}
FORBIDDEN_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pyc", ".pyo", ".png", ".jpg", ".jpeg"}
FORBIDDEN_NAMES = {".env", "storage_state.json"}


def source_files() -> list[Path]:
    result = subprocess.run(["git", "ls-files", "--cached", "--others", "--exclude-standard"],
                            cwd=ROOT, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "git ls-files failed")
    files = []
    for raw in result.stdout.splitlines():
        rel = PurePosixPath(raw.strip())
        path = ROOT / Path(*rel.parts)
        if not raw.strip() or not path.is_file():
            continue
        if any(part in FORBIDDEN_PARTS for part in rel.parts):
            continue
        if rel.name in FORBIDDEN_NAMES or path.suffix.lower() in FORBIDDEN_SUFFIXES:
            continue
        if rel.parts and rel.parts[0] == "dist":
            continue
        files.append(path)
    return sorted(set(files))


def make_release(output: Path = DEFAULT_OUTPUT) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    files = source_files()
    if not files:
        raise RuntimeError("no clean source files found")
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a clean source-only release archive")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    output = make_release(args.output.resolve())
    print(f"PASS: created {output} with {len(source_files())} source files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

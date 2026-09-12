from __future__ import annotations

import argparse
import subprocess
import zipfile
from pathlib import Path, PurePosixPath


ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
DEFAULT_OUTPUT = DIST / "boss-agent-source.zip"
FORBIDDEN_ANYWHERE_PARTS = {
    ".git", ".venv", "venv", "env", "__pycache__", ".pytest_cache",
    ".boss_profile", "playwright-report", "test-results",
}
FORBIDDEN_TOP_LEVEL_PARTS = {"runtime", "uploads", "logs", "dist", "release"}
FORBIDDEN_SUFFIXES = {".db", ".sqlite", ".sqlite3", ".pyc", ".pyo", ".png", ".jpg", ".jpeg"}
FORBIDDEN_NAMES = {".env", "storage_state.json"}
def _allowed(path: Path) -> bool:
    try:
        rel_path = path.relative_to(ROOT)
    except ValueError:
        return False
    rel = PurePosixPath(rel_path.as_posix())
    if not path.is_file():
        return False
    if rel.parts and rel.parts[0] in FORBIDDEN_TOP_LEVEL_PARTS:
        return False
    if any(part in FORBIDDEN_ANYWHERE_PARTS or part.startswith(".pytest_") for part in rel.parts):
        return False
    if rel.name in FORBIDDEN_NAMES or path.suffix.lower() in FORBIDDEN_SUFFIXES:
        return False
    if rel.parts and rel.parts[0] == "dist":
        return False
    return True


def source_files() -> list[Path]:
    result = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    candidates: list[Path]
    if result.returncode == 0:
        candidates = []
        for raw in result.stdout.splitlines():
            value = raw.strip()
            if not value:
                continue
            rel = PurePosixPath(value)
            candidates.append(ROOT / Path(*rel.parts))
    else:
        # A distributed source archive does not contain .git. Fall back to a
        # filesystem scan while applying the same strict privacy exclusions.
        candidates = list(ROOT.rglob("*"))
    return sorted({path for path in candidates if _allowed(path)})


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

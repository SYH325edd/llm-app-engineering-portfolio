from __future__ import annotations

import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def _source_files(root: Path) -> list[Path]:
    files: set[Path] = set()
    direct = [root / "build_identity.py", root / "scripts" / "serve.py"]
    for path in direct:
        if path.is_file():
            files.add(path)
    for base, pattern in (
        (root / "runtime", "**/*.py"),
        (root / "apps" / "api" / "app", "**/*.py"),
        (root / "apps" / "web", "**/*"),
        (root / "packages" / "prompt_foundry_v13" / "src", "**/*.py"),
    ):
        if not base.exists():
            continue
        for path in base.glob(pattern):
            if path.is_file() and path.suffix in {".py", ".js", ".html", ".css"}:
                files.add(path)
    return sorted(files, key=lambda p: p.relative_to(root).as_posix())


def compute_build_id(root: str | Path | None = None) -> str:
    base = Path(root).resolve() if root is not None else ROOT
    digest = hashlib.sha256()
    for path in _source_files(base):
        relative = path.relative_to(base).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()[:12]


BUILD_ID = compute_build_id()

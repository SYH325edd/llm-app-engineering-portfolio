from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "packages" / "prompt_foundry_v13" / "src", ROOT / "apps" / "api"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from runtime.storyboard_overload_feedback import (  # noqa: E402
    build_storyboard_overload_feedback,
    write_storyboard_overload_feedback,
)


def _load_run(run_id: str, run_file: str) -> dict:
    path = Path(run_file).resolve() if run_file else ROOT / "data" / "runs" / f"{run_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"run not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def main() -> int:
    parser = argparse.ArgumentParser(description="Storyboard Overload Feedback v1 — shadow only")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--run-file", default="", help="explicit run JSON; otherwise data/runs/<run-id>.json")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    if not args.run_id and not args.run_file:
        parser.error("requires --run-id or --run-file")

    run = _load_run(args.run_id, args.run_file)
    feedback = build_storyboard_overload_feedback(run)
    run_id = str(feedback.get("run_id") or args.run_id or "run")
    output = Path(args.output).resolve() if args.output else ROOT / "data" / "storyboard-overload" / run_id / "feedback.json"
    write_storyboard_overload_feedback(output, feedback)
    print(json.dumps({
        "status": "ok",
        "mode": feedback["mode"],
        "run_id": run_id,
        "shot_count": feedback["shot_count"],
        "classification_counts": feedback["classification_counts"],
        "overloaded_shot_ids": feedback["overloaded_shot_ids"],
        "output": str(output),
        "automatic_storyboard_mutation": False,
        "next": "Use this shadow report to inspect safe FrozenTextUnit split boundaries. Do not activate automatic redistribution before calibration.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

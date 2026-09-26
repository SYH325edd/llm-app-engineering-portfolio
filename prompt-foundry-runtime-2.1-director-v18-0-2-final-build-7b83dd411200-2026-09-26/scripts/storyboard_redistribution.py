from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "packages" / "prompt_foundry_v13" / "src", ROOT / "apps" / "api"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from runtime.storyboard_redistribution import (  # noqa: E402
    build_storyboard_redistribution_plan,
    write_storyboard_redistribution_plan,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Storyboard Redistribution v1 — preview only")
    parser.add_argument("--run-id", default="")
    parser.add_argument("--feedback", default="", help="explicit overload feedback.json")
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    if not args.run_id and not args.feedback:
        parser.error("requires --run-id or --feedback")

    feedback_path = (
        Path(args.feedback).resolve()
        if args.feedback
        else ROOT / "data" / "storyboard-overload" / args.run_id / "feedback.json"
    )
    if not feedback_path.exists():
        raise FileNotFoundError(f"overload feedback not found: {feedback_path}")
    feedback = json.loads(feedback_path.read_text(encoding="utf-8"))
    plan = build_storyboard_redistribution_plan(feedback)
    run_id = str(plan.get("run_id") or args.run_id or "run")
    output = (
        Path(args.output).resolve()
        if args.output
        else ROOT / "data" / "storyboard-redistribution" / run_id / "plan.json"
    )
    write_storyboard_redistribution_plan(output, plan)
    print(json.dumps({
        "status": "ok" if (plan.get("validation") or {}).get("passed") else "invalid_plan",
        "mode": plan.get("mode"),
        "run_id": run_id,
        "overloaded_shot_count": plan.get("overloaded_shot_count"),
        "preview_ready_count": plan.get("preview_ready_count"),
        "blocked_count": plan.get("blocked_count"),
        "output": str(output),
        "automatic_storyboard_mutation": False,
        "apply_enabled": False,
        "next": "Review the preview plan only. Do not apply redistribution until the apply-stage contract is implemented and validated.",
    }, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

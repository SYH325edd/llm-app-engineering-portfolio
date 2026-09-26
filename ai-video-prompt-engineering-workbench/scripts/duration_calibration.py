from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
for path in (ROOT, ROOT / "packages" / "prompt_foundry_v13" / "src", ROOT / "apps" / "api"):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from runtime.duration_calibration import (  # noqa: E402
    build_calibration_batch,
    build_calibration_dataset,
    build_calibration_report,
    load_calibration_samples,
    write_calibration_batch_csv,
    write_calibration_batch_markdown,
    write_calibration_csv,
    write_calibration_json,
    write_calibration_report,
)


def _load_run(run_id: str, run_file: str) -> dict:
    path = Path(run_file).resolve() if run_file else ROOT / "data" / "runs" / f"{run_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"run not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _extract(args: argparse.Namespace) -> int:
    run = _load_run(args.run_id, args.run_file)
    dataset = build_calibration_dataset(run)
    run_id = str(dataset.get("run_id") or args.run_id or "run")
    out_dir = Path(args.output_dir).resolve() if args.output_dir else ROOT / "data" / "duration-calibration" / run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "samples.json"
    csv_path = out_dir / "samples.csv"
    write_calibration_json(json_path, dataset)
    write_calibration_csv(csv_path, dataset["samples"])
    print(json.dumps({
        "status": "ok",
        "run_id": run_id,
        "sample_count": dataset["sample_count"],
        "json": str(json_path),
        "csv": str(csv_path),
        "next": "Fill rendered_duration_seconds and the four completion columns after real Seedance 2.5 renders, then run report.",
    }, ensure_ascii=False))
    return 0


def _select(args: argparse.Namespace) -> int:
    run = _load_run(args.run_id, args.run_file)
    batch = build_calibration_batch(run, batch_size=args.batch_size)
    run_id = str(batch.get("run_id") or args.run_id or "run")
    out_dir = Path(args.output_dir).resolve() if args.output_dir else ROOT / "data" / "duration-calibration" / run_id / "batch-01"
    out_dir.mkdir(parents=True, exist_ok=True)
    json_path = out_dir / "batch.json"
    csv_path = out_dir / "batch.csv"
    md_path = out_dir / "prompts.md"
    write_calibration_json(json_path, batch)
    write_calibration_batch_csv(csv_path, batch["samples"])
    write_calibration_batch_markdown(md_path, batch)
    print(json.dumps({
        "status": "ok",
        "run_id": run_id,
        "selected_count": batch["selected_count"],
        "bucket_counts": batch["bucket_counts"],
        "json": str(json_path),
        "csv": str(csv_path),
        "prompts": str(md_path),
        "next": "Render these exact prompts in Seedance 2.5, fill the result columns in batch.csv, then run report --input batch.csv.",
    }, ensure_ascii=False))
    return 0


def _report(args: argparse.Namespace) -> int:
    source = Path(args.input).resolve()
    samples = load_calibration_samples(source)
    report = build_calibration_report(samples)
    target = Path(args.output).resolve() if args.output else source.with_name("report.json")
    write_calibration_report(target, report)
    print(json.dumps({"status": "ok", "report": str(target), **report}, ensure_ascii=False))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Seedance 2.5 Duration Calibration v1")
    sub = parser.add_subparsers(dest="command", required=True)

    extract = sub.add_parser("extract", help="extract editable calibration samples from a completed Prompt Foundry run")
    extract.add_argument("--run-id", default="")
    extract.add_argument("--run-file", default="", help="explicit run JSON; otherwise data/runs/<run-id>.json")
    extract.add_argument("--output-dir", default="")
    extract.set_defaults(func=_extract)

    select = sub.add_parser("select", help="select a deterministic safe/borderline/risk batch for real Seedance renders")
    select.add_argument("--run-id", default="")
    select.add_argument("--run-file", default="", help="explicit run JSON; otherwise data/runs/<run-id>.json")
    select.add_argument("--output-dir", default="")
    select.add_argument("--batch-size", type=int, default=10)
    select.set_defaults(func=_select)

    report = sub.add_parser("report", help="validate labeled samples and build a calibration report")
    report.add_argument("--input", required=True, help="samples.csv or samples.json")
    report.add_argument("--output", default="")
    report.set_defaults(func=_report)

    args = parser.parse_args()
    if args.command in {"extract", "select"} and not args.run_id and not args.run_file:
        parser.error(f"{args.command} requires --run-id or --run-file")
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

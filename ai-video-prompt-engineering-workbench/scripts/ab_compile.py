from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
if str(ROOT / "packages" / "prompt_foundry_v13" / "src") not in sys.path:
    sys.path.insert(0, str(ROOT / "packages" / "prompt_foundry_v13" / "src"))
if str(ROOT / "apps" / "api") not in sys.path:
    sys.path.insert(0, str(ROOT / "apps" / "api"))

from prompt_foundry_v1_3 import compile_project_v1_3  # noqa: E402
from runtime.consumption_compiler import compile_project_consumption_v1  # noqa: E402


def _load_run(run_id: str, run_file: str = "") -> dict[str, Any]:
    path = Path(run_file).resolve() if run_file else ROOT / "data" / "runs" / f"{run_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"run not found: {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _selected(ids: list[str], items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    wanted = set(ids)
    return [x for x in items if str(x.get("shot_id")) in wanted]


def _write_legacy(path: Path, shot_ids: list[str], legacy: dict[str, Any]) -> None:
    by_id = {str(x.get("shot_id")): x for x in legacy.get("shot_prompts", []) or []}
    lines = ["# A Legacy（旧版）Prompt（提示词）", ""]
    for sid in shot_ids:
        item = by_id.get(sid) or {}
        prompt = str(item.get("prompt_seedance") or "")
        lines.extend([f"## {sid}", "", f"- 字符数：{len(prompt)}", "", "```text", prompt, "```", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_consumption(path: Path, shot_ids: list[str], project: dict[str, Any]) -> None:
    by_id = {str(x.get("shot_id")): x for x in project.get("shot_prompts", []) or []}
    lines = ["# B Consumption（消费层）Prompt（提示词）", ""]
    for sid in shot_ids:
        item = by_id.get(sid) or {}
        status = item.get("compile_status") or "missing"
        lines.extend([f"## {sid}｜{status}", ""])
        for issue in item.get("errors", []) or []:
            lines.append(f"- Error（硬错误） `{issue.get('code')}`：{issue.get('detail', '')}")
        for issue in item.get("warnings", []) or []:
            lines.append(f"- Warning（警告） `{issue.get('code')}`：{issue.get('detail', '')}")
        prompt = item.get("prompt_seedance")
        if prompt:
            lines.extend(["", f"- 字符数：{len(prompt)}", "", "```text", str(prompt), "```", ""])
        else:
            lines.extend(["", "> 不输出。消费编译器不会替上游修正硬错误。", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def _write_diff(path: Path, shot_ids: list[str], legacy: dict[str, Any], project: dict[str, Any]) -> None:
    old = {str(x.get("shot_id")): x for x in legacy.get("shot_prompts", []) or []}
    new = {str(x.get("shot_id")): x for x in project.get("shot_prompts", []) or []}
    lines = ["# Diff Record（差异记录）", "", "| 镜头 | 旧版字符数 | 新版字符数 | 状态 | Error / Warning |", "|---|---:|---:|---|---|"]
    for sid in shot_ids:
        a = str((old.get(sid) or {}).get("prompt_seedance") or "")
        bitem = new.get(sid) or {}
        b = str(bitem.get("prompt_seedance") or "")
        codes = [x.get("code") for x in (bitem.get("errors", []) or []) + (bitem.get("warnings", []) or []) if x.get("code")]
        lines.append(f"| {sid} | {len(a)} | {len(b) if b else '—'} | {bitem.get('compile_status', 'missing')} | {', '.join(codes)} |")
    lines.extend(["", "## 编译原则", "", "- 只做选择、转换、压缩，不创造、不重写、不补剧情。", "- Error（硬错误）阻断当前镜头；Warning（警告）只留元数据，不进入最终 Prompt（提示词）。", "- 旧版与新版均来自同一个 Run（运行记录）的冻结上游数据。", ""])
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Prompt Foundry A/B compiler baseline")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--run-file", default="", help="optional explicit run JSON path; defaults to data/runs/<run-id>.json")
    parser.add_argument("--shots", required=True, help="comma-separated shot ids")
    parser.add_argument("--output-dir", default="")
    args = parser.parse_args()
    shot_ids = [x.strip() for x in args.shots.split(",") if x.strip()]
    run = _load_run(args.run_id, args.run_file)
    a = run.get("artifacts") or {}
    specs = _selected(shot_ids, a.get("shot_specs", []) or [])
    if len(specs) != len(shot_ids):
        found = {str(x.get("shot_id")) for x in specs}
        missing = [x for x in shot_ids if x not in found]
        raise ValueError(f"missing shots: {missing}")

    legacy = compile_project_v1_3(args.run_id, a["story_bible"], a["pvb"], a["psb"], a["style_guide"], specs, "production")
    consumption = compile_project_consumption_v1(args.run_id, a["story_bible"], a["script"], a["pvb"], a["psb"], a["style_guide"], specs)
    out = Path(args.output_dir) if args.output_dir else ROOT / "data" / "ab" / args.run_id
    out.mkdir(parents=True, exist_ok=True)
    _write_legacy(out / "A_legacy.md", shot_ids, legacy)
    _write_consumption(out / "B_consumption.md", shot_ids, consumption)
    _write_diff(out / "diff_record.md", shot_ids, legacy, consumption)
    print(json.dumps({"run_id": args.run_id, "shots": shot_ids, "output_dir": str(out), "summary": consumption.get("summary")}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

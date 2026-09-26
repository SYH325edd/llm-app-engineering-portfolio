from __future__ import annotations

import csv
import itertools
import json
import re
from pathlib import Path
from typing import Any, Iterable

from runtime.consumption_lint import estimate_min_duration

CALIBRATION_SCHEMA_VERSION = "duration_calibration.v1"
CALIBRATION_REPORT_VERSION = "duration_calibration_report.v1"
CALIBRATION_BATCH_VERSION = "duration_calibration_batch.v1"
MIN_CALIBRATION_SAMPLES = 30
DEFAULT_CALIBRATION_BATCH_SIZE = 10

_REACTION_TOKENS = (
    "微笑", "摇头", "点头", "抬眼", "抬头", "低头", "看向", "盯着", "皱眉", "眨眼",
    "停顿", "停住", "停下", "犹豫", "后退", "前倾", "吞咽", "呼吸", "嘴唇", "肩膀",
    "发抖", "颤", "愣", "怔", "沉默", "避开视线", "移开视线", "收回视线",
)

BATCH_CSV_FIELDS = [
    "batch_version",
    "selection_bucket",
    "selection_reason",
    "w003_ratio",
    "w003_overflow_seconds",
    "prompt_seedance",
]

CSV_FIELDS = [
    "schema_version",
    "sample_id",
    "run_id",
    "build_id",
    "shot_id",
    "scene_id",
    "planned_duration_seconds",
    "rendered_duration_seconds",
    "dialogue_char_count",
    "narration_char_count",
    "speech_char_count",
    "visible_action_count",
    "reaction_count",
    "transition_count",
    "current_w003_estimate_seconds",
    "speech_completed",
    "action_completed",
    "reaction_completed",
    "overall_renderable",
    "actual_notes",
]


def _text_char_count(value: Any) -> int:
    text = str(value or "")
    return len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", text))


def _narration_text(shot: dict[str, Any]) -> str:
    raw = shot.get("narration")
    if isinstance(raw, str):
        return raw
    if isinstance(raw, list):
        return "".join(str(x) for x in raw if isinstance(x, str))
    return ""


def _dialogue_text(shot: dict[str, Any]) -> str:
    lines: list[str] = []
    for item in shot.get("dialogue", []) or []:
        if not isinstance(item, dict):
            continue
        line = item.get("line") if item.get("line") is not None else item.get("text")
        if isinstance(line, str):
            lines.append(line)
    return "".join(lines)


def _is_reaction(action: dict[str, Any], reaction_targets: set[str]) -> bool:
    ref = str(action.get("character_ref") or "")
    if ref and ref in reaction_targets:
        return True
    text = str(action.get("action") or "")
    return any(token in text for token in _REACTION_TOKENS)


def extract_duration_features(shot: dict[str, Any]) -> dict[str, int]:
    """Extract deterministic calibration features without changing W003.

    visible_action_count and reaction_count partition Director performance_actions:
    a performance action is counted as a reaction when it belongs to a declared
    reaction target or contains a small, generic visible-reaction cue. transition_count
    counts hand-offs between visible performance units plus one non-static camera move.
    """
    dialogue_chars = _text_char_count(_dialogue_text(shot))
    narration_chars = _text_char_count(_narration_text(shot))

    director = shot.get("director") or {}
    reaction_targets = {
        str(x) for x in director.get("reaction_target_refs", []) or [] if isinstance(x, str) and x
    }
    action_count = 0
    reaction_count = 0
    for item in director.get("performance_actions", []) or []:
        if not isinstance(item, dict) or not str(item.get("action") or "").strip():
            continue
        if _is_reaction(item, reaction_targets):
            reaction_count += 1
        else:
            action_count += 1

    performance_units = action_count + reaction_count
    transition_count = max(0, performance_units - 1)
    movement = str(shot.get("movement") or "").strip().lower()
    if movement and movement not in {"static", "fixed", "none", "无", "固定"}:
        transition_count += 1

    return {
        "dialogue_char_count": dialogue_chars,
        "narration_char_count": narration_chars,
        "speech_char_count": dialogue_chars + narration_chars,
        "visible_action_count": action_count,
        "reaction_count": reaction_count,
        "transition_count": transition_count,
    }


def build_duration_sample(
    shot: dict[str, Any],
    *,
    run_id: str,
    build_id: str = "",
) -> dict[str, Any]:
    shot_id = str(shot.get("shot_id") or "")
    if not shot_id:
        raise ValueError("duration calibration sample requires shot_id")
    planned = float(shot.get("duration") or 0.0)
    features = extract_duration_features(shot)
    return {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "sample_id": f"{run_id}:{shot_id}" if run_id else shot_id,
        "run_id": str(run_id or ""),
        "build_id": str(build_id or ""),
        "shot_id": shot_id,
        "scene_id": str(shot.get("scene_id") or ""),
        "planned_duration_seconds": planned,
        "rendered_duration_seconds": None,
        **features,
        "current_w003_estimate_seconds": float(estimate_min_duration(shot)),
        "speech_completed": None,
        "action_completed": None,
        "reaction_completed": None,
        "overall_renderable": None,
        "actual_notes": "",
    }


def build_calibration_dataset(run: dict[str, Any]) -> dict[str, Any]:
    artifacts = run.get("artifacts") or {}
    shots = artifacts.get("shot_specs") or []
    if not isinstance(shots, list):
        raise ValueError("run.artifacts.shot_specs must be a list")
    run_id = str(run.get("run_id") or "")
    build_id = str(run.get("build_id") or "")
    samples = [
        build_duration_sample(shot, run_id=run_id, build_id=build_id)
        for shot in shots
        if isinstance(shot, dict)
    ]
    return {
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "run_id": run_id,
        "build_id": build_id,
        "minimum_samples_for_candidate": MIN_CALIBRATION_SAMPLES,
        "sample_count": len(samples),
        "samples": samples,
    }


def _parse_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if not text:
        return None
    if text in {"true", "1", "yes", "y", "pass", "完成", "是"}:
        return True
    if text in {"false", "0", "no", "n", "fail", "未完成", "否"}:
        return False
    raise ValueError(f"invalid boolean calibration value: {value!r}")


def _parse_float(value: Any, *, nullable: bool = False) -> float | None:
    if value is None or str(value).strip() == "":
        if nullable:
            return None
        return 0.0
    return float(value)


def normalize_sample(sample: dict[str, Any]) -> dict[str, Any]:
    out = dict(sample)
    out["schema_version"] = str(out.get("schema_version") or CALIBRATION_SCHEMA_VERSION)
    if out["schema_version"] != CALIBRATION_SCHEMA_VERSION:
        raise ValueError(f"unsupported duration calibration schema: {out['schema_version']}")
    for field in (
        "planned_duration_seconds",
        "dialogue_char_count",
        "narration_char_count",
        "speech_char_count",
        "visible_action_count",
        "reaction_count",
        "transition_count",
        "current_w003_estimate_seconds",
    ):
        out[field] = _parse_float(out.get(field))
    out["rendered_duration_seconds"] = _parse_float(out.get("rendered_duration_seconds"), nullable=True)
    for field in ("speech_completed", "action_completed", "reaction_completed", "overall_renderable"):
        out[field] = _parse_bool(out.get(field))
    out["actual_notes"] = str(out.get("actual_notes") or "")
    for field in ("sample_id", "run_id", "build_id", "shot_id", "scene_id"):
        out[field] = str(out.get(field) or "")
    if not out["sample_id"] or not out["shot_id"]:
        raise ValueError("calibration sample requires sample_id and shot_id")
    return out


def load_calibration_samples(path: str | Path) -> list[dict[str, Any]]:
    source = Path(path)
    if source.suffix.lower() == ".csv":
        with source.open("r", encoding="utf-8-sig", newline="") as fh:
            return [normalize_sample(row) for row in csv.DictReader(fh)]
    data = json.loads(source.read_text(encoding="utf-8"))
    raw = data.get("samples") if isinstance(data, dict) else data
    if not isinstance(raw, list):
        raise ValueError("duration calibration JSON must contain a samples list")
    return [normalize_sample(item) for item in raw if isinstance(item, dict)]


def write_calibration_json(path: str | Path, dataset: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(dataset, ensure_ascii=False, indent=2), encoding="utf-8")


def write_calibration_csv(path: str | Path, samples: Iterable[dict[str, Any]]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for sample in samples:
            writer.writerow(sample)


def _w003_ratio(sample: dict[str, Any]) -> float:
    planned = float(sample.get("planned_duration_seconds") or 0.0)
    estimate = float(sample.get("current_w003_estimate_seconds") or 0.0)
    if planned <= 0.0:
        return float("inf") if estimate > 0.0 else 0.0
    return estimate / planned


def _selection_bucket(sample: dict[str, Any]) -> str:
    ratio = _w003_ratio(sample)
    if ratio <= 0.85:
        return "safe"
    if ratio <= 1.15:
        return "borderline"
    return "risk"


def _feature_richness(sample: dict[str, Any]) -> int:
    return sum(
        1
        for field in ("speech_char_count", "visible_action_count", "reaction_count")
        if float(sample.get(field) or 0.0) > 0.0
    )


def _bucket_sort_key(sample: dict[str, Any], bucket: str) -> tuple[Any, ...]:
    ratio = _w003_ratio(sample)
    richness = _feature_richness(sample)
    shot_id = str(sample.get("shot_id") or "")
    if bucket == "risk":
        return (-richness, -ratio, shot_id)
    if bucket == "borderline":
        return (abs(ratio - 1.0), -richness, shot_id)
    return (-richness, ratio, shot_id)


def _batch_quotas(batch_size: int) -> dict[str, int]:
    size = max(1, int(batch_size))
    risk = max(1, round(size * 0.4))
    borderline = max(1, round(size * 0.3)) if size >= 3 else 0
    safe = max(0, size - risk - borderline)
    return {"safe": safe, "borderline": borderline, "risk": risk}


def select_calibration_samples(
    samples: list[dict[str, Any]],
    *,
    batch_size: int = DEFAULT_CALIBRATION_BATCH_SIZE,
) -> list[dict[str, Any]]:
    """Select a deterministic, W003-stratified real-render calibration batch.

    This is a sampling helper only. It does not change W003, Storyboard allocation,
    or any production artifact. The selector intentionally includes predicted-safe,
    near-threshold, and predicted-risk shots so real Seedance labels contain both
    positive and negative evidence.
    """
    normalized = [normalize_sample(sample) for sample in samples]
    if not normalized:
        return []
    size = min(max(1, int(batch_size)), len(normalized))
    buckets: dict[str, list[dict[str, Any]]] = {"safe": [], "borderline": [], "risk": []}
    for sample in normalized:
        bucket = _selection_bucket(sample)
        buckets[bucket].append(sample)
    for bucket, items in buckets.items():
        items.sort(key=lambda item, bucket=bucket: _bucket_sort_key(item, bucket))

    selected: list[dict[str, Any]] = []
    selected_ids: set[str] = set()
    for bucket, quota in _batch_quotas(size).items():
        for sample in buckets[bucket][:quota]:
            selected.append(sample)
            selected_ids.add(str(sample["sample_id"]))

    if len(selected) < size:
        remainder = [sample for sample in normalized if str(sample["sample_id"]) not in selected_ids]
        remainder.sort(
            key=lambda sample: (
                -_feature_richness(sample),
                abs(_w003_ratio(sample) - 1.0),
                str(sample.get("shot_id") or ""),
            )
        )
        selected.extend(remainder[: size - len(selected)])

    selected.sort(key=lambda sample: str(sample.get("shot_id") or ""))
    return selected


def _shot_prompt_map(run: dict[str, Any]) -> dict[str, str]:
    artifacts = run.get("artifacts") or {}
    compiled = artifacts.get("compiled_project") or {}
    prompts = compiled.get("shot_prompts") or [] if isinstance(compiled, dict) else []
    out: dict[str, str] = {}
    for item in prompts:
        if not isinstance(item, dict):
            continue
        shot_id = str(item.get("shot_id") or "")
        prompt = item.get("prompt_seedance")
        if shot_id and isinstance(prompt, str):
            out[shot_id] = prompt
    return out


def build_calibration_batch(
    run: dict[str, Any],
    *,
    batch_size: int = DEFAULT_CALIBRATION_BATCH_SIZE,
) -> dict[str, Any]:
    dataset = build_calibration_dataset(run)
    selected = select_calibration_samples(dataset["samples"], batch_size=batch_size)
    prompt_map = _shot_prompt_map(run)
    rows: list[dict[str, Any]] = []
    counts = {"safe": 0, "borderline": 0, "risk": 0}
    for sample in selected:
        bucket = _selection_bucket(sample)
        counts[bucket] += 1
        ratio = _w003_ratio(sample)
        estimate = float(sample.get("current_w003_estimate_seconds") or 0.0)
        planned = float(sample.get("planned_duration_seconds") or 0.0)
        row = dict(sample)
        row.update({
            "batch_version": CALIBRATION_BATCH_VERSION,
            "selection_bucket": bucket,
            "selection_reason": {
                "safe": "predicted_safe_baseline",
                "borderline": "near_w003_threshold",
                "risk": "predicted_duration_risk",
            }[bucket],
            "w003_ratio": None if ratio == float("inf") else round(ratio, 4),
            "w003_overflow_seconds": round(estimate - planned, 3),
            "prompt_seedance": prompt_map.get(str(sample.get("shot_id") or ""), ""),
        })
        rows.append(row)
    return {
        "batch_version": CALIBRATION_BATCH_VERSION,
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "run_id": dataset["run_id"],
        "build_id": dataset["build_id"],
        "requested_batch_size": int(batch_size),
        "selected_count": len(rows),
        "bucket_counts": counts,
        "policy": {
            "sampling_only": True,
            "automatic_storyboard_feedback": False,
            "automatic_w003_parameter_update": False,
        },
        "samples": rows,
    }


def write_calibration_batch_csv(path: str | Path, samples: Iterable[dict[str, Any]]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    fields = BATCH_CSV_FIELDS + CSV_FIELDS
    with target.open("w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for sample in samples:
            writer.writerow(sample)


def write_calibration_batch_markdown(path: str | Path, batch: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Seedance 2.5 Duration Calibration Batch",
        "",
        f"Run: {batch.get('run_id') or '-'}",
        f"Build: {batch.get('build_id') or '-'}",
        f"Selected: {batch.get('selected_count') or 0}",
        "",
        "Use each prompt without rewriting it. After rendering, fill the CSV result columns and run the existing `report` command.",
        "",
    ]
    for index, sample in enumerate(batch.get("samples") or [], start=1):
        lines.extend([
            f"## {index:02d}. {sample.get('shot_id') or '-'} · {sample.get('selection_bucket') or '-'}",
            "",
            f"Planned: {sample.get('planned_duration_seconds')}s · W003: {sample.get('current_w003_estimate_seconds')}s · overflow: {sample.get('w003_overflow_seconds')}s",
            "",
            "```text",
            str(sample.get("prompt_seedance") or "[prompt_seedance unavailable in run artifact]"),
            "```",
            "",
        ])
    target.write_text("\n".join(lines), encoding="utf-8")


def _effective_duration(sample: dict[str, Any]) -> float:
    rendered = sample.get("rendered_duration_seconds")
    if rendered is not None:
        return float(rendered)
    return float(sample.get("planned_duration_seconds") or 0.0)


def _balanced_accuracy(pairs: list[tuple[bool, bool]]) -> float | None:
    if not pairs:
        return None
    positives = [(pred, actual) for pred, actual in pairs if actual]
    negatives = [(pred, actual) for pred, actual in pairs if not actual]
    if positives and negatives:
        tpr = sum(1 for pred, _ in positives if pred) / len(positives)
        tnr = sum(1 for pred, _ in negatives if not pred) / len(negatives)
        return (tpr + tnr) / 2.0
    return sum(1 for pred, actual in pairs if pred == actual) / len(pairs)


def _candidate_required_duration(sample: dict[str, Any], params: dict[str, float]) -> float:
    speech = float(sample.get("speech_char_count") or 0.0) / params["speech_rate_chars_per_second"]
    action = float(sample.get("visible_action_count") or 0.0) * params["action_cost_seconds"]
    reaction = float(sample.get("reaction_count") or 0.0) * params["reaction_cost_seconds"]
    transition = float(sample.get("transition_count") or 0.0) * params["transition_cost_seconds"]
    return speech + action + reaction + transition


def _score_candidate(samples: list[dict[str, Any]], params: dict[str, float]) -> float:
    labels = {
        "speech_completed": [],
        "action_completed": [],
        "reaction_completed": [],
        "overall_renderable": [],
    }
    for sample in samples:
        duration = _effective_duration(sample)
        speech_required = float(sample.get("speech_char_count") or 0.0) / params["speech_rate_chars_per_second"]
        action_required = float(sample.get("visible_action_count") or 0.0) * params["action_cost_seconds"]
        reaction_required = float(sample.get("reaction_count") or 0.0) * params["reaction_cost_seconds"]
        overall_required = _candidate_required_duration(sample, params)
        predictions = {
            "speech_completed": duration + 1e-9 >= speech_required,
            "action_completed": duration + 1e-9 >= action_required,
            "reaction_completed": duration + 1e-9 >= reaction_required,
            "overall_renderable": duration + 1e-9 >= overall_required,
        }
        for field, bucket in labels.items():
            actual = sample.get(field)
            if isinstance(actual, bool):
                bucket.append((predictions[field], actual))
    scores = [score for pairs in labels.values() if (score := _balanced_accuracy(pairs)) is not None]
    return sum(scores) / len(scores) if scores else 0.0


def fit_candidate_parameters(samples: list[dict[str, Any]]) -> dict[str, Any] | None:
    completed = [s for s in samples if isinstance(s.get("overall_renderable"), bool)]
    outcomes = {bool(s["overall_renderable"]) for s in completed}
    if len(completed) < MIN_CALIBRATION_SAMPLES or len(outcomes) < 2:
        return None

    grids = {
        "speech_rate_chars_per_second": (3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0),
        "action_cost_seconds": (0.4, 0.6, 0.8, 1.0, 1.2, 1.5),
        "reaction_cost_seconds": (0.3, 0.5, 0.7, 0.9, 1.1),
        "transition_cost_seconds": (0.1, 0.3, 0.5, 0.7, 0.9),
    }
    keys = tuple(grids)
    best: tuple[float, dict[str, float]] | None = None
    for values in itertools.product(*(grids[key] for key in keys)):
        params = dict(zip(keys, values))
        score = _score_candidate(completed, params)
        # Stable tie-break: prefer parameters nearest the current heuristic scale,
        # but never write them back automatically.
        distance = (
            abs(params["speech_rate_chars_per_second"] - 4.5)
            + abs(params["action_cost_seconds"] - 0.7)
            + abs(params["reaction_cost_seconds"] - 0.5)
            + abs(params["transition_cost_seconds"] - 0.6)
        )
        rank = (round(score, 8), -round(distance, 8))
        if best is None or rank > (round(best[0], 8), -round(best[1]["_distance"], 8)):
            params["_distance"] = distance
            best = (score, params)
    if best is None:
        return None
    score, params = best
    params = {key: float(params[key]) for key in keys}
    return {
        "status": "candidate_only",
        "sample_count": len(completed),
        "fit_score": round(score, 4),
        "parameters": params,
        "applied_to_w003": False,
    }


def build_calibration_report(samples: list[dict[str, Any]]) -> dict[str, Any]:
    normalized = [normalize_sample(sample) for sample in samples]
    completed = [s for s in normalized if isinstance(s.get("overall_renderable"), bool)]
    candidate = fit_candidate_parameters(normalized)
    overall_outcomes = {bool(s["overall_renderable"]) for s in completed}

    def _rate(field: str) -> float | None:
        values = [s[field] for s in normalized if isinstance(s.get(field), bool)]
        if not values:
            return None
        return round(sum(1 for value in values if value) / len(values), 4)

    w003_pairs: list[tuple[bool, bool]] = []
    for sample in completed:
        prediction = _effective_duration(sample) + 1e-9 >= float(sample.get("current_w003_estimate_seconds") or 0.0)
        w003_pairs.append((prediction, bool(sample["overall_renderable"])))

    return {
        "report_version": CALIBRATION_REPORT_VERSION,
        "schema_version": CALIBRATION_SCHEMA_VERSION,
        "status": (
            "candidate_ready"
            if candidate
            else "insufficient_variation"
            if len(completed) >= MIN_CALIBRATION_SAMPLES and len(overall_outcomes) < 2
            else "collecting"
        ),
        "minimum_samples_for_candidate": MIN_CALIBRATION_SAMPLES,
        "requires_pass_and_fail_outcomes": True,
        "total_samples": len(normalized),
        "completed_samples": len(completed),
        "samples_needed": max(0, MIN_CALIBRATION_SAMPLES - len(completed)),
        "completion_rates": {
            "speech_completed": _rate("speech_completed"),
            "action_completed": _rate("action_completed"),
            "reaction_completed": _rate("reaction_completed"),
            "overall_renderable": _rate("overall_renderable"),
        },
        "current_w003_baseline": {
            "balanced_accuracy": None if not w003_pairs else round(float(_balanced_accuracy(w003_pairs) or 0.0), 4),
            "applied_changes": False,
        },
        "candidate_calibration": candidate,
        "policy": {
            "warning_only": True,
            "automatic_storyboard_feedback": False,
            "automatic_w003_parameter_update": False,
        },
    }


def write_calibration_report(path: str | Path, report: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

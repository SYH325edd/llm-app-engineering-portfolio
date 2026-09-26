from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from runtime.consumption_lint import estimate_min_duration
from runtime.stages.storyboard import build_frozen_text_units

CONTRACT_VERSION = "storyboard_overload_feedback.v1-shadow"
MODE = "shadow_only"

# Provisional thresholds only. They deliberately do not replace W003 and do not
# mutate Storyboard. Real Seedance calibration may change these values later.
WARNING_GAP_SECONDS = 0.25
OVERLOAD_MIN_RATIO = 1.35
OVERLOAD_MIN_GAP_SECONDS = 1.5


def _text_char_count(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", str(text or "")))


def _script_scene_map(script: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(scene.get("scene_id") or ""): scene
        for scene in (script.get("scenes") or [])
        if isinstance(scene, dict) and scene.get("scene_id")
    }


def _unit_index(script_scene: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(unit.get("unit_id")): unit
        for group in build_frozen_text_units(script_scene).values()
        for channel in ("dialogue", "narration")
        for unit in (group.get(channel) or [])
        if isinstance(unit, dict) and unit.get("unit_id")
    }


def _narration_baseline_seconds(shot: dict[str, Any]) -> float:
    narration = shot.get("narration") or []
    if isinstance(narration, str):
        texts = [narration]
    elif isinstance(narration, list):
        texts = [str(x) for x in narration if isinstance(x, str) and x]
    else:
        texts = []
    text = "".join(texts)
    if not text:
        return 0.0
    chars = _text_char_count(text)
    punctuation_cost = 0.15 * len(re.findall(r"[，、,]", text))
    punctuation_cost += 0.35 * len(re.findall(r"[。！？!?]", text))
    # Mirrors the current W003 speech-rate baseline, but remains shadow-only.
    return round((chars / 4.5 + punctuation_cost) * 1.2, 2)


def _classify(current: float, estimate: float) -> str:
    if current <= 0:
        return "unknown"
    gap = estimate - current
    if gap <= WARNING_GAP_SECONDS:
        return "normal"
    ratio = estimate / current
    if ratio >= OVERLOAD_MIN_RATIO and gap >= OVERLOAD_MIN_GAP_SECONDS:
        return "overloaded"
    return "warning"


def _atomic_groups(shot: dict[str, Any], unit_index: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    refs = shot.get("frozen_text_unit_refs") or {}
    dialogue_refs = [str(x) for x in (refs.get("dialogue") or []) if isinstance(x, str) and x]
    narration_refs = [str(x) for x in (refs.get("narration") or []) if isinstance(x, str) and x]

    groups: list[dict[str, Any]] = []
    for ref in dialogue_refs:
        unit = unit_index.get(ref)
        if not unit or unit.get("channel") != "dialogue":
            continue
        text = str(unit.get("text") or "")
        groups.append({
            "segment_id": f"SEG{len(groups) + 1:02d}",
            "channel": "dialogue",
            "utterance_group_id": str(unit.get("utterance_group_id") or "") or None,
            "character_id": str(unit.get("character_id") or "") or None,
            "unit_refs": [ref],
            "texts": [text],
            "speech_char_count": _text_char_count(text),
            "text": text,
            "atomic": True,
        })

    for ref in narration_refs:
        unit = unit_index.get(ref)
        if not unit or unit.get("channel") != "narration":
            continue
        text = str(unit.get("text") or "")
        groups.append({
            "segment_id": f"SEG{len(groups) + 1:02d}",
            "channel": "narration",
            "utterance_group_id": None,
            "unit_refs": [ref],
            "texts": [text],
            "speech_char_count": _text_char_count(text),
            "text": text,
            "atomic": True,
        })
    return groups


def _resolution_for(groups: list[dict[str, Any]], classification: str) -> dict[str, Any]:
    channels = {str(group.get("channel") or "") for group in groups}
    if classification != "overloaded":
        return {
            "status": "not_required",
            "mode": "keep_current_allocation",
            "candidate_segments": groups,
        }
    if not groups:
        return {
            "status": "insufficient_frozen_text_metadata",
            "mode": "manual_review_only",
            "candidate_segments": [],
        }
    if len(groups) == 1:
        return {
            "status": "unsplittable_under_current_frozen_units",
            "mode": "extend_duration_or_future_unit_policy",
            "candidate_segments": groups,
            "detail": (
                "The overloaded Shot contains only one atomic FrozenText segment. "
                "Shadow feedback must not split inside that unit."
            ),
        }
    if len(channels) > 1:
        return {
            "status": "allocator_required",
            "mode": "return_to_storyboard_allocator",
            "candidate_segments": groups,
            "detail": (
                "Multiple complete FrozenText segments are available, but dialogue/narration "
                "cross-channel ordering remains Storyboard-owned. Do not auto-order them in Runtime."
            ),
        }
    return {
        "status": "splittable_at_existing_unit_boundaries",
        "mode": "return_to_storyboard_allocator",
        "candidate_segments": groups,
        "detail": "Each candidate segment is atomic and may be reassigned as a whole; no unit may be split.",
    }


def analyze_shot_overload(shot: dict[str, Any], script_scene: dict[str, Any] | None) -> dict[str, Any]:
    current = float(shot.get("duration") or 0.0)
    current_w003 = float(estimate_min_duration(shot))
    narration_shadow = _narration_baseline_seconds(shot)
    estimate = round(current_w003 + narration_shadow, 2)
    ratio = round(estimate / current, 3) if current > 0 else None
    gap = round(estimate - current, 2)
    classification = _classify(current, estimate)
    index = _unit_index(script_scene) if isinstance(script_scene, dict) else {}
    groups = _atomic_groups(shot, index)
    resolution = _resolution_for(groups, classification)
    return {
        "shot_id": str(shot.get("shot_id") or ""),
        "scene_id": str(shot.get("scene_id") or ""),
        "beat_id": str(shot.get("beat_id") or ""),
        "classification": classification,
        "planned_duration_seconds": current,
        "current_w003_estimate_seconds": current_w003,
        "shadow_narration_estimate_seconds": narration_shadow,
        "provisional_shadow_estimate_seconds": estimate,
        "estimate_ratio": ratio,
        "estimate_gap_seconds": gap,
        "frozen_segment_count": len(groups),
        "resolution": resolution,
    }


def build_storyboard_overload_feedback(run: dict[str, Any]) -> dict[str, Any]:
    artifacts = run.get("artifacts") or {}
    script = artifacts.get("script") or {}
    shot_specs = artifacts.get("shot_specs") or []
    scenes = _script_scene_map(script if isinstance(script, dict) else {})
    shots = [
        analyze_shot_overload(shot, scenes.get(str(shot.get("scene_id") or "")))
        for shot in shot_specs
        if isinstance(shot, dict)
    ]
    counts = {
        key: sum(1 for item in shots if item.get("classification") == key)
        for key in ("normal", "warning", "overloaded", "unknown")
    }
    overloaded = [item for item in shots if item.get("classification") == "overloaded"]
    return {
        "contract_version": CONTRACT_VERSION,
        "mode": MODE,
        "run_id": str(run.get("run_id") or ""),
        "build_id": str(run.get("build_id") or ""),
        "thresholds": {
            "warning_gap_seconds": WARNING_GAP_SECONDS,
            "overload_min_ratio": OVERLOAD_MIN_RATIO,
            "overload_min_gap_seconds": OVERLOAD_MIN_GAP_SECONDS,
            "authority": "provisional_current_w003_plus_shadow_narration_baseline",
            "calibrated_with_real_seedance": False,
        },
        "automatic_storyboard_mutation": False,
        "automatic_duration_change": False,
        "shot_count": len(shots),
        "classification_counts": counts,
        "overloaded_shot_ids": [item["shot_id"] for item in overloaded],
        "shots": shots,
    }



def build_storyboard_overload_feedback_from_board(
    board: dict[str, Any],
    script: dict[str, Any],
    *,
    run_id: str = "",
    build_id: str = "",
) -> dict[str, Any]:
    """Build the same overload evidence before Director/ShotSpec exists.

    This lets duration authority act while FrozenText allocation is still Storyboard-owned.
    It deliberately uses the same W003 estimator; Director action cost is verified again
    after ShotSpec materialization.
    """
    scenes = _script_scene_map(script if isinstance(script, dict) else {})
    raw_shots = [
        shot
        for scene in (board.get("scenes") or [])
        if isinstance(scene, dict)
        for shot in (scene.get("shots") or [])
        if isinstance(shot, dict)
    ]
    shots = [
        analyze_shot_overload(shot, scenes.get(str(shot.get("scene_id") or "")))
        for shot in raw_shots
    ]
    counts = {
        key: sum(1 for item in shots if item.get("classification") == key)
        for key in ("normal", "warning", "overloaded", "unknown")
    }
    overloaded = [item for item in shots if item.get("classification") == "overloaded"]
    return {
        "contract_version": CONTRACT_VERSION,
        "mode": MODE,
        "basis": "storyboard_base_pre_director",
        "run_id": str(run_id or ""),
        "build_id": str(build_id or ""),
        "thresholds": {
            "warning_gap_seconds": WARNING_GAP_SECONDS,
            "overload_min_ratio": OVERLOAD_MIN_RATIO,
            "overload_min_gap_seconds": OVERLOAD_MIN_GAP_SECONDS,
            "authority": "current_w003_plus_shadow_narration_baseline",
            "calibrated_with_real_seedance": False,
        },
        "automatic_storyboard_mutation": False,
        "automatic_duration_change": False,
        "shot_count": len(shots),
        "classification_counts": counts,
        "overloaded_shot_ids": [item["shot_id"] for item in overloaded],
        "shots": shots,
    }

def write_storyboard_overload_feedback(path: str | Path, feedback: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(feedback, ensure_ascii=False, indent=2), encoding="utf-8")

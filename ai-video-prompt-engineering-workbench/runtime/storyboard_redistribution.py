from __future__ import annotations

import copy
import json
import math
import re
from pathlib import Path
from typing import Any

from prompt_foundry_v1_3.asset_compilers import CAMERA_MAP, MOVEMENT_MAP, SHOT_SIZE_MAP

PREVIEW_CONTRACT_VERSION = "storyboard_redistribution_plan.v1-preview"
CONTRACT_VERSION = PREVIEW_CONTRACT_VERSION
MODE = "preview_only"
GROUPING_POLICY = "one_complete_frozen_text_unit_per_preview_shot"

APPLY_CONTRACT_VERSION = "storyboard_redistribution_apply.v1"
FRAGMENT_MODEL_STAGE = "storyboard_redistribution_fragment"
FRAGMENT_OUTPUT_ROOT = "replacement"

FRAGMENT_SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 2.1 的 Storyboard Redistribution Fragment Planner。
你只重做一个已被确定性 Overload Gate 判定为可安全拆分的 Base Shot。

硬边界：
1. replacement_segments 已由程序按完整 FrozenTextUnit 锁定。输出 shots 数量必须与 replacement_segments 完全一致，并保持原顺序；一个输出 Shot 对应一个 segment。
2. 你不拥有正文、speaker、beat_id、scene_id、shot_id 或 FrozenTextUnit refs；这些由程序注入。不得合并、拆开、改写或重排 replacement_segments。
3. 你只重新设计每个 replacement Shot 的 character_refs、prop_refs、shot_size、camera、movement、composition、duration、description、continuity、source_evidence。
4. character_refs / prop_refs 只能来自 payload 的 allowed_*_refs。speaker 可以画外，因此 character_refs 不要求包含 speaker。
5. shot_size/camera/movement 只能使用 output_contract 的冻结枚举；duration 必须 >0 且 <=15 秒。
6. description 只能描述当前 segment 与 current_beat_authority 支持的可见事实；不得新增剧情、心理、气味、作者解释或无依据文字。
7. source_evidence 每镜至少一项，quote 必须逐字来自 current_beat_authority 或 source_shot.source_evidence 已有 quote。
8. replacement 第1镜的 continuous_with_previous 会由程序继承 source Shot；后续镜头可以判断连续性。
9. 不生成 Director、state、Production Semantics 或最终 Prompt。
10. 只输出 {\"replacement\":{\"shots\":[...]}} JSON，不要 markdown 或解释。"""


def _text_char_count(text: str) -> int:
    return len(re.findall(r"[\u4e00-\u9fffA-Za-z0-9]", str(text or "")))


def _text_floor_seconds(text: str) -> float:
    value = str(text or "")
    if not value:
        return 0.0
    chars = _text_char_count(value)
    punctuation_cost = 0.15 * len(re.findall(r"[，、,]", value))
    punctuation_cost += 0.35 * len(re.findall(r"[。！？!?]", value))
    return round((chars / 4.5 + punctuation_cost) * 1.2, 2)


def _ceil_half(value: float) -> float:
    return round(math.ceil(max(0.0, float(value)) * 2.0) / 2.0, 1)


def _ordered_unique(values: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        token = str(value or "")
        if not token or token in seen:
            continue
        seen.add(token)
        out.append(token)
    return out


def _segment_unit_refs(segment: dict[str, Any]) -> list[str]:
    return [str(x) for x in (segment.get("unit_refs") or []) if isinstance(x, str) and x]


def _preview_shot_from_segment(source: dict[str, Any], segment: dict[str, Any], index: int) -> dict[str, Any]:
    source_shot_id = str(source.get("shot_id") or "")
    channel = str(segment.get("channel") or "")
    refs = _segment_unit_refs(segment)
    text = str(segment.get("text") or "")
    floor = _text_floor_seconds(text)
    duration_hint = max(2.0, _ceil_half(floor)) if floor > 0 else 2.0
    dialogue_refs = refs if channel == "dialogue" else []
    narration_refs = refs if channel == "narration" else []
    return {
        "preview_shot_id": f"{source_shot_id}.R{index:02d}",
        "source_shot_id": source_shot_id,
        "scene_id": str(source.get("scene_id") or ""),
        "beat_id": str(source.get("beat_id") or ""),
        "channel": channel,
        "utterance_group_id": segment.get("utterance_group_id"),
        "character_id": segment.get("character_id"),
        "frozen_text_unit_refs": {"dialogue": dialogue_refs, "narration": narration_refs},
        "text_preview": text,
        "provisional_text_floor_seconds": floor,
        "provisional_duration_hint_seconds": duration_hint,
        "duration_hint_authority": "uncalibrated_text_floor_only",
        "requires_storyboard_regeneration": True,
        "requires_downstream_regeneration": [
            "production_semantics", "director", "state_shotspec", "consumption_compiler"
        ],
    }


def _flatten_plan_refs(preview_shots: list[dict[str, Any]]) -> list[str]:
    out: list[str] = []
    for item in preview_shots:
        refs = item.get("frozen_text_unit_refs") or {}
        out.extend(str(x) for x in (refs.get("dialogue") or []) if isinstance(x, str) and x)
        out.extend(str(x) for x in (refs.get("narration") or []) if isinstance(x, str) and x)
    return out


def _plan_one_overloaded_shot(item: dict[str, Any]) -> dict[str, Any]:
    source_shot_id = str(item.get("shot_id") or "")
    resolution = item.get("resolution") if isinstance(item.get("resolution"), dict) else {}
    status = str(resolution.get("status") or "")
    segments = [x for x in (resolution.get("candidate_segments") or []) if isinstance(x, dict)]
    source_refs = [ref for segment in segments for ref in _segment_unit_refs(segment)]
    base = {
        "source_shot_id": source_shot_id,
        "scene_id": str(item.get("scene_id") or ""),
        "beat_id": str(item.get("beat_id") or ""),
        "classification": str(item.get("classification") or ""),
        "planned_duration_seconds": float(item.get("planned_duration_seconds") or 0.0),
        "provisional_shadow_estimate_seconds": float(item.get("provisional_shadow_estimate_seconds") or 0.0),
        "source_resolution_status": status,
        "source_frozen_text_unit_refs": source_refs,
    }
    if status != "splittable_at_existing_unit_boundaries" or len(segments) < 2:
        reason_map = {
            "unsplittable_under_current_frozen_units": "atomic_frozen_text_unit",
            "allocator_required": "cross_channel_order_storyboard_owned",
            "insufficient_frozen_text_metadata": "missing_frozen_text_metadata",
        }
        return {
            **base,
            "plan_status": "blocked",
            "blocked_reason": reason_map.get(status, "not_safe_for_deterministic_preview_split"),
            "preview_shots": [],
            "coverage_check": {
                "passed": False, "expected_unit_refs": source_refs, "planned_unit_refs": [],
                "detail": "No redistribution preview was created for this Shot.",
            },
        }
    channels = {str(segment.get("channel") or "") for segment in segments}
    if len(channels) != 1:
        return {
            **base,
            "plan_status": "blocked", "blocked_reason": "cross_channel_order_storyboard_owned",
            "preview_shots": [],
            "coverage_check": {
                "passed": False, "expected_unit_refs": source_refs, "planned_unit_refs": [],
                "detail": "Dialogue/narration cross-channel ordering remains Storyboard-owned.",
            },
        }
    preview_shots = [_preview_shot_from_segment(item, segment, idx) for idx, segment in enumerate(segments, 1)]
    planned_refs = _flatten_plan_refs(preview_shots)
    unique_refs = _ordered_unique(planned_refs)
    coverage_passed = planned_refs == source_refs and unique_refs == planned_refs
    return {
        **base,
        "plan_status": "preview_ready" if coverage_passed else "invalid_preview",
        "blocked_reason": None if coverage_passed else "frozen_text_coverage_mismatch",
        "grouping_policy": GROUPING_POLICY,
        "preview_shots": preview_shots,
        "coverage_check": {
            "passed": coverage_passed,
            "expected_unit_refs": source_refs,
            "planned_unit_refs": planned_refs,
            "detail": (
                "All complete FrozenTextUnit refs are preserved exactly once and in order."
                if coverage_passed else
                "Preview plan changed, duplicated, omitted, or reordered FrozenTextUnit refs."
            ),
        },
    }


def validate_redistribution_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if plan.get("mode") != MODE:
        errors.append({"type": "redistribution_mode_mismatch", "detail": f"mode must be {MODE}"})
    if plan.get("automatic_storyboard_mutation") is not False:
        errors.append({"type": "redistribution_preview_mutation_enabled", "detail": "preview v1 must not mutate Storyboard"})
    if plan.get("automatic_duration_change") is not False:
        errors.append({"type": "redistribution_preview_duration_change_enabled", "detail": "preview v1 must not change production duration"})
    for entry in plan.get("shot_plans", []) or []:
        if not isinstance(entry, dict) or entry.get("plan_status") != "preview_ready":
            continue
        coverage = entry.get("coverage_check") or {}
        expected = [str(x) for x in (coverage.get("expected_unit_refs") or [])]
        planned = [str(x) for x in (coverage.get("planned_unit_refs") or [])]
        if expected != planned:
            errors.append({"type": "redistribution_frozen_text_coverage_mismatch", "shot_id": entry.get("source_shot_id"), "detail": f"expected {expected}, got {planned}"})
        if len(planned) != len(set(planned)):
            errors.append({"type": "redistribution_duplicate_frozen_text_unit", "shot_id": entry.get("source_shot_id"), "detail": "planned FrozenTextUnit refs must be unique"})
        for preview in entry.get("preview_shots", []) or []:
            refs = preview.get("frozen_text_unit_refs") or {}
            all_refs = list(refs.get("dialogue") or []) + list(refs.get("narration") or [])
            if not all_refs:
                errors.append({"type": "redistribution_empty_preview_shot", "shot_id": entry.get("source_shot_id"), "preview_shot_id": preview.get("preview_shot_id"), "detail": "every preview Shot must own at least one complete FrozenTextUnit"})
            if refs.get("dialogue") and refs.get("narration"):
                errors.append({"type": "redistribution_cross_channel_preview_shot", "shot_id": entry.get("source_shot_id"), "preview_shot_id": preview.get("preview_shot_id"), "detail": "preview v1 never auto-mixes dialogue and narration in one new Shot"})
    return errors


def build_storyboard_redistribution_plan(feedback: dict[str, Any]) -> dict[str, Any]:
    source = copy.deepcopy(feedback)
    shot_plans = [_plan_one_overloaded_shot(item) for item in (source.get("shots") or []) if isinstance(item, dict) and item.get("classification") == "overloaded"]
    preview_ready = [item for item in shot_plans if item.get("plan_status") == "preview_ready"]
    blocked = [item for item in shot_plans if item.get("plan_status") == "blocked"]
    plan = {
        "contract_version": PREVIEW_CONTRACT_VERSION,
        "mode": MODE,
        "source_feedback_contract_version": str(source.get("contract_version") or ""),
        "run_id": str(source.get("run_id") or ""),
        "build_id": str(source.get("build_id") or ""),
        "grouping_policy": GROUPING_POLICY,
        "calibrated_with_real_seedance": bool((source.get("thresholds") or {}).get("calibrated_with_real_seedance")),
        "automatic_storyboard_mutation": False,
        "automatic_duration_change": False,
        "apply_enabled": False,
        "inheritance_policy": {
            "preserve": [
                "scene_id", "beat_id", "FrozenTextUnit refs and exact text authority",
                "utterance_group_id / speaker authority from Script", "source Shot provenance",
            ],
            "regenerate_before_apply": [
                "character_refs", "prop_refs", "shot_size", "camera", "movement", "composition",
                "duration", "description", "continuity", "source_evidence", "production_semantics",
                "director", "state_shotspec", "compiled_prompt",
            ],
        },
        "overloaded_shot_count": len(shot_plans),
        "preview_ready_count": len(preview_ready),
        "blocked_count": len(blocked),
        "shot_plans": shot_plans,
    }
    errors = validate_redistribution_plan(plan)
    plan["validation"] = {"passed": not errors, "errors": errors}
    return plan


def write_storyboard_redistribution_plan(path: str | Path, plan: dict[str, Any]) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")


# -------------------- active apply contract --------------------


def fragment_output_template() -> dict[str, Any]:
    return {
        "replacement": {
            "shots": [{
                "character_refs": [],
                "prop_refs": [],
                "shot_size": "medium",
                "camera": "eye_level",
                "movement": "static",
                "composition": "",
                "duration": 4.0,
                "description": "",
                "continuity": {
                    "continuous_with_previous": True,
                    "axis_side": "neutral",
                    "eyeline_match": "not_applicable",
                },
                "source_evidence": [{"quote": ""}],
            }]
        }
    }


def fragment_output_contract() -> dict[str, Any]:
    return {
        "model_root": FRAGMENT_OUTPUT_ROOT,
        "required_shot_fields": [
            "character_refs", "prop_refs", "shot_size", "camera", "movement", "composition",
            "duration", "description", "continuity", "source_evidence",
        ],
        "allowed_shot_sizes": sorted(SHOT_SIZE_MAP),
        "allowed_cameras": sorted(CAMERA_MAP),
        "allowed_movements": sorted(MOVEMENT_MAP),
        "program_owned_fields": [
            "shot_id", "scene_id", "beat_id", "dialogue", "narration", "frozen_text_unit_refs"
        ],
        "allocation_rule": "one model shot per replacement_segment, exact order; FrozenText allocation is program-owned",
    }


def _script_beat(script_scene: dict[str, Any], beat_id: str) -> dict[str, Any]:
    return next((b for b in (script_scene.get("beats") or []) if isinstance(b, dict) and str(b.get("beat_id") or "") == beat_id), {})


def _beat_authority_corpus(script_scene: dict[str, Any], beat_id: str, source_shot: dict[str, Any]) -> list[str]:
    beat = _script_beat(script_scene, beat_id)
    out: list[str] = []
    desc = str(beat.get("description") or "").strip()
    if desc:
        out.append(desc)
    for item in beat.get("dialogue") or []:
        if isinstance(item, dict):
            line = str(item.get("line") or "").strip()
            if line:
                out.append(line)
    narration = beat.get("narration")
    if isinstance(narration, str) and narration.strip():
        out.append(narration.strip())
    elif isinstance(narration, list):
        out.extend(str(x).strip() for x in narration if isinstance(x, str) and x.strip())
    for item in source_shot.get("source_evidence") or []:
        if isinstance(item, dict):
            quote = str(item.get("quote") or "").strip()
            if quote:
                out.append(quote)
    return _ordered_unique(out)


def build_redistribution_fragment_payload(
    *,
    shot_plan: dict[str, Any],
    source_shot: dict[str, Any],
    scene_plan_scene: dict[str, Any],
    script_scene: dict[str, Any],
    unit_id: str,
) -> dict[str, Any]:
    if shot_plan.get("plan_status") != "preview_ready":
        raise ValueError("shot_plan must be preview_ready")
    previews = [copy.deepcopy(x) for x in (shot_plan.get("preview_shots") or []) if isinstance(x, dict)]
    return {
        "unit_id": unit_id,
        "contract_version": APPLY_CONTRACT_VERSION,
        "source_shot": {
            key: copy.deepcopy(source_shot.get(key))
            for key in (
                "shot_id", "scene_id", "beat_id", "character_refs", "prop_refs", "shot_size", "camera",
                "movement", "composition", "duration", "description", "continuity", "source_evidence"
            )
        },
        "replacement_segments": previews,
        "allowed_character_refs": list(scene_plan_scene.get("character_refs") or []),
        "allowed_prop_refs": list(scene_plan_scene.get("prop_refs") or []),
        "current_beat_authority": _beat_authority_corpus(script_scene, str(source_shot.get("beat_id") or ""), source_shot),
        "output_template": fragment_output_template(),
        "output_contract": fragment_output_contract(),
    }


def _quote_is_authorized(quote: str, corpus: list[str]) -> bool:
    value = str(quote or "").strip()
    return bool(value) and any(value in str(authority or "") for authority in corpus)


def canonicalize_redistribution_fragment(
    candidate: Any,
    *,
    payload: dict[str, Any],
) -> tuple[dict[str, Any], int]:
    if not isinstance(candidate, dict):
        return candidate, 0
    raw_shots = candidate.get("shots")
    if not isinstance(raw_shots, list):
        return copy.deepcopy(candidate), 0
    segments = payload.get("replacement_segments") or []
    source_shot = payload.get("source_shot") or {}
    out = {"shots": []}
    changes = 0
    for index, raw in enumerate(raw_shots):
        model_shot = copy.deepcopy(raw) if isinstance(raw, dict) else {}
        if index >= len(segments):
            out["shots"].append(model_shot)
            continue
        segment = segments[index]
        refs = segment.get("frozen_text_unit_refs") or {}
        channel = str(segment.get("channel") or "")
        text = str(segment.get("text_preview") or "")
        canonical = {
            "shot_id": str(segment.get("preview_shot_id") or ""),
            "scene_id": str(source_shot.get("scene_id") or ""),
            "beat_id": str(source_shot.get("beat_id") or ""),
            "character_refs": copy.deepcopy(model_shot.get("character_refs") or []),
            "prop_refs": copy.deepcopy(model_shot.get("prop_refs") or []),
            "shot_size": model_shot.get("shot_size"),
            "camera": model_shot.get("camera"),
            "movement": model_shot.get("movement"),
            "composition": model_shot.get("composition"),
            "duration": model_shot.get("duration"),
            "description": model_shot.get("description"),
            "dialogue": ([{"character_id": str(segment.get("character_id") or ""), "line": text}] if channel == "dialogue" else []),
            "narration": ([text] if channel == "narration" else []),
            "frozen_text_unit_refs": {
                "dialogue": list(refs.get("dialogue") or []),
                "narration": list(refs.get("narration") or []),
            },
            "continuity": copy.deepcopy(model_shot.get("continuity") or {}),
            "source_evidence": copy.deepcopy(model_shot.get("source_evidence") or []),
        }
        if index == 0:
            source_continuity = source_shot.get("continuity") or {}
            if canonical["continuity"].get("continuous_with_previous") != bool(source_continuity.get("continuous_with_previous")):
                canonical["continuity"]["continuous_with_previous"] = bool(source_continuity.get("continuous_with_previous"))
                changes += 1
        out["shots"].append(canonical)
        changes += 1
    return out, changes


def validate_redistribution_fragment(candidate: Any, *, payload: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(candidate, dict):
        return [{"type": "shape_type_mismatch", "path": "replacement", "detail": "replacement must be object"}]
    shots = candidate.get("shots")
    segments = payload.get("replacement_segments") or []
    if not isinstance(shots, list):
        return [{"type": "shape_type_mismatch", "path": "replacement.shots", "detail": "shots must be array"}]
    if len(shots) != len(segments):
        errors.append({
            "type": "redistribution_fragment_count_mismatch",
            "path": "replacement.shots",
            "detail": f"expected {len(segments)} replacement shots, got {len(shots)}",
        })
        return errors
    allowed_chars = set(str(x) for x in (payload.get("allowed_character_refs") or []))
    allowed_props = set(str(x) for x in (payload.get("allowed_prop_refs") or []))
    corpus = [str(x) for x in (payload.get("current_beat_authority") or []) if isinstance(x, str)]
    source_shot = payload.get("source_shot") or {}
    for index, shot in enumerate(shots):
        path = f"replacement.shots[{index}]"
        if not isinstance(shot, dict):
            errors.append({"type": "shape_type_mismatch", "path": path, "detail": "shot must be object"})
            continue
        segment = segments[index]
        if str(shot.get("scene_id") or "") != str(source_shot.get("scene_id") or ""):
            errors.append({"type": "redistribution_scene_mismatch", "path": f"{path}.scene_id"})
        if str(shot.get("beat_id") or "") != str(source_shot.get("beat_id") or ""):
            errors.append({"type": "redistribution_beat_mismatch", "path": f"{path}.beat_id"})
        expected_refs = segment.get("frozen_text_unit_refs") or {}
        if shot.get("frozen_text_unit_refs") != expected_refs:
            errors.append({"type": "redistribution_unit_ref_mismatch", "path": f"{path}.frozen_text_unit_refs"})
        channel = str(segment.get("channel") or "")
        text = str(segment.get("text_preview") or "")
        expected_dialogue = ([{"character_id": str(segment.get("character_id") or ""), "line": text}] if channel == "dialogue" else [])
        expected_narration = ([text] if channel == "narration" else [])
        if shot.get("dialogue") != expected_dialogue:
            errors.append({"type": "redistribution_dialogue_authority_mismatch", "path": f"{path}.dialogue"})
        if shot.get("narration") != expected_narration:
            errors.append({"type": "redistribution_narration_authority_mismatch", "path": f"{path}.narration"})
        chars = shot.get("character_refs")
        if not isinstance(chars, list) or any(not isinstance(x, str) or x not in allowed_chars for x in chars):
            errors.append({"type": "redistribution_invalid_character_refs", "path": f"{path}.character_refs"})
        props = shot.get("prop_refs")
        if not isinstance(props, list) or any(not isinstance(x, str) or x not in allowed_props for x in props):
            errors.append({"type": "redistribution_invalid_prop_refs", "path": f"{path}.prop_refs"})
        if shot.get("shot_size") not in SHOT_SIZE_MAP:
            errors.append({"type": "redistribution_invalid_shot_size", "path": f"{path}.shot_size"})
        if shot.get("camera") not in CAMERA_MAP:
            errors.append({"type": "redistribution_invalid_camera", "path": f"{path}.camera"})
        if shot.get("movement") not in MOVEMENT_MAP:
            errors.append({"type": "redistribution_invalid_movement", "path": f"{path}.movement"})
        duration = shot.get("duration")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)) or not (0 < float(duration) <= 15.0):
            errors.append({"type": "redistribution_invalid_duration", "path": f"{path}.duration"})
        if not isinstance(shot.get("composition"), str):
            errors.append({"type": "redistribution_invalid_composition", "path": f"{path}.composition"})
        if not isinstance(shot.get("description"), str) or not str(shot.get("description") or "").strip():
            errors.append({"type": "redistribution_invalid_description", "path": f"{path}.description"})
        continuity = shot.get("continuity")
        if not isinstance(continuity, dict):
            errors.append({"type": "redistribution_invalid_continuity", "path": f"{path}.continuity"})
        else:
            if not isinstance(continuity.get("continuous_with_previous"), bool):
                errors.append({"type": "redistribution_invalid_continuity", "path": f"{path}.continuity.continuous_with_previous"})
            for key in ("axis_side", "eyeline_match"):
                if not isinstance(continuity.get(key), str):
                    errors.append({"type": "redistribution_invalid_continuity", "path": f"{path}.continuity.{key}"})
        evidence = shot.get("source_evidence")
        if not isinstance(evidence, list) or not evidence:
            errors.append({"type": "redistribution_missing_source_evidence", "path": f"{path}.source_evidence"})
        else:
            for ei, item in enumerate(evidence):
                quote = str((item or {}).get("quote") or "") if isinstance(item, dict) else ""
                if not _quote_is_authorized(quote, corpus):
                    errors.append({"type": "redistribution_unanchored_source_evidence", "path": f"{path}.source_evidence[{ei}].quote", "detail": quote})
    return errors


def _shot_map(board: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {
        str(shot.get("shot_id") or ""): shot
        for scene in (board.get("scenes") or []) if isinstance(scene, dict)
        for shot in (scene.get("shots") or []) if isinstance(shot, dict) and shot.get("shot_id")
    }


def apply_redistribution_fragments(
    board: dict[str, Any],
    plan: dict[str, Any],
    fragments: dict[str, dict[str, Any]],
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Replace preview-ready source Shots and assign canonical global SH IDs.

    This function is deterministic. It never manufactures replacement photography;
    fragments must already have passed the fragment model contract.
    """
    ready = {
        str(item.get("source_shot_id") or ""): item
        for item in (plan.get("shot_plans") or [])
        if isinstance(item, dict) and item.get("plan_status") == "preview_ready"
    }
    source_map = _shot_map(board)
    missing = sorted(set(ready) - set(source_map))
    if missing:
        raise ValueError(f"redistribution source shots not found: {missing}")
    missing_fragments = sorted(set(ready) - set(fragments))
    if missing_fragments:
        raise ValueError(f"redistribution fragments missing: {missing_fragments}")

    out = copy.deepcopy(board)
    old_to_new: dict[str, list[str]] = {}
    applied_sources: list[str] = []
    next_index = 1
    for scene in out.get("scenes") or []:
        new_shots: list[dict[str, Any]] = []
        for shot in scene.get("shots") or []:
            old_id = str(shot.get("shot_id") or "")
            replacements = (fragments.get(old_id) or {}).get("shots") if old_id in ready else None
            candidates = copy.deepcopy(replacements) if isinstance(replacements, list) else [copy.deepcopy(shot)]
            if old_id in ready:
                applied_sources.append(old_id)
            assigned: list[str] = []
            for candidate in candidates:
                new_id = f"SH{next_index:03d}"
                next_index += 1
                candidate["shot_id"] = new_id
                candidate["scene_id"] = str(scene.get("scene_id") or candidate.get("scene_id") or "")
                assigned.append(new_id)
                new_shots.append(candidate)
            old_to_new[old_id] = assigned
        scene["shots"] = new_shots

    old_order = [str(shot.get("shot_id") or "") for scene in (board.get("scenes") or []) for shot in (scene.get("shots") or [])]
    first_changed_index = min((old_order.index(sid) for sid in applied_sources if sid in old_order), default=-1)
    report = {
        "contract_version": APPLY_CONTRACT_VERSION,
        "applied": bool(applied_sources),
        "applied_source_shot_ids": applied_sources,
        "old_to_new_shot_ids": old_to_new,
        "first_changed_old_shot_index": first_changed_index,
        "old_shot_count": len(old_order),
        "new_shot_count": sum(len(scene.get("shots") or []) for scene in out.get("scenes") or []),
    }
    return out, report

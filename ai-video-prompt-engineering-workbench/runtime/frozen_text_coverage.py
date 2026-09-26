from __future__ import annotations

from collections import Counter
from typing import Any

from runtime.stages.storyboard import build_frozen_text_units

COVERAGE_CONTRACT_VERSION = "frozen_text_coverage.v1"
_CHANNELS = ("dialogue", "narration")


def _script_scenes(script: dict[str, Any]) -> list[dict[str, Any]]:
    return [scene for scene in (script.get("scenes", []) or []) if isinstance(scene, dict)]


def _coverage_key(scene_id: str, unit_id: str) -> str:
    return f"{scene_id}::{unit_id}"


def expected_frozen_text_refs(script: dict[str, Any]) -> dict[str, list[str]]:
    expected = {channel: [] for channel in _CHANNELS}
    for scene in _script_scenes(script):
        scene_id = str(scene.get("scene_id") or "")
        units = build_frozen_text_units(scene)
        for beat in scene.get("beats", []) or []:
            if not isinstance(beat, dict):
                continue
            bid = str(beat.get("beat_id") or "")
            group = units.get(bid, {})
            for channel in _CHANNELS:
                expected[channel].extend(
                    _coverage_key(scene_id, str(unit.get("unit_id")))
                    for unit in (group.get(channel, []) or [])
                    if isinstance(unit, dict) and unit.get("unit_id")
                )
    return expected


def _refs_from_items(items: list[dict[str, Any]], *, compiled: bool = False) -> dict[str, list[str]]:
    refs = {channel: [] for channel in _CHANNELS}
    for item in items:
        if not isinstance(item, dict):
            continue
        source: Any
        if compiled:
            manifest = item.get("shot_consumption_manifest")
            provenance = manifest.get("provenance") if isinstance(manifest, dict) else {}
            source = provenance.get("frozen_text_unit_refs") if isinstance(provenance, dict) else {}
        else:
            source = item.get("frozen_text_unit_refs")
        if not isinstance(source, dict):
            source = {}
        scene_id = str(item.get("scene_id") or "")
        for channel in _CHANNELS:
            refs[channel].extend(
                _coverage_key(scene_id, str(value))
                for value in (source.get(channel, []) or [])
                if isinstance(value, str) and value
            )
    return refs


def storyboard_frozen_text_refs(storyboard: dict[str, Any]) -> dict[str, list[str]]:
    shots = [
        shot
        for scene in (storyboard.get("scenes", []) or [])
        if isinstance(scene, dict)
        for shot in (scene.get("shots", []) or [])
        if isinstance(shot, dict)
    ]
    return _refs_from_items(shots)


def shotspec_frozen_text_refs(shot_specs: list[dict[str, Any]]) -> dict[str, list[str]]:
    return _refs_from_items([item for item in (shot_specs or []) if isinstance(item, dict)])


def compiled_frozen_text_refs(compiled_project: dict[str, Any]) -> dict[str, list[str]]:
    return _refs_from_items(
        [item for item in (compiled_project.get("shot_prompts", []) or []) if isinstance(item, dict)],
        compiled=True,
    )


def _diagnostics(expected: list[str], actual: list[str]) -> dict[str, Any]:
    expected_counter = Counter(expected)
    actual_counter = Counter(actual)
    missing: list[str] = []
    duplicate: list[str] = []
    for ref, count in expected_counter.items():
        if actual_counter[ref] < count:
            missing.extend([ref] * (count - actual_counter[ref]))
    for ref, count in actual_counter.items():
        baseline = expected_counter.get(ref, 0)
        if count > baseline:
            duplicate.extend([ref] * (count - baseline))
    unknown = [ref for ref in actual if ref not in expected_counter]
    same_multiset = not missing and not duplicate and not unknown and len(expected) == len(actual)
    return {
        "expected_count": len(expected),
        "actual_count": len(actual),
        "missing": missing,
        "duplicate": duplicate,
        "unknown": unknown,
        "reordered": bool(same_multiset and expected != actual),
        "passed": expected == actual,
    }


def build_frozen_text_coverage_manifest(
    script: dict[str, Any],
    storyboard: dict[str, Any],
    shot_specs: list[dict[str, Any]],
    compiled_project: dict[str, Any],
) -> dict[str, Any]:
    expected = expected_frozen_text_refs(script)
    storyboard_refs = storyboard_frozen_text_refs(storyboard)
    shot_spec_refs = shotspec_frozen_text_refs(shot_specs)
    compiled_refs = compiled_frozen_text_refs(compiled_project)

    # v16 Storyboard publishes sentence-level dialogue/narration frozen_text_unit_refs on canonical shots.
    # If no Script unit exists, coverage is vacuously tracked and complete.
    tracking_active = bool(
        any(expected[channel] for channel in _CHANNELS)
        or any(storyboard_refs[channel] for channel in _CHANNELS)
    )
    layers = {
        "storyboard": storyboard_refs,
        "shot_specs": shot_spec_refs,
        "compiled": compiled_refs,
    }
    diagnostics = {
        layer: {
            channel: _diagnostics(expected[channel], refs[channel])
            for channel in _CHANNELS
        }
        for layer, refs in layers.items()
    }
    passed = (not tracking_active) or all(
        diagnostics[layer][channel]["passed"]
        for layer in diagnostics
        for channel in _CHANNELS
    )
    return {
        "contract_version": COVERAGE_CONTRACT_VERSION,
        "tracking_active": tracking_active,
        "passed": passed,
        "expected": expected,
        "storyboard": storyboard_refs,
        "shot_specs": shot_spec_refs,
        "compiled": compiled_refs,
        "diagnostics": diagnostics,
    }


def validate_frozen_text_coverage(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    if not manifest.get("tracking_active"):
        return []
    errors: list[dict[str, Any]] = []
    for layer in ("storyboard", "shot_specs", "compiled"):
        layer_diagnostics = manifest.get("diagnostics", {}).get(layer, {})
        for channel in _CHANNELS:
            diag = layer_diagnostics.get(channel, {})
            if diag.get("passed"):
                continue
            errors.append({
                "type": f"frozen_text_coverage_{layer}_mismatch",
                "category": "STRUCTURE",
                "source_layer": "Frozen Text Coverage",
                "target_id": layer,
                "channel": channel,
                "detail": (
                    f"{layer} {channel} frozen-text coverage must exactly match Script inventory; "
                    f"expected={diag.get('expected_count', 0)}, actual={diag.get('actual_count', 0)}"
                ),
                "missing_unit_refs": list(diag.get("missing") or []),
                "duplicate_unit_refs": list(diag.get("duplicate") or []),
                "unknown_unit_refs": list(diag.get("unknown") or []),
                "reordered": bool(diag.get("reordered")),
            })
    return errors

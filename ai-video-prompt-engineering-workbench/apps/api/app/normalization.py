from __future__ import annotations

import copy
from typing import Any


def _assign(obj: dict[str, Any], key: str, value: str) -> int:
    if obj.get(key) == value:
        return 0
    obj[key] = value
    return 1


def normalize_scene_plan_ids(scene_plan: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Canonicalize non-semantic Scene/Beat IDs by narrative order.

    This never changes location/context/character/prop refs or story content.
    """
    out = copy.deepcopy(scene_plan)
    changes = 0
    beat_index = 1
    for scene_index, scene in enumerate(out.get("scenes", []) or [], start=1):
        changes += _assign(scene, "scene_id", f"SC{scene_index:03d}")
        for beat in scene.get("beat_list", []) or []:
            changes += _assign(beat, "beat_id", f"B{beat_index:03d}")
            beat_index += 1
    return out, changes


def normalize_storyboard_shot_ids(storyboard: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Canonicalize non-semantic Shot IDs globally by storyboard order."""
    out = copy.deepcopy(storyboard)
    changes = 0
    shot_index = 1
    for scene in out.get("scenes", []) or []:
        for shot in scene.get("shots", []) or []:
            changes += _assign(shot, "shot_id", f"SH{shot_index:03d}")
            shot_index += 1
    return out, changes



def _ordered_unique(values: list[Any]) -> list[Any]:
    out = []
    seen = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out


def _shot_speaker_refs(shot: dict[str, Any]) -> list[str]:
    return _ordered_unique([
        str(item.get("character_id"))
        for item in (shot.get("dialogue") or [])
        if isinstance(item, dict) and item.get("character_id")
    ])


def normalize_director_semantics(storyboard: dict[str, Any], base_storyboard: dict[str, Any] | None = None) -> tuple[dict[str, Any], int]:
    """Canonicalize Director metadata that is fully determined by the Shot.

    This function never invents performance, focus, action, or story facts. It only
    enforces cross-field reference invariants that can be derived mechanically.
    """
    out = copy.deepcopy(storyboard)
    changes = 0
    authoritative_shots: dict[str, dict[str, Any]] = {}
    if base_storyboard is not None:
        for scene in base_storyboard.get("scenes", []) or []:
            for shot in scene.get("shots", []) or []:
                if shot.get("shot_id"):
                    authoritative_shots[str(shot["shot_id"])] = shot
    for scene in out.get("scenes", []) or []:
        for shot in scene.get("shots", []) or []:
            director = shot.get("director")
            if not isinstance(director, dict):
                continue

            source_shot = authoritative_shots.get(str(shot.get("shot_id"))) or shot
            shot_chars = [str(v) for v in (source_shot.get("character_refs") or [])]
            allowed_chars = set(shot_chars)

            exact_speakers = _shot_speaker_refs(source_shot)
            if director.get("speaker_target_refs") != exact_speakers:
                director["speaker_target_refs"] = exact_speakers
                changes += 1

            current_primary = director.get("primary_subject_refs") or []
            if isinstance(current_primary, list):
                normalized_primary = _ordered_unique([ref for ref in current_primary if ref in allowed_chars])
                if normalized_primary != current_primary:
                    director["primary_subject_refs"] = normalized_primary
                    changes += 1

            performance_refs = {
                item.get("character_ref")
                for item in (director.get("performance_actions") or [])
                if isinstance(item, dict) and item.get("character_ref") in allowed_chars
            }
            current_reactions = director.get("reaction_target_refs") or []
            if isinstance(current_reactions, list):
                normalized_reactions = _ordered_unique([
                    ref for ref in current_reactions
                    if ref in allowed_chars and ref in performance_refs
                ])
                if normalized_reactions != current_reactions:
                    director["reaction_target_refs"] = normalized_reactions
                    changes += 1

    return out, changes


def rebase_director_onto_base(candidate: dict[str, Any], base_storyboard: dict[str, Any]) -> tuple[dict[str, Any], int]:
    """Attach only model-authored director blocks onto the authoritative base storyboard.

    The Director model does not own scene/shot structure, refs, dialogue, camera fields,
    or source evidence. Any model mutation outside ``shot.director`` is discarded.
    Missing/unknown shot directors are left for the frozen Director Validator to reject.
    """
    out = copy.deepcopy(base_storyboard)
    candidate_directors: dict[str, dict[str, Any]] = {}
    for scene in candidate.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        for shot in scene.get("shots", []) or []:
            if not isinstance(shot, dict):
                continue
            shot_id = shot.get("shot_id")
            director = shot.get("director")
            if shot_id and isinstance(director, dict) and str(shot_id) not in candidate_directors:
                candidate_directors[str(shot_id)] = copy.deepcopy(director)

    for scene in out.get("scenes", []) or []:
        for shot in scene.get("shots", []) or []:
            shot_id = str(shot.get("shot_id") or "")
            if shot_id in candidate_directors:
                shot["director"] = candidate_directors[shot_id]

    changed = 1 if _strip_director_for_rebase(candidate) != base_storyboard else 0
    return out, changed


def _strip_director_for_rebase(storyboard: dict[str, Any]) -> dict[str, Any]:
    value = copy.deepcopy(storyboard)
    for scene in value.get("scenes", []) or []:
        if not isinstance(scene, dict):
            continue
        for shot in scene.get("shots", []) or []:
            if isinstance(shot, dict):
                shot.pop("director", None)
    return value


def normalize_stage_output(stage: str, value: dict[str, Any]) -> tuple[dict[str, Any], int]:
    if stage == "scene_plan":
        return normalize_scene_plan_ids(value)
    if stage == "storyboard_base":
        return normalize_storyboard_shot_ids(value)
    return value, 0

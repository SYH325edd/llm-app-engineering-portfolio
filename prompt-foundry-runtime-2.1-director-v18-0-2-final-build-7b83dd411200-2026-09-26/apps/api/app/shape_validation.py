from __future__ import annotations

from typing import Any


def _error(errors: list[dict[str, Any]], path: str, expected: str, value: Any) -> None:
    errors.append({
        "type": "shape_type_mismatch",
        "path": path,
        "detail": f"{path} must be {expected}; got {type(value).__name__}",
        "expected": expected,
        "actual_type": type(value).__name__,
    })


def _dict(value: Any, path: str, errors: list[dict[str, Any]]) -> bool:
    if not isinstance(value, dict):
        _error(errors, path, "JSON object", value)
        return False
    return True


def _list(value: Any, path: str, errors: list[dict[str, Any]]) -> bool:
    if not isinstance(value, list):
        _error(errors, path, "JSON array", value)
        return False
    return True


def _list_of_dicts(value: Any, path: str, errors: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not _list(value, path, errors):
        return []
    out: list[dict[str, Any]] = []
    for idx, item in enumerate(value):
        if _dict(item, f"{path}[{idx}]", errors):
            out.append(item)
    return out


def _list_of_strings(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    if not _list(value, path, errors):
        return
    for idx, item in enumerate(value):
        if not isinstance(item, str):
            _error(errors, f"{path}[{idx}]", "string", item)


def _evidence_list(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    _list_of_dicts(value, path, errors)


def _state_map(value: Any, path: str, errors: list[dict[str, Any]]) -> None:
    if not _dict(value, path, errors):
        return
    for section in ("characters", "props", "environment"):
        section_value = value.get(section)
        if not _dict(section_value, f"{path}.{section}", errors):
            continue
        if section in {"characters", "props"}:
            for ref, fields in section_value.items():
                _dict(fields, f"{path}.{section}.{ref}", errors)


def _director_fragment_shape(director: Any, path: str, errors: list[dict[str, Any]]) -> None:
    if not _dict(director, path, errors):
        return
    _list_of_strings(director.get("primary_subject_refs"), f"{path}.primary_subject_refs", errors)
    # speaker_target_refs is program-owned but must be an array by the time Core sees it.
    if "speaker_target_refs" in director:
        _list_of_strings(director.get("speaker_target_refs"), f"{path}.speaker_target_refs", errors)
    _list_of_strings(director.get("reaction_target_refs"), f"{path}.reaction_target_refs", errors)

    actions = _list_of_dicts(director.get("performance_actions"), f"{path}.performance_actions", errors)
    for ai, action in enumerate(actions):
        ap = f"{path}.performance_actions[{ai}]"
        _list_of_strings(action.get("dependency_tags"), f"{ap}.dependency_tags", errors)
        _evidence_list(action.get("source_evidence"), f"{ap}.source_evidence", errors)

    focus = director.get("visual_focus")
    if _dict(focus, f"{path}.visual_focus", errors):
        _list_of_strings(focus.get("subject_refs"), f"{path}.visual_focus.subject_refs", errors)
        _list_of_strings(focus.get("prop_refs"), f"{path}.visual_focus.prop_refs", errors)
        _list_of_strings(focus.get("environment_keys"), f"{path}.visual_focus.environment_keys", errors)
        body_regions = focus.get("body_regions")
        if _dict(body_regions, f"{path}.visual_focus.body_regions", errors):
            for ref, regions in body_regions.items():
                _list_of_strings(regions, f"{path}.visual_focus.body_regions.{ref}", errors)

    _state_map(director.get("action_delta"), f"{path}.action_delta", errors)
    _state_map(director.get("state_out"), f"{path}.state_out", errors)

    scope = director.get("continuity_scope")
    if _dict(scope, f"{path}.continuity_scope", errors):
        inherit = scope.get("inherit")
        if inherit is not None:
            if _dict(inherit, f"{path}.continuity_scope.inherit", errors):
                chars = inherit.get("characters")
                if _dict(chars, f"{path}.continuity_scope.inherit.characters", errors):
                    for ref, fields in chars.items():
                        _list_of_strings(fields, f"{path}.continuity_scope.inherit.characters.{ref}", errors)
                props = inherit.get("props")
                if _dict(props, f"{path}.continuity_scope.inherit.props", errors):
                    for ref, fields in props.items():
                        _list_of_strings(fields, f"{path}.continuity_scope.inherit.props.{ref}", errors)
                _list_of_strings(inherit.get("environment"), f"{path}.continuity_scope.inherit.environment", errors)


def validate_director_fragment_shape(director: Any) -> list[dict[str, Any]]:
    """Shape-check only fields owned by one Director Unit.

    Base Shot containers are validated at the Storyboard boundary and are deliberately
    excluded here so errors are attributed to the stage that owns them.
    """
    errors: list[dict[str, Any]] = []
    _director_fragment_shape(director, "director", errors)
    return errors


def _base_storyboard_shape(value: dict[str, Any], errors: list[dict[str, Any]], *, require_director: bool) -> None:
    scenes = _list_of_dicts(value.get("scenes"), "scenes", errors)
    for si, scene in enumerate(scenes):
        shots = _list_of_dicts(scene.get("shots"), f"scenes[{si}].shots", errors)
        for hi, shot in enumerate(shots):
            p = f"scenes[{si}].shots[{hi}]"
            _list_of_strings(shot.get("character_refs"), f"{p}.character_refs", errors)
            _list_of_strings(shot.get("prop_refs"), f"{p}.prop_refs", errors)
            _list_of_dicts(shot.get("dialogue"), f"{p}.dialogue", errors)
            _list_of_dicts(shot.get("source_evidence"), f"{p}.source_evidence", errors)
            _dict(shot.get("continuity"), f"{p}.continuity", errors)
            if require_director:
                _director_fragment_shape(shot.get("director"), f"{p}.director", errors)


def validate_stage_shape(stage: str, value: Any) -> list[dict[str, Any]]:
    """Validate only JSON container types before normalization/semantic validators.

    Model output is untrusted. This gate must never raise for malformed JSON shapes;
    it returns repairable validation errors instead.
    """
    errors: list[dict[str, Any]] = []
    if not _dict(value, "$", errors):
        return errors

    if stage == "story_bible":
        for key in ("characters", "scenes", "props", "narrative_contexts"):
            items = _list_of_dicts(value.get(key), key, errors)
            for idx, item in enumerate(items):
                p = f"{key}[{idx}]"
                if key == "characters":
                    _list(item.get("aliases"), f"{p}.aliases", errors)
                    _list(item.get("explicit_facts"), f"{p}.explicit_facts", errors)
                    _list(item.get("inferred_facts"), f"{p}.inferred_facts", errors)
                    _dict(item.get("identity_lock"), f"{p}.identity_lock", errors)
                    _dict(item.get("visual_lock"), f"{p}.visual_lock", errors)
                    _evidence_list(item.get("source_evidence"), f"{p}.source_evidence", errors)
                elif key == "scenes":
                    _list(item.get("explicit_facts"), f"{p}.explicit_facts", errors)
                    _dict(item.get("visual_lock"), f"{p}.visual_lock", errors)
                    _evidence_list(item.get("source_evidence"), f"{p}.source_evidence", errors)
                elif key == "props":
                    _list(item.get("aliases"), f"{p}.aliases", errors)
                    _list(item.get("explicit_facts"), f"{p}.explicit_facts", errors)
                    _evidence_list(item.get("source_evidence"), f"{p}.source_evidence", errors)
        return errors

    if stage == "scene_plan":
        scenes = _list_of_dicts(value.get("scenes"), "scenes", errors)
        for si, scene in enumerate(scenes):
            p = f"scenes[{si}]"
            _list_of_strings(scene.get("character_refs"), f"{p}.character_refs", errors)
            _list_of_strings(scene.get("prop_refs"), f"{p}.prop_refs", errors)
            _list_of_dicts(scene.get("beat_list"), f"{p}.beat_list", errors)
        return errors

    if stage == "script":
        scenes = _list_of_dicts(value.get("scenes"), "scenes", errors)
        for si, scene in enumerate(scenes):
            beats = _list_of_dicts(scene.get("beats"), f"scenes[{si}].beats", errors)
            for bi, beat in enumerate(beats):
                _list_of_dicts(beat.get("dialogue"), f"scenes[{si}].beats[{bi}].dialogue", errors)
        return errors

    if stage == "storyboard_base":
        _base_storyboard_shape(value, errors, require_director=False)
        return errors

    if stage == "director":
        _base_storyboard_shape(value, errors, require_director=True)
        return errors

    if stage == "pvb":
        chars = _list_of_dicts(value.get("characters"), "characters", errors)
        for ci, char in enumerate(chars):
            p = f"characters[{ci}]"
            for section in ("visual_identity", "wardrobe"):
                data = char.get(section)
                if _dict(data, f"{p}.{section}", errors):
                    for field, leaf in data.items():
                        _dict(leaf, f"{p}.{section}.{field}", errors)
        return errors

    if stage == "psb":
        scenes = _list_of_dicts(value.get("scenes"), "scenes", errors)
        for si, scene in enumerate(scenes):
            production = scene.get("production_visual")
            if _dict(production, f"scenes[{si}].production_visual", errors):
                for field, leaf in production.items():
                    _dict(leaf, f"scenes[{si}].production_visual.{field}", errors)
        return errors

    if stage == "style_guide":
        for field in ("era", "region", "genre", "tone", "visual_reference"):
            _dict(value.get(field), field, errors)
        return errors

    errors.append({"type": "shape_unknown_stage", "detail": f"unknown stage: {stage}"})
    return errors

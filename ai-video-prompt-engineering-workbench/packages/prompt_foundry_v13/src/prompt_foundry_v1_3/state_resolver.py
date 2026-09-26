from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional

STATE_KEYS = ('characters', 'props', 'environment')
CONTINUITY_MODES = {'inherit', 'partial', 'reset'}


def empty_state() -> Dict[str, dict]:
    return {'characters': {}, 'props': {}, 'environment': {}}


def _validate_state_map(value: Any, name: str) -> Dict[str, dict]:
    if not isinstance(value, dict):
        raise ValueError(f'{name} must be an object')
    for key in STATE_KEYS:
        if key not in value or not isinstance(value.get(key), dict):
            raise ValueError(f'{name}.{key} must be an object')
    return value


def _validate_partial_scope(scope: dict) -> dict:
    inherit = scope.get('inherit')
    if not isinstance(inherit, dict):
        raise ValueError('partial continuity requires explicit inherit map')

    chars = inherit.get('characters', {})
    props = inherit.get('props', {})
    env = inherit.get('environment', [])
    if not isinstance(chars, dict):
        raise ValueError('partial continuity inherit.characters must be an object')
    if not isinstance(props, dict):
        raise ValueError('partial continuity inherit.props must be an object')
    if not isinstance(env, list) or not all(isinstance(x, str) and x for x in env):
        raise ValueError('partial continuity inherit.environment must be a string array')
    for ref, fields in chars.items():
        if not isinstance(ref, str) or not ref:
            raise ValueError('partial continuity character ref must be non-empty')
        if not isinstance(fields, list) or not fields or not all(isinstance(x, str) and x for x in fields):
            raise ValueError(f'partial continuity character fields for {ref} must be a non-empty string array')
    for ref, fields in props.items():
        if not isinstance(ref, str) or not ref:
            raise ValueError('partial continuity prop ref must be non-empty')
        if not isinstance(fields, list) or not fields or not all(isinstance(x, str) and x for x in fields):
            raise ValueError(f'partial continuity prop fields for {ref} must be a non-empty string array')
    return inherit


def resolve_state_in(previous_state_out: Optional[dict], continuity_scope: dict) -> Dict[str, dict]:
    """Resolve program-owned state_in using only previous state_out + continuity_scope.

    No action_delta, description, dialogue, composition, or semantic inference is used.
    """
    if not isinstance(continuity_scope, dict):
        raise ValueError('continuity_scope must be an object')
    mode = continuity_scope.get('mode')
    if mode not in CONTINUITY_MODES:
        raise ValueError(f'unsupported continuity mode: {mode}')

    if mode == 'reset':
        return empty_state()

    previous = _validate_state_map(previous_state_out or empty_state(), 'previous_state_out')
    if mode == 'inherit':
        return deepcopy(previous)

    inherit = _validate_partial_scope(continuity_scope)
    result = empty_state()

    for ref, fields in inherit.get('characters', {}).items():
        source = previous['characters'].get(ref)
        if not isinstance(source, dict):
            raise ValueError(f'missing inherited character state: {ref}')
        selected = {}
        for field in fields:
            if field not in source:
                raise ValueError(f'missing inherited character field: {ref}.{field}')
            selected[field] = deepcopy(source[field])
        result['characters'][ref] = selected

    for ref, fields in inherit.get('props', {}).items():
        source = previous['props'].get(ref)
        if not isinstance(source, dict):
            raise ValueError(f'missing inherited prop state: {ref}')
        selected = {}
        for field in fields:
            if field not in source:
                raise ValueError(f'missing inherited prop field: {ref}.{field}')
            selected[field] = deepcopy(source[field])
        result['props'][ref] = selected

    for field in inherit.get('environment', []):
        if field not in previous['environment']:
            raise ValueError(f'missing inherited environment field: {field}')
        result['environment'][field] = deepcopy(previous['environment'][field])

    return result


def _validate_scene(storyboard_scene: dict) -> None:
    required = ('scene_id', 'context_ref', 'location_ref', 'shots')
    missing = [key for key in required if key not in storyboard_scene]
    if missing:
        raise ValueError('Storyboard Scene missing required fields: ' + ', '.join(missing))
    if not storyboard_scene.get('scene_id'):
        raise ValueError('Storyboard Scene scene_id must be non-empty')
    if not storyboard_scene.get('location_ref'):
        raise ValueError('Storyboard Scene location_ref must be non-empty')
    if not isinstance(storyboard_scene.get('shots'), list):
        raise ValueError('Storyboard Scene shots must be an array')


def _validate_shot(shot: dict, parent_scene_id: str) -> None:
    required = ('shot_id', 'scene_id', 'beat_id', 'character_refs', 'prop_refs', 'director')
    missing = [key for key in required if key not in shot]
    if missing:
        raise ValueError('Storyboard Shot missing required field: ' + ', '.join(missing))
    if shot.get('scene_id') != parent_scene_id:
        raise ValueError(f"{shot.get('shot_id')}: shot scene_id must equal parent scene_id")
    if not shot.get('shot_id'):
        raise ValueError('shot_id must be non-empty')
    if not isinstance(shot.get('character_refs'), list):
        raise ValueError(f"{shot.get('shot_id')}: character_refs must be an array")
    if not isinstance(shot.get('prop_refs'), list):
        raise ValueError(f"{shot.get('shot_id')}: prop_refs must be an array")
    if not isinstance(shot.get('director'), dict):
        raise ValueError(f"{shot.get('shot_id')}: director must be an object")
    director = shot['director']
    _validate_state_map(director.get('action_delta'), 'director.action_delta')
    _validate_state_map(director.get('state_out'), 'director.state_out')
    if not isinstance(director.get('continuity_scope'), dict):
        raise ValueError(f"{shot.get('shot_id')}: director.continuity_scope must be an object")


def build_shot_specs_v1_3(
    storyboard_scene: dict,
    previous_state_out: Optional[dict] = None,
) -> List[dict]:
    """Build ShotSpec v1.3 for one Storyboard Scene without semantic inference."""
    _validate_scene(storyboard_scene)

    scene_id = storyboard_scene['scene_id']
    context_ref = storyboard_scene.get('context_ref') or ''
    location_ref = storyboard_scene['location_ref']
    previous = deepcopy(previous_state_out) if previous_state_out is not None else empty_state()

    specs: List[dict] = []
    seen_ids = set()
    for shot in storyboard_scene['shots']:
        _validate_shot(shot, scene_id)
        shot_id = shot['shot_id']
        if shot_id in seen_ids:
            raise ValueError(f'duplicate shot_id: {shot_id}')
        seen_ids.add(shot_id)

        director = deepcopy(shot['director'])
        state_in = resolve_state_in(previous, director['continuity_scope'])

        specs.append({
            'shot_id': shot_id,
            'scene_id': scene_id,
            'context_ref': context_ref,
            'beat_id': shot.get('beat_id'),
            'location_ref': location_ref,
            'character_refs': list(shot.get('character_refs') or []),
            'prop_refs': list(shot.get('prop_refs') or []),
            'shot_size': shot.get('shot_size'),
            'camera': shot.get('camera'),
            'movement': shot.get('movement'),
            'composition': shot.get('composition', ''),
            'duration': shot.get('duration'),
            'director': director,
            'state_in': state_in,
            'description': shot.get('description', ''),
            'dialogue': deepcopy(shot.get('dialogue') or []),
            'continuity': deepcopy(shot.get('continuity') or {}),
            'source_evidence': deepcopy(shot.get('source_evidence') or []),
        })
        previous = deepcopy(director['state_out'])

    return specs


def build_storyboard_shot_specs_v1_3(storyboard: dict) -> List[dict]:
    """Build all ShotSpec v1.3 records in Storyboard order.

    State can cross Scene boundaries only when the next Shot's continuity_scope
    explicitly asks to inherit or partially inherit it.
    """
    scenes = storyboard.get('scenes')
    if not isinstance(scenes, list):
        raise ValueError('Storyboard scenes must be an array')

    result: List[dict] = []
    previous = empty_state()
    seen_ids = set()
    has_previous_shot = False
    for scene in scenes:
        scene_shots = scene.get('shots') if isinstance(scene, dict) else None
        if isinstance(scene_shots, list) and scene_shots and not has_previous_shot:
            first_director = scene_shots[0].get('director') if isinstance(scene_shots[0], dict) else None
            first_scope = first_director.get('continuity_scope') if isinstance(first_director, dict) else None
            if not isinstance(first_scope, dict) or first_scope.get('mode') != 'reset':
                raise ValueError('first storyboard shot must use reset continuity when no prior state exists')
        specs = build_shot_specs_v1_3(scene, previous_state_out=previous)
        for spec in specs:
            if spec['shot_id'] in seen_ids:
                raise ValueError(f"duplicate shot_id across storyboard: {spec['shot_id']}")
            seen_ids.add(spec['shot_id'])
            result.append(spec)
        if specs:
            previous = deepcopy(specs[-1]['director']['state_out'])
            has_previous_shot = True
    return result

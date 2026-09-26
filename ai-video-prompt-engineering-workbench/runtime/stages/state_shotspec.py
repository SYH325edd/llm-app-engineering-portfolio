from __future__ import annotations

import copy
from typing import Any

from prompt_foundry_v1_3.state_resolver import build_shot_specs_v1_3
from prompt_foundry_v1_3 import build_storyboard_shot_specs_v1_3

from runtime.context_state import CONTEXT_STATE_POLICY_VERSION, ContextStateCursor

CONTRACT_VERSION = 'state_shotspec.v2'


def build_state_shotspec_payload(storyboard: dict[str, Any], scene_plan: dict[str, Any] | None = None) -> dict[str, Any]:
    payload = {'contract_version': CONTRACT_VERSION, 'storyboard': copy.deepcopy(storyboard)}
    if scene_plan is not None:
        payload['context_state_policy'] = CONTEXT_STATE_POLICY_VERSION
        payload['scene_plan_contexts'] = [
            {
                'scene_id': scene.get('scene_id'),
                'context_ref': scene.get('context_ref') or '',
                'context_transition': scene.get('context_transition') or '',
                'resume_context_ref': scene.get('resume_context_ref') or '',
            }
            for scene in scene_plan.get('scenes', []) or []
            if isinstance(scene, dict)
        ]
    return payload


def _context_aware_specs(storyboard: dict[str, Any], scene_plan: dict[str, Any]) -> list[dict[str, Any]]:
    plan_by_scene = {
        str(scene.get('scene_id')): scene
        for scene in scene_plan.get('scenes', []) or []
        if isinstance(scene, dict) and scene.get('scene_id')
    }
    cursor = ContextStateCursor()
    result: list[dict[str, Any]] = []
    first_global_shot = True
    current_state = {'characters': {}, 'props': {}, 'environment': {}}

    for scene in storyboard.get('scenes', []) or []:
        if not isinstance(scene, dict):
            raise ValueError('Storyboard Scene must be object')
        scene_id = str(scene.get('scene_id') or '')
        plan_scene = plan_by_scene.get(scene_id)
        if not isinstance(plan_scene, dict):
            raise ValueError(f'missing Scene Plan context metadata for {scene_id}')
        seed = cursor.begin_scene(plan_scene, current_state)
        shots = scene.get('shots') or []
        if shots and first_global_shot:
            first_director = shots[0].get('director') if isinstance(shots[0], dict) else None
            first_scope = first_director.get('continuity_scope') if isinstance(first_director, dict) else None
            if not isinstance(first_scope, dict) or first_scope.get('mode') != 'reset':
                raise ValueError('first storyboard shot must use reset continuity when no prior state exists')
        specs = build_shot_specs_v1_3(scene, previous_state_out=seed)
        authoritative_scene_time = str(plan_scene.get('time_of_day') or plan_scene.get('time') or '').strip()
        for spec in specs:
            if authoritative_scene_time:
                spec['authoritative_scene_time'] = authoritative_scene_time
        result.extend(specs)
        if specs:
            current_state = copy.deepcopy(specs[-1]['director']['state_out'])
            cursor.finish_shot(current_state)
            first_global_shot = False
        else:
            current_state = copy.deepcopy(seed)
    return result




def _overlay_runtime_shot_fields(storyboard: dict[str, Any], specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Carry Runtime-owned frozen Shot fields that Frozen v1.3 ShotSpec predates.

    This is representation-preserving only: values are copied verbatim from the
    validated Storyboard by shot_id. No semantic inference or rewriting occurs.
    """
    by_id = {
        str(shot.get('shot_id')): shot
        for scene in storyboard.get('scenes', []) or []
        if isinstance(scene, dict)
        for shot in scene.get('shots', []) or []
        if isinstance(shot, dict) and shot.get('shot_id')
    }
    out: list[dict[str, Any]] = []
    for spec in specs:
        item = copy.deepcopy(spec)
        source = by_id.get(str(item.get('shot_id'))) or {}
        item['narration'] = copy.deepcopy(source.get('narration') or [])
        base_design = {
            'shot_size': source.get('shot_size'),
            'camera': source.get('camera'),
            'movement': source.get('movement'),
        }
        execution_design = ((source.get('director') or {}).get('execution_shot_design') or {}) if isinstance(source.get('director'), dict) else {}
        item['base_shot_design'] = copy.deepcopy(base_design)
        item['effective_shot_design_source'] = 'director_v17' if all(execution_design.get(k) for k in ('shot_size','camera','movement')) else 'storyboard_base'
        for design_field in ('shot_size', 'camera', 'movement'):
            if isinstance(execution_design.get(design_field), str) and execution_design.get(design_field):
                item[design_field] = execution_design[design_field]
        item['frozen_text_unit_refs'] = copy.deepcopy(
            source.get('frozen_text_unit_refs')
            if isinstance(source.get('frozen_text_unit_refs'), dict)
            else {'dialogue': [], 'narration': []}
        )
        out.append(item)
    return out

def build_state_shot_specs(
    storyboard: dict[str, Any],
    *,
    scene_plan: dict[str, Any] | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    try:
        specs = _context_aware_specs(storyboard, scene_plan) if scene_plan is not None else build_storyboard_shot_specs_v1_3(storyboard)
        specs = _overlay_runtime_shot_fields(storyboard, specs)
    except Exception as exc:
        return [], [{'type': 'shot_spec_build_failure', 'detail': str(exc)}]

    expected_ids = [
        str(shot.get('shot_id'))
        for scene in storyboard.get('scenes', []) or []
        for shot in scene.get('shots', []) or []
    ]
    actual_ids = [str(spec.get('shot_id')) for spec in specs]
    errors: list[dict[str, Any]] = []
    if actual_ids != expected_ids:
        errors.append({'type': 'shot_spec_order_mismatch', 'detail': f'expected {expected_ids}, got {actual_ids}'})
    if len(specs) != len(expected_ids):
        errors.append({'type': 'shot_spec_count_mismatch', 'detail': f'expected {len(expected_ids)} specs, got {len(specs)}'})
    return specs, errors


def validate_context_state_shot_specs(
    storyboard: dict[str, Any],
    scene_plan: dict[str, Any],
    shot_specs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    expected, build_errors = build_state_shot_specs(storyboard, scene_plan=scene_plan)
    if build_errors:
        return [
            {
                'category': 'STRUCTURE',
                'type': 'runtime_context_state_resolution_failure',
                'shot_id': '',
                'detail': '; '.join(str(item.get('detail') or item) for item in build_errors),
            }
        ]

    errors: list[dict[str, Any]] = []
    expected_by_id = {str(spec.get('shot_id')): spec for spec in expected}
    actual_by_id = {str(spec.get('shot_id')): spec for spec in shot_specs or []}
    if list(expected_by_id) != list(actual_by_id):
        errors.append({
            'category': 'STRUCTURE',
            'type': 'runtime_context_state_order_mismatch',
            'shot_id': '',
            'detail': f'expected {list(expected_by_id)}, got {list(actual_by_id)}',
        })
        return errors

    for shot_id, expected_spec in expected_by_id.items():
        actual_spec = actual_by_id[shot_id]
        if actual_spec.get('state_in') != expected_spec.get('state_in'):
            errors.append({
                'category': 'STRUCTURE',
                'type': 'runtime_context_state_chain_mismatch',
                'shot_id': shot_id,
                'detail': 'state_in does not equal Scene Plan v4 context-aware scheduling + Frozen continuity resolution',
            })
    return errors

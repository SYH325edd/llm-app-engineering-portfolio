from __future__ import annotations

import copy
from typing import Any

from prompt_foundry_v1_3 import compile_project_v1_3, evaluate_v1_3_static, validate_pvb_optional_semantics_v1_3d
from runtime.consumption_compiler import (
    compile_project_consumption_v1,
    compile_project_consumption_v2d,
    missing_visible_character_identity_refs,
)
from runtime.production_readiness import validate_production_readiness
from runtime.stages.director import CONTRACT_VERSION as DIRECTOR_CONTRACT_VERSION, derive_state_out_v10
from runtime.stages.state_shotspec import validate_context_state_shot_specs
from runtime.frozen_text_coverage import build_frozen_text_coverage_manifest, validate_frozen_text_coverage
from runtime.stages.storyboard import build_frozen_text_units
from prompt_foundry_v1_3.pvb_optional import confirm_all_character_v1_3d, lock_all_character_v1_3d

LOCK_POLICY = 'runtime_auto_production_lock.v1'


def validate_visible_character_asset_preflight(
    story_bible: dict[str, Any],
    pvb: dict[str, Any],
    shot_specs: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Block before final compile when a visible character has no renderable identity asset.

    E023 is a final-surface integrity gate.  Missing canonical character assets are
    an upstream asset-contract failure and must be attributed to the owning PVB
    unit so recovery regenerates the asset instead of pointlessly rerunning Director.
    """
    errors: list[dict[str, Any]] = []
    for shot in shot_specs or []:
        missing = missing_visible_character_identity_refs(story_bible, pvb, shot)
        if not missing:
            continue
        errors.append({
            'type': 'pvb_visible_identity_anchor_missing',
            'shot_id': str(shot.get('shot_id') or ''),
            'target_character_refs': missing,
            'source_layer': 'PVB Canonical Asset Registry',
            'detail': 'visible characters cannot form a consumable canonical identity anchor',
        })
    return errors


_V10_OBSOLETE_FROZEN_STATIC_STATE_ERRORS = {
    'action_delta_not_reflected_in_state_out',
    'state_out_change_without_delta',
    # Runtime 2.1 owns visible micro-performance wording. Frozen v1.3 required
    # every modifier token to be copied from evidence, which conflicts with the
    # current contract that permits non-story-changing acting detail.
    'unsupported_performance_modifier',
}


def _static_summary(errors: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        'error_count': len(errors),
        'categories': {
            category: sum(1 for item in errors if item.get('category') == category)
            for category in ('STRUCTURE', 'REFERENCE', 'AUTHORITY', 'COMPILER')
        },
    }


def _runtime_segmented_dialogue_ownership(script: dict[str, Any], storyboard: dict[str, Any]) -> set[str]:
    allowed_by_beat: dict[tuple[str, str], set[tuple[str, str]]] = {}
    for scene in script.get('scenes', []) or []:
        if not isinstance(scene, dict):
            continue
        sid = str(scene.get('scene_id') or '')
        frozen = build_frozen_text_units(scene)
        for bid, group in frozen.items():
            allowed_by_beat[(sid, str(bid))] = {
                (str(unit.get('character_id') or ''), str(unit.get('text') or ''))
                for unit in (group.get('dialogue') or [])
                if isinstance(unit, dict) and unit.get('character_id') and unit.get('text') is not None
            }
    valid_shots: set[str] = set()
    for scene in storyboard.get('scenes', []) or []:
        if not isinstance(scene, dict):
            continue
        sid = str(scene.get('scene_id') or '')
        for shot in scene.get('shots', []) or []:
            if not isinstance(shot, dict) or not shot.get('shot_id'):
                continue
            pairs = [
                (str(item.get('character_id') or ''), str(item.get('line') or ''))
                for item in (shot.get('dialogue') or [])
                if isinstance(item, dict) and item.get('character_id') and item.get('line') is not None
            ]
            if pairs and all(pair in allowed_by_beat.get((sid, str(shot.get('beat_id') or '')), set()) for pair in pairs):
                valid_shots.add(str(shot.get('shot_id')))
    return valid_shots


def _adapt_legacy_static_evaluation_v10(
    raw: dict[str, Any],
    *,
    context_state_validated: bool = False,
    script: dict[str, Any] | None = None,
    storyboard: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Compatibility boundary for Frozen v1.3 vs Runtime state semantics.

    Director v10 owns deterministic state_out derivation. Scene Plan v4 additionally
    schedules which context state is the previous state at narrative boundaries. Frozen
    v1.3 remains linear across Scenes, so its linear-only chain errors are suppressed
    *only* after Runtime independently validates the context-aware chain.
    """
    out = copy.deepcopy(raw)
    all_errors = list(out.get('errors') or [])
    obsolete = set(_V10_OBSOLETE_FROZEN_STATIC_STATE_ERRORS)
    if context_state_validated:
        obsolete.update({'state_chain_mismatch', 'state_resolution_failure'})
    valid_segmented_dialogue_shots = (
        _runtime_segmented_dialogue_ownership(script, storyboard)
        if isinstance(script, dict) and isinstance(storyboard, dict) else set()
    )
    suppressed = []
    kept = []
    for item in all_errors:
        if item.get('type') in obsolete:
            suppressed.append(item)
            continue
        if item.get('type') == 'reaction_target_without_performance':
            # Frozen Core v1.3 coupled a visual reaction target to an objective
            # same-character action. Runtime Director separates those authorities:
            # reaction_target_refs are camera/visual choices, while
            # performance_actions remain evidence-bound story facts.
            suppressed.append(item)
            continue
        if item.get('type') == 'speaker_ownership_mismatch' and str(item.get('shot_id') or '') in valid_segmented_dialogue_shots:
            suppressed.append(item)
            continue
        kept.append(item)
    out['errors'] = kept
    out['passed'] = not kept
    out['summary'] = _static_summary(kept)
    out['compatibility_contract'] = DIRECTOR_CONTRACT_VERSION
    out['legacy_raw_passed'] = bool(raw.get('passed'))
    out['compatibility_suppressed_errors'] = suppressed
    return out


def _physical_state_v10_view(state: dict[str, Any]) -> dict[str, Any]:
    """Return the physical continuity subset owned by Runtime v10.

    Director v17 carries ``characters.<ref>.performance_baseline`` inside the
    context state so later Shots can inherit grounded acting context.  That
    field is a Runtime extension, not an ``action_delta``-owned physical state
    field, so comparing it against the v10 ``state_in + action_delta``
    derivation creates false compile failures whenever a baseline is created or
    updated.  Strip only that Runtime-owned extension; all physical continuity
    fields remain hard-validated.
    """
    out = copy.deepcopy(state if isinstance(state, dict) else {})
    characters = out.get('characters') if isinstance(out.get('characters'), dict) else {}
    for ref in list(characters):
        fields = characters.get(ref)
        if not isinstance(fields, dict):
            continue
        fields.pop('performance_baseline', None)
        if not fields:
            characters.pop(ref, None)
    out['characters'] = characters
    out.setdefault('props', {})
    out.setdefault('environment', {})
    return out


def _validate_runtime_v10_state_transitions(shot_specs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Revalidate physical state_out with Director v10 null-clear semantics.

    Runtime-carried Director extensions (currently performance_baseline) are
    validated by their owning Director/context path and must not be mistaken
    for action_delta-derived physical state.
    """
    errors: list[dict[str, Any]] = []
    for shot in shot_specs or []:
        director = shot.get('director') or {}
        state_in = shot.get('state_in') or {'characters': {}, 'props': {}, 'environment': {}}
        delta = director.get('action_delta') or {'characters': {}, 'props': {}, 'environment': {}}
        actual = director.get('state_out') or {'characters': {}, 'props': {}, 'environment': {}}
        expected = derive_state_out_v10(state_in, delta)
        if _physical_state_v10_view(actual) != _physical_state_v10_view(expected):
            errors.append({
                'category': 'STRUCTURE',
                'type': 'runtime_state_out_derivation_mismatch',
                'shot_id': shot.get('shot_id', ''),
                'detail': 'physical state_out does not equal Runtime v10 derivation of state_in + action_delta',
            })
    return errors


def _append_static_errors(static_eval: dict[str, Any], extra: list[dict[str, Any]]) -> dict[str, Any]:
    if not extra:
        return static_eval
    out = copy.deepcopy(static_eval)
    merged = list(out.get('errors') or []) + copy.deepcopy(extra)
    out['errors'] = merged
    out['passed'] = not merged
    out['summary'] = _static_summary(merged)
    return out


def lock_production_assets(
    story_bible: dict[str, Any],
    pvb_candidate: dict[str, Any],
    psb_candidate: dict[str, Any],
    style_candidate: dict[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    pvb = copy.deepcopy(pvb_candidate)
    psb = copy.deepcopy(psb_candidate)
    style = copy.deepcopy(style_candidate)
    errors: list[dict[str, Any]] = []

    # PVB uses the Frozen review lifecycle explicitly: candidate -> confirmed -> locked.
    for char in pvb.get('characters', []) or []:
        cid = char.get('character_id')
        try:
            confirm_all_character_v1_3d(pvb, cid, reviewer='runtime_auto_production_lock', note='Runtime production approval')
            lock_all_character_v1_3d(pvb, cid, reviewer='runtime_auto_production_lock', note='Runtime production lock')
        except Exception as exc:
            errors.append({'type': 'pvb_production_lock_failure', 'target_id': cid, 'detail': str(exc)})
    pvb_validation = validate_pvb_optional_semantics_v1_3d(story_bible, pvb)
    for item in pvb_validation.get('errors', []) or []:
        errors.append({'type': 'pvb_locked_validation_error', 'detail': str(item)})

    # PSB and Style have no Frozen review helper; the explicit Runtime production
    # policy transitions only candidate/confirmed leaves to locked on a deep copy.
    for scene in psb.get('scenes', []) or []:
        production = scene.get('production_visual') or {}
        for field, entry in production.items():
            if not isinstance(entry, dict):
                errors.append({'type': 'psb_production_lock_failure', 'target_id': scene.get('scene_id'), 'detail': f'{field} is not object'})
                continue
            status = entry.get('status')
            if status in {'candidate', 'confirmed'}:
                entry['status'] = 'locked'
            elif status != 'skipped':
                errors.append({'type': 'psb_production_lock_failure', 'target_id': scene.get('scene_id'), 'detail': f'unsupported status for {field}: {status}'})
        consuming = [e for e in production.values() if isinstance(e, dict) and e.get('status') != 'skipped']
        scene['status'] = 'locked' if consuming and all(e.get('status') == 'locked' for e in consuming) else ('locked' if not consuming else 'candidate')

    for field, entry in style.items():
        if not isinstance(entry, dict):
            errors.append({'type': 'style_production_lock_failure', 'target_id': field, 'detail': 'style leaf must be object'})
            continue
        status = entry.get('status')
        if status in {'candidate', 'confirmed'}:
            entry['status'] = 'locked'
        elif status != 'locked':
            errors.append({'type': 'style_production_lock_failure', 'target_id': field, 'detail': f'unsupported status: {status}'})

    log = {
        'policy': LOCK_POLICY,
        'mode': 'production',
        'human_review_required': False,
        'detail': 'Explicit Runtime policy approves validated production-design candidates for local production compilation.',
    }
    return {'pvb': pvb, 'psb': psb, 'style_guide': style}, errors, log


def compile_and_evaluate(
    *,
    project_id: str,
    story_bible: dict[str, Any],
    script: dict[str, Any],
    storyboard: dict[str, Any],
    shot_specs: list[dict[str, Any]],
    pvb: dict[str, Any],
    psb: dict[str, Any],
    style_guide: dict[str, Any],
    scene_plan: dict[str, Any] | None = None,
    production_semantics: dict[str, Any] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    errors: list[dict[str, Any]] = []
    # Frozen Core remains the structural safety gate. Its output is retained only for
    # deterministic v1.3 evaluation and A/B compatibility; it is not the final platform prompt.
    legacy_compiled = compile_project_v1_3(project_id, story_bible, pvb, psb, style_guide, shot_specs, 'production')
    for failure in legacy_compiled.get('compile_failures', []) or []:
        errors.append({'type': 'legacy_compile_failure', 'target_id': failure.get('target_id'), 'detail': failure.get('detail')})
    legacy_static_eval = evaluate_v1_3_static(story_bible, script, storyboard, shot_specs, legacy_compiled)
    context_state_errors: list[dict[str, Any]] = []
    context_state_validated = False
    if scene_plan is not None:
        context_state_errors = validate_context_state_shot_specs(storyboard, scene_plan, shot_specs)
        context_state_validated = not context_state_errors
    static_eval = _adapt_legacy_static_evaluation_v10(
        legacy_static_eval, context_state_validated=context_state_validated,
        script=script, storyboard=storyboard,
    )
    static_eval = _append_static_errors(static_eval, context_state_errors)
    static_eval = _append_static_errors(static_eval, _validate_runtime_v10_state_transitions(shot_specs))
    if not static_eval.get('passed'):
        errors.extend(copy.deepcopy(static_eval.get('errors') or []))

    # Patch 08: v2b becomes authoritative after the Patch 07 A/B gate.
    # Keep the complete v1 result as an explicit regression reference.
    compiled_v1 = compile_project_consumption_v1(
        project_id, story_bible, script, pvb, psb, style_guide, shot_specs
    )
    compiled = compile_project_consumption_v2d(
        project_id, story_bible, script, pvb, psb, style_guide, shot_specs, production_semantics
    )
    frozen_text_coverage = build_frozen_text_coverage_manifest(
        script, storyboard, shot_specs, compiled
    )
    compiled['frozen_text_coverage'] = copy.deepcopy(frozen_text_coverage)
    frozen_text_errors = validate_frozen_text_coverage(frozen_text_coverage)
    if frozen_text_errors:
        errors.extend(copy.deepcopy(frozen_text_errors))
    for failure in compiled.get('compile_failures', []) or []:
        errors.append({
            'type': 'consumption_compile_failure',
            'target_id': failure.get('target_id'),
            'detail': failure.get('detail'),
        })

    consumption_errors = [
        dict(item, shot_id=shot.get('shot_id'))
        for shot in compiled.get('shot_prompts', []) or []
        for item in shot.get('errors', []) or []
    ]
    consumption_warnings = copy.deepcopy(compiled.get('warnings') or [])
    production_readiness = validate_production_readiness(
        compiled_project=compiled, shot_specs=shot_specs, script=script
    )
    if not production_readiness.get('passed'):
        errors.extend(copy.deepcopy(production_readiness.get('errors') or []))
    consumption_eval = {
        'compiler_version': compiled.get('compiler_version'),
        'passed': not consumption_errors and bool(production_readiness.get('passed')),
        'compile_status': compiled.get('compile_status'),
        'errors': consumption_errors + copy.deepcopy(production_readiness.get('errors') or []),
        'warnings': consumption_warnings + copy.deepcopy(production_readiness.get('warnings') or []),
        'summary': copy.deepcopy(compiled.get('summary') or {}),
        'ab_reference_compiler': compiled_v1.get('compiler_version'),
        'frozen_text_coverage': copy.deepcopy(frozen_text_coverage),
        'production_readiness': copy.deepcopy(production_readiness),
    }
    return {
        'compiled_project': compiled,
        'consumption_v1_compiled_project': compiled_v1,
        'legacy_compiled_project': legacy_compiled,
        'static_evaluation': static_eval,
        'consumption_evaluation': consumption_eval,
        'production_readiness': production_readiness,
    }, errors

from __future__ import annotations

from typing import Any, Dict, List

from . import director_contract as _phase_a
from . import state_resolver as _phase_b

def _error(errors: List[dict], category: str, etype: str, shot_id: str, detail: str) -> None:
    errors.append({'category': category, 'type': etype, 'shot_id': shot_id, 'detail': detail})


def _categorize_director_error(etype: str) -> str:
    if 'ref' in etype or 'speaker_ownership' in etype or 'speaker_target' in etype:
        return 'REFERENCE'
    if etype in {
        'unsupported_performance_modifier', 'reaction_target_without_performance',
        'director_owns_no_state_in', 'forbidden_director_prompt_field',
    }:
        return 'AUTHORITY'
    return 'STRUCTURE'


def _state_nonempty(state: dict) -> bool:
    return any(bool((state or {}).get(key)) for key in ('characters', 'props', 'environment'))


def _focus_has_renderable_content(focus: dict) -> bool:
    if not isinstance(focus, dict):
        return False
    return bool(
        focus.get('subject_refs')
        or focus.get('body_regions')
        or focus.get('prop_refs')
        or focus.get('environment_keys')
    )


def _delta_reflected(delta: dict, state_out: dict) -> List[str]:
    missing: List[str] = []
    for section in ('characters', 'props'):
        for ref, fields in (delta.get(section, {}) or {}).items():
            target = (state_out.get(section, {}) or {}).get(ref)
            if not isinstance(target, dict):
                missing.append(f'{section}.{ref}')
                continue
            for field, value in (fields or {}).items():
                if field not in target or target[field] != value:
                    missing.append(f'{section}.{ref}.{field}')
    for field, value in (delta.get('environment', {}) or {}).items():
        target = state_out.get('environment', {}) or {}
        if field not in target or target[field] != value:
            missing.append(f'environment.{field}')
    return missing


def _state_fields(state: dict) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    for section in ('characters', 'props'):
        for ref, fields in ((state or {}).get(section, {}) or {}).items():
            for field, value in (fields or {}).items():
                out[f'{section}.{ref}.{field}'] = value
    for field, value in ((state or {}).get('environment', {}) or {}).items():
        out[f'environment.{field}'] = value
    return out


def _stale_delta_paths(state_in: dict, delta: dict) -> List[str]:
    before = _state_fields(state_in)
    changes = _state_fields(delta)
    return [path for path, value in changes.items() if path in before and before[path] == value]


def _state_out_changes_without_delta(state_in: dict, delta: dict, state_out: dict) -> List[str]:
    before = _state_fields(state_in)
    changes = _state_fields(delta)
    after = _state_fields(state_out)
    missing: List[str] = []
    for path, value in after.items():
        if path not in before or before[path] != value:
            if path not in changes or changes[path] != value:
                missing.append(path)
    return missing


def _body_detail_refs(director: dict) -> set[str]:
    out: set[str] = set()
    for item in director.get('performance_actions', []) or []:
        if 'body_detail' in set(item.get('dependency_tags', []) or []):
            ref = item.get('character_ref')
            if ref:
                out.add(ref)
    return out


def _segment_types(compiled: dict) -> set[str]:
    return {s.get('segment_type') for s in compiled.get('prompt_segments', []) or [] if isinstance(s, dict)}


def evaluate_v1_3_static(
    story_bible: dict,
    script: dict,
    storyboard: dict,
    shot_specs: List[dict],
    compiled_project: dict,
) -> Dict[str, Any]:
    """Deterministic v1.3 static gate. This is not a real-model quality judge."""
    errors: List[dict] = []

    director_result = _phase_a.validate_storyboard_director_v1_3a(story_bible, script, storyboard)
    for item in director_result.get('errors', []) or []:
        _error(
            errors,
            _categorize_director_error(item.get('type', '')),
            item.get('type', 'director_contract_error'),
            item.get('shot_id', ''),
            item.get('detail', ''),
        )

    previous = _phase_b.empty_state()
    for index, shot in enumerate(shot_specs or []):
        sid = shot.get('shot_id', '')
        director = shot.get('director') or {}
        scope = director.get('continuity_scope') or {}
        try:
            if index == 0 and scope.get('mode') != 'reset':
                _error(errors, 'STRUCTURE', 'first_shot_not_reset', sid, 'first ShotSpec must reset when no prior state exists')
                expected = _phase_b.empty_state()
            else:
                expected = _phase_b.resolve_state_in(previous, scope)
            if shot.get('state_in') != expected:
                _error(errors, 'STRUCTURE', 'state_chain_mismatch', sid, 'state_in does not equal deterministic previous.state_out + continuity_scope result')
        except Exception as exc:
            _error(errors, 'STRUCTURE', 'state_resolution_failure', sid, str(exc))

        state_in = shot.get('state_in') or _phase_b.empty_state()
        delta = director.get('action_delta') or _phase_b.empty_state()
        state_out = director.get('state_out') or _phase_b.empty_state()

        missing_delta = _delta_reflected(delta, state_out)
        if missing_delta:
            _error(
                errors, 'STRUCTURE', 'action_delta_not_reflected_in_state_out', sid,
                'action_delta field(s) not reflected in state_out: ' + ', '.join(missing_delta),
            )

        stale_delta = _stale_delta_paths(state_in, delta)
        if stale_delta:
            _error(
                errors, 'STRUCTURE', 'stale_action_delta', sid,
                'action_delta repeats unchanged state_in field(s): ' + ', '.join(stale_delta),
            )

        undeclared_changes = _state_out_changes_without_delta(state_in, delta, state_out)
        if undeclared_changes:
            _error(
                errors, 'STRUCTURE', 'state_out_change_without_delta', sid,
                'state_out changes field(s) not declared in action_delta: ' + ', '.join(undeclared_changes),
            )

        previous = state_out

    for failure in compiled_project.get('compile_failures', []) or []:
        _error(errors, 'COMPILER', 'compile_failure', failure.get('target_id', ''), failure.get('detail', ''))

    compiled_by_id = {item.get('shot_id'): item for item in compiled_project.get('shot_prompts', []) or []}
    for shot in shot_specs or []:
        sid = shot.get('shot_id', '')
        compiled = compiled_by_id.get(sid)
        if not compiled:
            _error(errors, 'COMPILER', 'missing_compiled_shot', sid, 'no compiled Shot Prompt found')
            continue

        segments = compiled.get('prompt_segments', []) or []
        types = _segment_types(compiled)
        required = {'camera', 'platform_constraint'}
        if shot.get('character_refs') or shot.get('prop_refs'):
            required.add('character_visual')
        if (shot.get('description') or '').strip():
            required.add('action')
        if (shot.get('director') or {}).get('performance_actions'):
            required.add('performance')
        if _focus_has_renderable_content((shot.get('director') or {}).get('visual_focus') or {}):
            required.add('visual_focus')
        if _state_nonempty(shot.get('state_in') or {}):
            required.add('state')
        if _state_nonempty((shot.get('director') or {}).get('action_delta') or {}):
            required.add('state')
        if shot.get('dialogue'):
            required.add('dialogue')
        for segment_type in sorted(required - types):
            _error(errors, 'COMPILER', 'missing_prompt_segment', sid, f'missing required prompt segment type: {segment_type}')

        for segment in segments:
            sources = segment.get('sources') if isinstance(segment, dict) else None
            if not isinstance(sources, list) or not sources:
                _error(errors, 'COMPILER', 'missing_provenance', sid, f"segment {segment.get('segment_id', '')} has no provenance sources")
                continue
            for source in sources:
                if not isinstance(source, dict) or not source.get('source') or not source.get('source_ref'):
                    _error(errors, 'COMPILER', 'missing_provenance', sid, f"segment {segment.get('segment_id', '')} has incomplete provenance source")

        prompt = compiled.get('prompt_seedance') or ''
        dramatic_intent = str((shot.get('director') or {}).get('dramatic_intent') or '').strip()
        if dramatic_intent and dramatic_intent in prompt:
            _error(errors, 'AUTHORITY', 'dramatic_intent_leaked_to_prompt', sid, 'internal dramatic_intent must not be sent directly to platform Prompt')

        for item in shot.get('dialogue') or []:
            line = item.get('line') or item.get('text') or ''
            if line and line not in prompt:
                _error(errors, 'COMPILER', 'dialogue_not_preserved_in_prompt', sid, f'dialogue missing from compiled Prompt: {line}')

        view = compiled.get('consumption_view') or {}
        if view.get('selector_version') != '1.3':
            _error(errors, 'COMPILER', 'wrong_selector_version', sid, 'v1.3 compiled Prompt must use selector_version=1.3')
        if 'hints' in view:
            _error(errors, 'AUTHORITY', 'manual_visibility_hints_present', sid, 'v1.3 production consumption_view must not contain manual hints')

        body_detail_refs = _body_detail_refs(shot.get('director') or {})
        for cid, data in (view.get('characters') or {}).items():
            selected = set((data or {}).get('selected_fields') or [])
            if 'skin' in selected and cid not in body_detail_refs:
                _error(errors, 'COMPILER', 'invalid_skin_consumption', sid, f'{cid} consumes skin without same-character body_detail dependency')

    return {
        'passed': not errors,
        'errors': errors,
        'summary': {
            'error_count': len(errors),
            'categories': {
                category: sum(1 for item in errors if item.get('category') == category)
                for category in ('STRUCTURE', 'REFERENCE', 'AUTHORITY', 'COMPILER')
            },
        },
    }

from __future__ import annotations

import copy

from prompt_foundry_v1_3.state_resolver import empty_state
from runtime.stages.director import (
    build_director_shot_payload,
    canonicalize_director_fragment,
    validate_director_fragment,
)
from tests.api.fixtures.mock_story_run import RESPONSES


def _context(previous=None):
    shot = copy.deepcopy(RESPONSES['storyboard_base']['scenes'][0]['shots'][0])
    beat = copy.deepcopy(RESPONSES['script']['scenes'][0]['beats'][0])
    return {
        'shot': shot,
        'script_beat': beat,
        'assets': {
            'characters': {'char_001': copy.deepcopy(RESPONSES['story_bible']['characters'][0])},
            'props': {'prop_001': copy.deepcopy(RESPONSES['story_bible']['props'][0])},
            'scene': copy.deepcopy(RESPONSES['story_bible']['scenes'][0]),
            'context': {},
        },
        'production_semantics': {
            'shot_id': shot.get('shot_id'),
            'context_ref': '',
            'visual_events': [{
                'action': shot.get('description') or '',
                'character_refs': list(shot.get('character_refs') or []),
                'prop_refs': list(shot.get('prop_refs') or []),
                'source_evidence': copy.deepcopy(shot.get('source_evidence') or []),
            }],
            'audio_events': [],
            'renderability_status': 'renderable',
            'renderability_issues': [],
            'dialogue': [
                {'character_id': x.get('character_id'), 'line': x.get('line'), 'offscreen': False}
                for x in (shot.get('dialogue') or []) if isinstance(x, dict)
            ],
            'diegetic_text': [],
            'production_choices': [],
            'appearance_overlays': [],
        },
        'previous_state_out': copy.deepcopy(previous if previous is not None else empty_state()),
        'program_owned': {
            'speaker_target_refs': [],
            'allowed_character_refs': ['char_001'],
            'allowed_prop_refs': ['prop_001'],
        },
    }


def _director():
    return copy.deepcopy(RESPONSES['director']['scenes'][0]['shots'][0]['director'])


def test_v10_program_owns_state_out_and_model_template_omits_it():
    payload = build_director_shot_payload(_context(), unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    assert 'state_out' not in payload['output_contract']['model_owned_fields']
    assert 'state_out' in payload['output_contract']['program_owned_fields']
    assert 'state_out' not in payload['output_template']['director']


def test_v10_state_out_is_deterministically_derived_from_state_in_plus_delta():
    previous = {
        'characters': {'char_001': {'position': '桌旁', 'pose': '站立'}},
        'props': {'prop_001': {'position': '桌面'}},
        'environment': {'door_state': 'closed'},
    }
    context = _context(previous)
    raw = _director()
    raw['continuity_scope'] = {'mode': 'inherit'}
    raw['action_delta'] = {
        'characters': {'char_001': {'pose': '坐下'}},
        'props': {'prop_001': {'held_by': 'char_001'}},
        'environment': {},
    }
    # A model-provided state_out is legacy/noise and must not control the canonical state.
    raw['state_out'] = {
        'characters': {'char_001': {'pose': '错误值'}},
        'props': {},
        'environment': {},
    }

    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=False)

    assert canonical['state_out'] == {
        'characters': {'char_001': {'position': '桌旁', 'pose': '坐下'}},
        'props': {'prop_001': {'position': '桌面', 'held_by': 'char_001'}},
        'environment': {'door_state': 'closed'},
    }
    errors = validate_director_fragment(canonical, context, is_first_global_shot=False)
    assert not any(e['type'] in {'state_out_change_without_delta', 'action_delta_not_reflected_in_state_out'} for e in errors)


def test_v10_null_delta_clears_inherited_dynamic_field():
    previous = {
        'characters': {},
        'props': {'prop_001': {'held_by': 'char_001', 'position': '手中'}},
        'environment': {},
    }
    context = _context(previous)
    raw = _director()
    raw['continuity_scope'] = {'mode': 'inherit'}
    raw['action_delta'] = {
        'characters': {},
        'props': {'prop_001': {'held_by': None}},
        'environment': {},
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=False)
    assert canonical['state_out']['props']['prop_001'] == {'position': '手中'}


def test_v10_speaking_is_a_shot_event_not_a_persistent_state_field():
    context = _context()
    raw = _director()
    raw['continuity_scope'] = {'mode': 'reset'}
    raw['action_delta'] = {
        'characters': {'char_001': {'speaking': '正在说话'}},
        'props': {},
        'environment': {},
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e['type'] == 'transient_state_in_action_delta' for e in errors)
    assert 'speaking' not in canonical['state_out'].get('characters', {}).get('char_001', {})


def test_v10_normalizes_character_prop_holding_alias_to_canonical_prop_relation():
    context = _context()
    raw = _director()
    raw['continuity_scope'] = {'mode': 'reset'}
    raw['action_delta'] = {
        'characters': {'char_001': {'hold_prop': 'prop_001'}},
        'props': {},
        'environment': {},
    }
    canonical, changes = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    assert changes >= 1
    assert canonical['action_delta']['characters'] == {}
    assert canonical['action_delta']['props']['prop_001']['held_by'] == 'char_001'
    assert canonical['state_out']['props']['prop_001']['held_by'] == 'char_001'


def test_v10_runtime_accepts_model_director_without_state_out(tmp_path):
    from app.store import RunStore
    from runtime.checkpoints import CheckpointStore
    from runtime.orchestrator import RuntimeV20
    from tests.runtime.test_runtime20_foundations import TwoShotModel

    class NoStateOutModel(TwoShotModel):
        def generate_json(self, stage, system_prompt, user_payload):
            result = super().generate_json(stage, system_prompt, user_payload)
            if stage == 'director_shot' and isinstance(result, dict) and isinstance(result.get('director'), dict):
                result = copy.deepcopy(result)
                result['director'].pop('state_out', None)
            return result

    runtime = RuntimeV20(
        model=NoStateOutModel(),
        store=RunStore(tmp_path / 'runs'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints'),
    )
    run = runtime.start('阿宁站在窗边，手里拿着信封。阿宁转身。', title='director v10 state derivation')
    assert run['status'] == 'completed'
    shots = [shot for scene in run['artifacts']['storyboard']['scenes'] for shot in scene['shots']]
    assert shots
    assert all('state_out' in shot['director'] for shot in shots)

from __future__ import annotations

from runtime.stages.compile_eval import (
    _adapt_legacy_static_evaluation_v10,
    _validate_runtime_v10_state_transitions,
)


def test_v10_compat_filters_only_obsolete_legacy_state_copy_errors():
    raw = {
        'passed': False,
        'errors': [
            {'category': 'STRUCTURE', 'type': 'action_delta_not_reflected_in_state_out', 'shot_id': 'SH001', 'detail': 'legacy v9 copy rule'},
            {'category': 'STRUCTURE', 'type': 'state_out_change_without_delta', 'shot_id': 'SH002', 'detail': 'legacy v9 copy rule'},
            {'category': 'STRUCTURE', 'type': 'stale_action_delta', 'shot_id': 'SH003', 'detail': 'still valid'},
            {'category': 'REFERENCE', 'type': 'unknown_character_ref', 'shot_id': 'SH004', 'detail': 'still valid'},
        ],
        'summary': {'error_count': 4, 'categories': {'STRUCTURE': 3, 'REFERENCE': 1, 'AUTHORITY': 0, 'COMPILER': 0}},
    }

    adapted = _adapt_legacy_static_evaluation_v10(raw)

    assert adapted['passed'] is False
    assert [e['type'] for e in adapted['errors']] == ['stale_action_delta', 'unknown_character_ref']
    assert [e['type'] for e in adapted['compatibility_suppressed_errors']] == [
        'action_delta_not_reflected_in_state_out',
        'state_out_change_without_delta',
    ]
    assert adapted['summary']['error_count'] == 2
    assert adapted['summary']['categories']['STRUCTURE'] == 1
    assert adapted['summary']['categories']['REFERENCE'] == 1


def test_v10_runtime_state_validation_accepts_null_clear_semantics():
    shot_specs = [
        {
            'shot_id': 'SH001',
            'state_in': {
                'characters': {},
                'props': {'prop_a': {'position': '桌面', 'held_by': 'char_a'}},
                'environment': {},
            },
            'director': {
                'action_delta': {
                    'characters': {},
                    'props': {'prop_a': {'position': None, 'held_by': None}},
                    'environment': {},
                },
                'state_out': {'characters': {}, 'props': {}, 'environment': {}},
            },
        }
    ]

    assert _validate_runtime_v10_state_transitions(shot_specs) == []


def test_v10_runtime_state_validation_still_blocks_tampered_program_state_out():
    shot_specs = [
        {
            'shot_id': 'SH001',
            'state_in': {
                'characters': {'char_a': {'pose': '站立'}},
                'props': {'prop_a': {'position': '桌面'}},
                'environment': {},
            },
            'director': {
                'action_delta': {
                    'characters': {'char_a': {'pose': '坐下'}},
                    'props': {},
                    'environment': {},
                },
                'state_out': {
                    'characters': {'char_a': {'pose': '站立'}},
                    'props': {'prop_a': {'position': '桌面'}},
                    'environment': {},
                },
            },
        }
    ]

    errors = _validate_runtime_v10_state_transitions(shot_specs)
    assert errors == [
        {
            'category': 'STRUCTURE',
            'type': 'runtime_state_out_derivation_mismatch',
            'shot_id': 'SH001',
            'detail': 'physical state_out does not equal Runtime v10 derivation of state_in + action_delta',
        }
    ]


def test_v10_runtime_state_validation_ignores_program_owned_performance_baseline_extension():
    shot_specs = [{
        'shot_id': 'SH001',
        'state_in': {
            'characters': {'char_a': {'pose': '站立'}},
            'props': {},
            'environment': {},
        },
        'director': {
            'action_delta': {
                'characters': {}, 'props': {}, 'environment': {},
            },
            'state_out': {
                'characters': {
                    'char_a': {
                        'pose': '站立',
                        'performance_baseline': {
                            'base_emotion': '克制',
                            'behavior_tendency': '减少多余动作',
                        },
                    },
                },
                'props': {},
                'environment': {},
            },
        },
    }]

    assert _validate_runtime_v10_state_transitions(shot_specs) == []

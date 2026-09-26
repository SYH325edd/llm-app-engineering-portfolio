from __future__ import annotations

import copy

from runtime.stages.state_shotspec import build_state_shotspec_payload, build_state_shot_specs
from tests.api.fixtures.mock_story_run import RESPONSES


def _board_two_shots():
    board = copy.deepcopy(RESPONSES['director'])
    first = board['scenes'][0]['shots'][0]
    first['director']['action_delta'] = {'characters': {'char_001': {'position': '窗边'}}, 'props': {}, 'environment': {}}
    first['director']['state_out'] = {'characters': {'char_001': {'position': '窗边'}}, 'props': {}, 'environment': {}}
    second = copy.deepcopy(first)
    second['shot_id'] = 'SH002'
    second['description'] = '阿宁仍在窗边。'
    second['director']['continuity_scope'] = {'mode': 'inherit'}
    second['director']['action_delta'] = {'characters': {}, 'props': {}, 'environment': {}}
    second['director']['state_out'] = {'characters': {'char_001': {'position': '窗边'}}, 'props': {}, 'environment': {}}
    board['scenes'][0]['shots'].append(second)
    return board


def test_stage07_builds_state_in_deterministically_and_preserves_order():
    board = _board_two_shots()
    specs, errors = build_state_shot_specs(board)
    assert errors == []
    assert [s['shot_id'] for s in specs] == ['SH001', 'SH002']
    assert specs[0]['state_in'] == {'characters': {}, 'props': {}, 'environment': {}}
    assert specs[1]['state_in']['characters']['char_001']['position'] == '窗边'


def test_stage07_payload_is_only_validated_storyboard():
    board = _board_two_shots()
    payload = build_state_shotspec_payload(board)
    assert payload['contract_version'] == 'state_shotspec.v2'
    assert payload['storyboard'] == board
    assert set(payload) == {'contract_version', 'storyboard'}


def test_stage07_reports_core_state_resolution_failure_without_inference():
    board = _board_two_shots()
    board['scenes'][0]['shots'][1]['director']['continuity_scope'] = {
        'mode': 'partial',
        'inherit': {'characters': {'char_001': ['missing']}, 'props': {}, 'environment': []},
    }
    specs, errors = build_state_shot_specs(board)
    assert specs == []
    assert errors and errors[0]['type'] == 'shot_spec_build_failure'


def test_state_shotspec_uses_director_v16_execution_design_without_mutating_storyboard():
    import copy
    from tests.api.fixtures.mock_story_run import RESPONSES
    from runtime.stages.state_shotspec import build_state_shot_specs

    board = copy.deepcopy(RESPONSES['director'])
    before = copy.deepcopy(board)
    shot = board['scenes'][0]['shots'][0]
    shot['director']['execution_shot_design'] = {
        'shot_size': 'close', 'camera': 'low_angle', 'movement': 'push_in'
    }
    specs, errors = build_state_shot_specs(board)
    assert errors == []
    assert specs[0]['shot_size'] == 'close'
    assert specs[0]['camera'] == 'low_angle'
    assert specs[0]['movement'] == 'push_in'
    assert specs[0]['base_shot_design'] == {'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static'}
    assert specs[0]['effective_shot_design_source'] == 'director_v17'
    assert board['scenes'][0]['shots'][0]['shot_size'] == before['scenes'][0]['shots'][0]['shot_size']

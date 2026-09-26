from __future__ import annotations

import copy

from runtime.stages.compile_eval import compile_and_evaluate, lock_production_assets
from runtime.stages.state_shotspec import build_state_shot_specs
from tests.api.fixtures.mock_story_run import RESPONSES


def test_compile_stage_preserves_frozen_static_gate_and_returns_consumption_v2d_with_v1_reference():
    locked, errors, _ = lock_production_assets(
        RESPONSES['story_bible'], copy.deepcopy(RESPONSES['pvb']), copy.deepcopy(RESPONSES['psb']), copy.deepcopy(RESPONSES['style_guide'])
    )
    assert errors == []
    specs, spec_errors = build_state_shot_specs(copy.deepcopy(RESPONSES['director']))
    assert spec_errors == []
    result, errors = compile_and_evaluate(
        project_id='test_project', story_bible=copy.deepcopy(RESPONSES['story_bible']),
        script=copy.deepcopy(RESPONSES['script']), storyboard=copy.deepcopy(RESPONSES['director']),
        shot_specs=specs, pvb=locked['pvb'], psb=locked['psb'], style_guide=locked['style_guide'],
    )
    assert errors == []
    assert result['static_evaluation']['passed'] is True
    assert result['compiled_project']['compiler_version'] == 'consumption_v2m'
    assert result['consumption_evaluation']['compiler_version'] == 'consumption_v2m'
    assert result['consumption_v1_compiled_project']['compiler_version'] == 'consumption_v1'


def test_director_v16_execution_design_reaches_final_seedance_prompt():
    board = copy.deepcopy(RESPONSES['director'])
    board['scenes'][0]['shots'][0]['director']['execution_shot_design'] = {
        'shot_size': 'close', 'camera': 'low_angle', 'movement': 'push_in'
    }
    locked, errors, _ = lock_production_assets(
        RESPONSES['story_bible'], copy.deepcopy(RESPONSES['pvb']), copy.deepcopy(RESPONSES['psb']), copy.deepcopy(RESPONSES['style_guide'])
    )
    assert errors == []
    specs, spec_errors = build_state_shot_specs(board)
    assert spec_errors == []
    semantics = {'shots': [{
        'shot_id': 'SH001', 'context_ref': '',
        'visual_events': [{
            'action': '阿宁站在窗边，手里拿着信封。',
            'character_refs': ['char_001'], 'prop_refs': ['prop_001'],
            'source_evidence': [{'quote': '阿宁站在窗边，手里拿着信封。'}],
        }],
        'audio_events': [], 'renderability_status': 'renderable', 'renderability_issues': [],
        'dialogue': [], 'diegetic_text': [], 'production_choices': [], 'appearance_overlays': [],
    }]}
    result, errors = compile_and_evaluate(
        project_id='test_project_v16_design', story_bible=copy.deepcopy(RESPONSES['story_bible']),
        script=copy.deepcopy(RESPONSES['script']), storyboard=board,
        shot_specs=specs, pvb=locked['pvb'], psb=locked['psb'], style_guide=locked['style_guide'],
        production_semantics=semantics,
    )
    assert errors == []
    prompt = result['compiled_project']['shot_prompts'][0]['prompt_seedance']
    assert '景别：近景' in prompt
    assert '摄法：低角度仰拍，缓慢推近' in prompt

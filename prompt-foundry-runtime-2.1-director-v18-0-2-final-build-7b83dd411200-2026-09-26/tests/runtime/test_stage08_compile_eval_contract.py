from __future__ import annotations

import copy

from runtime.stages.compile_eval import lock_production_assets, compile_and_evaluate
from runtime.stages.state_shotspec import build_state_shot_specs
from tests.api.fixtures.mock_story_run import RESPONSES


def test_stage08_explicitly_locks_candidates_without_mutating_candidate_checkpoints():
    pvb = copy.deepcopy(RESPONSES['pvb'])
    psb = copy.deepcopy(RESPONSES['psb'])
    style = copy.deepcopy(RESPONSES['style_guide'])
    originals = copy.deepcopy((pvb, psb, style))
    locked, errors, lock_log = lock_production_assets(RESPONSES['story_bible'], pvb, psb, style)
    assert errors == []
    assert (pvb, psb, style) == originals
    assert lock_log['policy'] == 'runtime_auto_production_lock.v1'
    assert locked['pvb']['characters'][0]['status'] == 'locked'
    assert locked['psb']['scenes'][0]['status'] == 'locked'
    assert all(v['status'] == 'locked' for v in locked['style_guide'].values())
    assert locked['pvb'].get('review_log')


def test_stage08_compiles_only_locked_assets_and_static_eval_passes():
    locked, errors, _ = lock_production_assets(
        RESPONSES['story_bible'], copy.deepcopy(RESPONSES['pvb']), copy.deepcopy(RESPONSES['psb']), copy.deepcopy(RESPONSES['style_guide'])
    )
    assert errors == []
    specs, spec_errors = build_state_shot_specs(copy.deepcopy(RESPONSES['director']))
    assert spec_errors == []
    result, errors = compile_and_evaluate(
        project_id='test_project',
        story_bible=copy.deepcopy(RESPONSES['story_bible']),
        script=copy.deepcopy(RESPONSES['script']),
        storyboard=copy.deepcopy(RESPONSES['director']),
        shot_specs=specs,
        pvb=locked['pvb'], psb=locked['psb'], style_guide=locked['style_guide'],
    )
    assert errors == []
    assert result['static_evaluation']['passed'] is True
    assert len(result['compiled_project']['character_prompts']) == 1
    assert len(result['compiled_project']['scene_prompts']) == 1
    assert len(result['compiled_project']['shot_prompts']) == 1

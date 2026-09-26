from __future__ import annotations

import copy

from runtime.consumption_compiler import compile_shot_consumption_prompt_v2d
from runtime.production_readiness import validate_production_readiness
from runtime.stages.director import build_director_shot_payload, canonicalize_director_fragment, validate_director_fragment
from tests.runtime.test_stage06_director_contract import _context, _director
from tests.runtime.test_production_closeout_v1 import _story, _script, _pvb, _style, _semantics, _shot


def _soft_codes(errors):
    return {str(x.get('code') or '') for x in errors if isinstance(x, dict)}


def test_v17_payload_exposes_optional_execution_blocks_and_density_context():
    payload = build_director_shot_payload(_context(), unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    template = payload['output_template']['director']
    assert template['performance_logic'] == []
    assert template['performance_execution'] == []
    assert template['dialogue_delivery'] == []
    assert isinstance(template['camera_execution'], dict)
    assert payload['program_owned']['performance_density_target'] in {'low', 'medium', 'high'}
    assert 'performance_baseline_in' in payload['program_owned']
    assert 'dialogue_delivery_targets' in payload['program_owned']


def test_v17_grounded_logic_can_seed_baseline_but_ungrounded_logic_stays_soft_warning():
    ctx = _context()
    quote = '年轻人保持克制，减少多余动作。'
    ctx['shot']['source_evidence'] = [{'quote': quote}]
    raw = _director()
    raw['performance_logic'] = [{
        'character_ref': 'char_001', 'base_emotion': '克制', 'behavior_tendency': '减少多余动作',
        'trigger': '', 'behavior_goal': '', 'emotion_delta': '', 'evidence_source': [{'quote': quote}],
    }]
    raw['performance_execution'] = [{'character_ref': 'char_001', 'gaze': '目光落向当前动作对象', 'hands': '双手继续当前动作'}]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert 'W012_PERFORMANCE_TOO_ABSTRACT' not in _soft_codes(errors)
    baseline = canonical['state_out']['characters']['char_001']['performance_baseline']
    assert baseline['base_emotion'] == '克制'

    raw2 = copy.deepcopy(raw)
    raw2['performance_logic'][0]['evidence_source'] = [{'quote': '不存在的心理历史'}]
    canonical2, _ = canonicalize_director_fragment(raw2, ctx, is_first_global_shot=True)
    errors2 = validate_director_fragment(canonical2, ctx, is_first_global_shot=True)
    assert 'W012_PERFORMANCE_TOO_ABSTRACT' in _soft_codes(errors2)


def test_v17_7_camera_note_leak_is_soft_dropped_but_pure_composition_passes():
    ctx = _context()
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '人物偏左，右侧保留负空间，浅景深',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not any(x.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP' for x in errors)

    raw['camera_execution']['framing_note'] = '人物抬头，夕阳照在脸上'
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not any(x.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP' for x in errors)
    assert any(x.get('code') == 'W023_CAMERA_NOTE_DROPPED_UNSAFE' for x in errors)


def test_v17_renderer_adds_gaze_keeps_frozen_dialogue_and_filters_ungrounded_logic():
    shot = _shot(dialogue=True, purpose='speaker')
    semantics = _semantics(dialogue=True)
    shot['dialogue'] = [{'character_id': 'char_001', 'line': '找过。'}]
    shot['director']['performance_actions'] = []
    semantics['dialogue'] = [{'character_id': 'char_001', 'line': '找过。', 'offscreen': False}]
    shot['director']['performance_logic'] = [{
        'character_ref': 'char_001', 'base_emotion': '因为童年秘密而绝望', 'emotion_delta': '',
        'trigger': '不存在的过去', 'behavior_goal': '', 'behavior_tendency': '',
        'evidence_source': [{'quote': '不存在的过去'}],
    }]
    shot['director']['performance_execution'] = [{
        'character_ref': 'char_001', 'gaze': '目光短暂落向对方', 'expression': '眉间轻轻收紧',
    }]
    result = compile_shot_consumption_prompt_v2d(shot, semantics, _story(), _script(), _pvb(), {'scenes': []}, _style())
    prompt = result['prompt_seedance']
    assert '人物视线：' in prompt
    assert '目光短暂落向对方' in prompt
    assert '找过。' in result['shot_consumption_manifest']['dialogue']
    assert '童年秘密' not in prompt


def test_v17_final_readiness_rejects_non_audible_audio_and_camera_leak():
    shot = _shot()
    result = compile_shot_consumption_prompt_v2d(shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style())
    manifest = result['shot_consumption_manifest']
    manifest['environment_sfx'] = '胶水味混着灰尘在空气里散开'
    manifest['camera'] = '平视机位，固定镜头；构图：人物抬头，夕阳照在脸上'
    from runtime.shot_manifest import render_shot_prompt
    result['prompt_seedance'] = render_shot_prompt(manifest)
    compiled = {'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []}
    readiness = validate_production_readiness(compiled_project=compiled, shot_specs=[shot], script=None)
    types = {x.get('type') for x in readiness['errors']}
    assert 'E024_NON_AUDIBLE_AUDIO_CONTENT' in types
    assert 'E027_CAMERA_FIELD_OWNERSHIP' in types


def test_v17_time_modifier_cleanup_never_creates_dangling_phrase():
    from runtime.consumption_compiler import _strip_time_bound_modifier
    cleaned = _strip_time_bound_modifier('傍晚到的自然光，低角度斜照，暖橙色光线穿过门口', lighting=True)
    assert cleaned
    assert '到的自然光' not in cleaned
    assert cleaned.startswith('自然光')


def test_v17_audio_clause_drops_non_audible_content_but_keeps_real_sound():
    from runtime.shot_manifest import _audible_clause
    cleaned = _audible_clause('小区门口环境底噪，胶水味混着灰尘在空气里散开，远处脚步声')
    assert '环境底噪' in cleaned
    assert '脚步声' in cleaned
    assert '胶水味' not in cleaned
    assert '灰尘' not in cleaned


def test_v17_e025_blocks_abstract_logic_without_executable_performance():
    from runtime.shot_manifest import render_shot_prompt
    shot = _shot()
    shot['director']['shot_purpose'] = 'reaction'
    shot['director']['performance_actions'] = []
    shot['director']['performance_logic'] = [{
        'character_ref': 'char_001', 'base_emotion': '失望', 'emotion_delta': '',
        'trigger': '当前事件', 'behavior_goal': '', 'behavior_tendency': '',
        'evidence_source': [{'quote': '当前事件'}],
    }]
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style())
    manifest = result['shot_consumption_manifest']
    # Isolate the readiness contract: a logic-only performance paragraph is not executable.
    manifest['performance_execution_signal_count'] = 0
    manifest['performance_source'] = 'director_v17'
    manifest['performance_text'] = '老匠人底层状态保持失望。'
    result['prompt_seedance'] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [x for x in readiness['errors'] if x.get('type') == 'E025_PERFORMANCE_NOT_EXECUTABLE']
    assert any(x.get('type') == 'W027_PERFORMANCE_NOT_EXECUTABLE' for x in readiness['warnings'])


def test_v17_dialogue_delivery_never_replaces_frozen_text():
    from runtime.shot_manifest import _dialogue_text
    story = _story()
    semantics = {
        'dialogue': [{'character_id': 'char_001', 'line': 'Sophia, you have gone too far.', 'offscreen': False}],
    }
    shot = {
        'frozen_text_unit_refs': {'dialogue': ['FT001']},
        'dialogue': [{'character_id': 'char_001', 'line': 'Sophia, you have gone too far.'}],
        'director': {'dialogue_delivery': [{
            'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
            'emotion': '压怒', 'volume': '中高', 'pace': '后半加重', 'pause': '',
            'delivery': '咬字偏重', 'gaze_during_line': '始终看向对方',
        }]},
    }
    rendered = _dialogue_text(semantics, shot, story)
    assert 'Sophia, you have gone too far.' in rendered
    assert '压怒' in rendered and '咬字偏重' in rendered
    assert rendered.count('Sophia, you have gone too far.') == 1


def test_v17_high_density_cannot_escape_by_leaving_execution_empty():
    shot = _shot(dialogue=True, purpose='emotional_peak')
    shot['director']['performance_logic'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [x for x in readiness['errors'] if x.get('type') == 'E025_PERFORMANCE_NOT_EXECUTABLE']
    assert any(x.get('type') == 'W027_PERFORMANCE_NOT_EXECUTABLE' for x in readiness['warnings'])
    assert any(x.get('type') == 'W014_PERFORMANCE_DENSITY_MISMATCH' for x in readiness['warnings'])


def test_v17_valid_quote_does_not_authorize_invented_history_or_revenge_logic():
    ctx = _context()
    quote = str((ctx['shot'].get('source_evidence') or [{}])[0].get('quote') or ctx['shot'].get('description') or '')
    assert quote
    raw = _director()
    raw['performance_logic'] = [{
        'character_ref': 'char_001',
        'base_emotion': '极端控制欲与嫉妒',
        'emotion_delta': '暴怒升级',
        'trigger': '对方过去的背叛',
        'behavior_goal': '惩罚对方过去的背叛',
        'behavior_tendency': '持续施压',
        'evidence_source': [{'quote': quote}],
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert any(x.get('type') == 'director_performance_logic_unsupported_inference' for x in errors)
    baseline = ((canonical.get('state_out') or {}).get('characters') or {}).get('char_001', {}).get('performance_baseline')
    assert not baseline

    # The same invalid interpretation must also be filtered at render time.
    shot = _shot()
    shot['source_evidence'] = [{'quote': quote}]
    shot['director']['performance_logic'] = copy.deepcopy(raw['performance_logic'])
    shot['director']['performance_execution'] = [{'character_ref': 'char_001', 'gaze': '目光落向对方'}]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    prompt = result['prompt_seedance']
    assert '过去的背叛' not in prompt
    assert '惩罚对方' not in prompt


def test_v17_low_density_has_no_mechanical_breath_blink_fallback():
    shot = _shot(purpose='continuity')
    shot['director']['performance_actions'] = []
    shot['director']['performance_logic'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert manifest['performance_text'] == ''
    assert manifest['performance_source'] == 'none'
    assert '自然呼吸、眨眼' not in result['prompt_seedance']


def test_v17_gaze_merges_overall_and_dialogue_gaze_with_temporal_scope():
    shot = _shot(dialogue=True, purpose='speaker')
    shot['director']['performance_execution'] = [{
        'character_ref': 'char_001',
        'gaze': '先锁定对方，随后短暂落向右下方',
    }]
    shot['director']['dialogue_delivery'] = [{
        'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
        'emotion': '', 'volume': '', 'pace': '', 'pause': '', 'delivery': '',
        'gaze_during_line': '始终看向对方',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    gaze = result['shot_consumption_manifest']['gaze']
    assert '先锁定对方，随后短暂落向右下方' in gaze
    assert '说台词时始终看向对方' in gaze


def test_v17_dialogue_delivery_keeps_all_five_nonempty_cues():
    from runtime.shot_manifest import _dialogue_text
    story = _story()
    semantics = {'dialogue': [{'character_id': 'char_001', 'line': 'No need.', 'offscreen': False}]}
    shot = {
        'frozen_text_unit_refs': {'dialogue': ['FT001']},
        'dialogue': [{'character_id': 'char_001', 'line': 'No need.'}],
        'director': {'dialogue_delivery': [{
            'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
            'emotion': '心死', 'volume': '很轻', 'pace': '缓慢', 'pause': '开口前停顿',
            'delivery': '没有哭腔，语气平静', 'gaze_during_line': '视线下落',
        }]},
    }
    rendered = _dialogue_text(semantics, shot, story)
    for cue in ('心死', '很轻', '缓慢', '开口前停顿', '没有哭腔，语气平静'):
        assert cue in rendered
    assert rendered.count('No need.') == 1


def test_v17_w005_complexity_accounts_for_high_density_execution():
    shot = _shot(dialogue=True, purpose='emotional_peak')
    shot['director']['performance_execution'] = [{
        'character_ref': 'char_001',
        'expression': '眉间压紧，下颌绷住，嘴角的冷意没有消失',
        'breathing': '呼吸明显加重，胸口起伏变快',
        'body': '肩膀前送，上半身持续向对方压近',
        'hands': '右手猛地抬起，手指在半空收紧',
        'movement': '动作接近目标前突然停住，随后手腕改变方向',
        'micro_reaction': '停顿的一瞬眼神更沉',
        'action_transition': '抬手逼近→突然停住→改变方向',
        'end_state': '右手仍悬在半空，身体保持前压',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    assert result['prompt_metrics']['performance_density'] == 'high'
    w005 = next((x for x in result['warnings'] if x.get('code') == 'W005_PROMPT_LENGTH_HIGH'), None)
    if w005 is not None:
        assert w005['budget']['complexity'] != 'simple'
        assert w005['budget']['threshold'] >= 520


def test_v17_2_contract_identity_invalidates_old_v17_1_checkpoint(tmp_path):
    from runtime.checkpoints import CheckpointStore, unit_input_hash
    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    old_payload = copy.deepcopy(payload)
    old_payload['contract_version'] = 'director_shot.v17_1'
    checkpoints = CheckpointStore(tmp_path / 'checkpoints')
    checkpoints.save('run_old_v17', 'director:SH001', {
        'unit_id': 'director:SH001',
        'stage': 'director',
        'status': 'completed',
        'input_hash': unit_input_hash(old_payload),
        'contract_id': 'director_shot.v17_1|model-envelope.v1',
        'output': {'director': _director()},
    })
    assert checkpoints.get_reusable(
        'run_old_v17', 'director:SH001', payload,
        contract_id='director_shot.v18_0_2|model-envelope.v1',
    ) is None



def test_v17_2_neutral_quote_does_not_authorize_new_current_event_goal_or_plot_tendency():
    from runtime.performance_logic_guard import renderable_logic_fields, unsupported_logic_fields
    authority = ['阿宁站在窗边，手里拿着信封。']
    item = {
        'character_ref': 'char_001',
        'base_emotion': '极端控制欲与嫉妒',
        'emotion_delta': '暴怒升级',
        'trigger': '房间突然着火',
        'behavior_goal': '杀死对方',
        'behavior_tendency': '立刻逃跑',
        'evidence_source': [{'quote': authority[0]}],
    }
    assert renderable_logic_fields(item, authority) == {}
    assert set(unsupported_logic_fields(item, authority)) == {
        'base_emotion', 'emotion_delta', 'trigger', 'behavior_goal', 'behavior_tendency'
    }


def test_v17_2_field_level_authority_allows_explicit_trigger_goal_and_performance_only_tendency():
    from runtime.performance_logic_guard import renderable_logic_fields
    authority = ['Damien看见Sophia把婚戒扔进垃圾桶，愤怒地说他要她道歉。']
    item = {
        'character_ref': 'char_001',
        'base_emotion': '暴怒',
        'emotion_delta': '怒意升级',
        'trigger': 'Sophia把婚戒扔进垃圾桶',
        'behavior_goal': '要她道歉',
        'behavior_tendency': '上半身前压，减少多余动作，视线保持锁定',
        'evidence_source': [{'quote': authority[0]}],
    }
    fields = renderable_logic_fields(item, authority)
    assert fields['base_emotion'] == '暴怒'
    assert fields['emotion_delta'] == '怒意升级'
    assert fields['trigger'] == 'Sophia把婚戒扔进垃圾桶'
    assert fields['behavior_goal'] == '要她道歉'
    assert fields['behavior_tendency'].startswith('上半身前压')


def test_v17_2_camera_grammar_allows_real_composition_language_and_rejects_performance():
    from runtime.camera_grammar import framing_note_violations
    assert framing_note_violations('人物偏左，走廊尽头保留负空间') == []
    assert framing_note_violations('双人中景，背景连接门口与窗户形成纵深') == []
    assert framing_note_violations('Sophia右肩作为前景虚化，Damien位于画面中央偏左') == []
    bad = framing_note_violations('人物皱眉，身体前倾，手指收紧')
    assert bad
    assert 'non_camera_semantics' in bad


def test_v17_7_camera_grammar_leak_is_soft_at_director_without_walkway_false_positive():
    ctx = _context()
    ctx['shot']['source_evidence'] = [{'quote': '人物站在走廊里。'}]
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '人物偏左，走廊尽头保留负空间',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not any(x.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP' for x in errors)

    raw['camera_execution']['framing_note'] = '人物皱眉，身体前倾，手指收紧'
    canonical2, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors2 = validate_director_fragment(canonical2, ctx, is_first_global_shot=True)
    assert not any(x.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP' for x in errors2)
    assert any(x.get('code') == 'W023_CAMERA_NOTE_DROPPED_UNSAFE' for x in errors2)


def test_v17_2_prop_only_shot_renders_no_character_gaze():
    shot = _shot(purpose='detail')
    shot['director']['primary_subject_refs'] = []
    shot['director']['reaction_target_refs'] = []
    shot['director']['visual_target'] = {'target_type': 'prop', 'character_refs': [], 'prop_refs': ['prop_001'], 'environment_keys': []}
    shot['character_refs'] = []
    shot['prop_refs'] = ['prop_001']
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    assert result['shot_consumption_manifest']['gaze'] == '无'
    assert '人物视线：无' in result['prompt_seedance']


def test_v17_2_final_readiness_accepts_legal_camera_grammar():
    from runtime.shot_manifest import render_shot_prompt
    shot = _shot(purpose='continuity')
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    manifest['camera'] = '平视机位，固定镜头；构图：人物偏左，走廊尽头保留负空间'
    manifest.setdefault('provenance', {})['camera_framing_authority'] = ['人物站在走廊里。']
    result['prompt_seedance'] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not any(x.get('type') == 'E027_CAMERA_FIELD_OWNERSHIP' for x in readiness['errors'])


def test_v17_3_performance_execution_cannot_mint_objective_story_actions_or_injuries():
    ctx = _context()
    ctx['shot']['source_evidence'] = [{'quote': '阿宁站在窗边，手里拿着信封。'}]
    raw = _director()
    raw['performance_execution'] = [{
        'character_ref': 'char_001',
        'expression': '脸上突然出现一道流血刀伤',
        'gaze': '看向突然闯入的陌生人',
        'breathing': '因中枪而呼吸急促',
        'body': '腹部鲜血不断流出',
        'hands': '右手握着一把手枪',
        'movement': '突然冲过去把对方推下楼',
        'micro_reaction': '听见爆炸声后猛地一颤',
        'action_transition': '站在原地→开枪→转身逃跑',
        'end_state': '已经离开房间',
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    dropped = [x for x in errors if x.get('code') == 'W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE']
    assert dropped
    paths = {x.get('path') for x in dropped}
    assert 'director.performance_execution[0].movement' in paths
    assert 'director.performance_execution[0].action_transition' in paths
    assert 'director.performance_execution[0].body' in paths


def test_v17_3_dialogue_delivery_grammar_blocks_story_events_but_keeps_directing_cues():
    from runtime.director_execution_authority import dialogue_delivery_field_violations
    illegal = {
        'emotion': '因为童年被遗弃而绝望',
        'volume': '像准备杀人一样低沉',
        'pace': '说完立刻逃跑',
        'pause': '听见门外枪声后停顿',
        'delivery': '带着复仇计划的咬字',
        'gaze_during_line': '看向突然闯入的持刀男人',
    }
    for field, value in illegal.items():
        assert dialogue_delivery_field_violations(field, value, allowed_entity_terms=['Sophia', 'Damien'])
    legal = {
        'emotion': '压怒',
        'volume': '中高',
        'pace': '后半加重',
        'pause': '开口前短暂停顿',
        'delivery': '咬字偏重',
        'gaze_during_line': '始终看向对方',
    }
    for field, value in legal.items():
        assert dialogue_delivery_field_violations(field, value, allowed_entity_terms=['Sophia', 'Damien']) == []


def test_v17_3_camera_authority_blocks_new_entities_events_and_allows_authorized_prop():
    from runtime.camera_grammar import framing_note_authority_violations
    authority = ['Sophia坐在病床上，床边垃圾桶里有婚戒。']
    entities = ['Sophia', '垃圾桶', '婚戒']
    assert framing_note_authority_violations(
        '垃圾桶位于画面右下角', authority_texts=authority, allowed_entity_terms=entities
    ) == []
    for note in (
        '尸体作为前景虚化',
        '门外持刀男人作为背景虚化',
        '背景中有人开枪',
        '画面右侧是燃烧的房间',
        '背景里Sophia正在哭',
    ):
        assert framing_note_authority_violations(note, authority_texts=authority, allowed_entity_terms=entities)


def test_v17_3_checkpoint_identity_invalidates_v17_2(tmp_path):
    from runtime.checkpoints import CheckpointStore, unit_input_hash
    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    old_payload = copy.deepcopy(payload)
    old_payload['contract_version'] = 'director_shot.v17_2'
    checkpoints = CheckpointStore(tmp_path / 'checkpoints')
    checkpoints.save('run_old_v172', 'director:SH001', {
        'unit_id': 'director:SH001', 'stage': 'director', 'status': 'completed',
        'input_hash': unit_input_hash(old_payload),
        'contract_id': 'director_shot.v17_2|model-envelope.v1',
        'output': {'director': _director()},
    })
    assert checkpoints.get_reusable(
        'run_old_v172', 'director:SH001', payload,
        contract_id='director_shot.v18_0_2|model-envelope.v1',
    ) is None


def test_v17_3_typed_performance_fields_accept_concise_local_modulation_without_repeating_channel_words():
    from runtime.director_execution_authority import performance_execution_field_violations

    authority = ['老周坐在修鞋摊前，双手搭在膝盖上，目光平静。']
    assert performance_execution_field_violations('expression', '平静而专注', authority) == []
    assert performance_execution_field_violations('breathing', '平稳', authority) == []
    assert performance_execution_field_violations('body', '微微前倾', authority) == []
    assert performance_execution_field_violations('hands', '自然搭在膝盖上', authority) == []
    assert performance_execution_field_violations('micro_reaction', '短暂停顿', authority) == []


def test_v17_3_typed_performance_fields_still_block_objective_story_change_without_authority():
    from runtime.director_execution_authority import performance_execution_field_violations

    authority = ['老周坐在修鞋摊前，目光平静。']
    assert performance_execution_field_violations('hands', '右手拿起一把手枪', authority, allowed_entity_terms=['老周'])
    assert performance_execution_field_violations('breathing', '因中枪而呼吸急促', authority, allowed_entity_terms=['老周'])
    assert performance_execution_field_violations('movement', '突然冲过去把对方推下楼', authority, allowed_entity_terms=['老周'])


def test_v17_3_director_validation_accepts_concise_expression_breathing_and_hand_pose():
    ctx = _context()
    ctx['shot']['source_evidence'] = [{'quote': '阿宁站在窗边，手里拿着信封。'}]
    raw = _director()
    raw['performance_execution'] = [{
        'character_ref': 'char_001',
        'expression': '平静而专注',
        'breathing': '平稳',
        'hands': '自然垂在身侧',
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [x for x in errors if x.get('code') == 'E028_DIRECTOR_EXECUTION_AUTHORITY']


def test_v17_3_camera_grammar_accepts_subject_occupancy_visual_guidance_and_side_space():
    from runtime.camera_grammar import framing_note_violations, framing_note_authority_violations

    authority = [
        '老周弯腰打开工具箱最底下的抽屉，低头看向抽屉内部。',
        '老周坐在修鞋摊前。',
    ]
    legal = (
        '上半身与手部动作占据主体',
        '视线自然引向抽屉内部',
        '摊前留出右侧空间',
    )
    for note in legal:
        assert framing_note_violations(note) == []
        assert framing_note_authority_violations(note, authority_texts=authority, allowed_entity_terms=['老周', '抽屉']) == []

    assert framing_note_violations('老周皱眉，手指收紧')


def test_v17_3_director_hard_gate_accepts_real_world_framing_phrases_from_sh005_sh007_shape():
    ctx = _context()
    ctx['shot']['source_evidence'] = [{
        'quote': '老周弯腰打开最底下的抽屉，低头看向抽屉内部。'
    }]
    ctx['shot']['description'] = '老周弯腰打开最底下的抽屉，低头看向抽屉内部。'
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'close', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '上半身与手部动作占据主体；视线自然引向抽屉内部',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [x for x in errors if x.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']

    ctx2 = _context()
    ctx2['shot']['source_evidence'] = [{'quote': '老周坐在修鞋摊前。'}]
    ctx2['shot']['description'] = '老周坐在修鞋摊前。'
    raw2 = _director()
    raw2['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '摊前留出右侧空间',
    }
    canonical2, _ = canonicalize_director_fragment(raw2, ctx2, is_first_global_shot=True)
    errors2 = validate_director_fragment(canonical2, ctx2, is_first_global_shot=True)
    assert not [x for x in errors2 if x.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']


def test_v17_3_camera_note_canonicalizes_two_person_real_world_phrasing_without_ownership_leak():
    from runtime.camera_grammar import canonicalize_framing_note, framing_note_violations, framing_note_authority_violations
    raw = '两人同框，新住户从另一侧经过，形成疏离的构图关系'
    canonical = canonicalize_framing_note(raw)
    assert canonical == '双人构图，新住户位于画面另一侧，形成双人构图关系'
    assert framing_note_violations(canonical) == []
    assert framing_note_authority_violations(canonical, authority_texts=['新住户从旁经过'], allowed_entity_terms=[]) == []

    ctx = _context()
    ctx['shot']['description'] = '老周坐在摊前，新住户从旁经过。'
    raw_director = _director()
    raw_director['camera_execution'] = {
        'framing_type': 'relationship', 'foreground_character_refs': [],
        'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': raw,
    }
    canonical_director, _ = canonicalize_director_fragment(raw_director, ctx, is_first_global_shot=True)
    assert canonical_director['camera_execution']['framing_note'] == canonical
    errors = validate_director_fragment(canonical_director, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']


def test_v17_3_camera_environment_subject_and_generic_background_population_are_authority_bound():
    from runtime.camera_grammar import canonicalize_framing_note, framing_note_violations, framing_note_authority_violations

    authority = ['小区门口人来人往，新住户从旁走过。']
    note = canonicalize_framing_note('小区门口作为整体环境主体，行人作为背景')
    assert note == '整体环境以小区门口为主体，行人作为背景'
    assert framing_note_violations(note) == []
    assert framing_note_authority_violations(note, authority_texts=authority, allowed_entity_terms=[]) == []

    # Generic crowd language is not a free pass: without population authority it is rejected.
    assert framing_note_authority_violations(
        '整体环境以小区门口为主体，行人作为背景',
        authority_texts=['空荡的小区门口，没有其他人。'],
        allowed_entity_terms=[],
    )



def test_v17_3_camera_grammar_accepts_visual_weight_and_environment_dominance_without_authority_leak():
    from runtime.camera_grammar import canonicalize_framing_note, framing_note_violations, framing_note_authority_violations

    authority = ['老周坐在修鞋摊前，摊上有手摇补鞋机、木头工具箱和几把塑料凳。']
    note = canonicalize_framing_note('摊上物件铺满画面主体，环境占据主导')
    assert note == '摊上物件占据画面主体，环境作为画面主体'
    assert framing_note_violations(note) == []
    assert framing_note_authority_violations(
        note,
        authority_texts=authority,
        allowed_entity_terms=['老周', '手摇补鞋机', '木头工具箱', '塑料凳'],
    ) == []

    corpse = canonicalize_framing_note('尸体铺满画面主体')
    assert framing_note_violations(corpse) == []
    assert framing_note_authority_violations(corpse, authority_texts=authority, allowed_entity_terms=[])

    armed = canonicalize_framing_note('持刀男人占据主导')
    assert framing_note_violations(armed) == []
    assert framing_note_authority_violations(armed, authority_texts=authority, allowed_entity_terms=[])


def test_v17_3_director_hard_gate_accepts_sh002_visual_weight_framing_shape():
    ctx = _context()
    ctx['shot']['source_evidence'] = [{'quote': '摊子不大，一台手摇补鞋机，一个木头工具箱，几把塑料凳。'}]
    ctx['shot']['description'] = '摊子不大，一台手摇补鞋机，一个木头工具箱，几把塑料凳。'
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'environment', 'foreground_character_refs': [],
        'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '摊上物件铺满画面主体，环境占据主导',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    assert canonical['camera_execution']['framing_note'] == '摊上物件占据画面主体，环境作为画面主体'
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']

def test_v17_3_dialogue_delivery_accepts_natural_manner_phrasing_and_authorized_gaze_targets():
    from runtime.director_execution_authority import dialogue_delivery_field_violations

    legal_delivery = (
        '语气平淡自然',
        '略带好奇和试探',
        '咬字清楚，尾音收住',
        '低声，带着一丝迟疑',
        '语气平稳但略带不解',
    )
    for value in legal_delivery:
        assert dialogue_delivery_field_violations('delivery', value, allowed_entity_terms=['老周', '年轻人', '皮鞋']) == []

    legal_gaze = (
        '始终看向老周',
        '目光自然落在老周身上',
        '视线短暂落向老周手中的皮鞋',
        '看向对方',
        '随后垂眼看向下方',
    )
    for value in legal_gaze:
        assert dialogue_delivery_field_violations('gaze_during_line', value, allowed_entity_terms=['老周', '年轻人', '皮鞋']) == []

    assert dialogue_delivery_field_violations('delivery', '语气平静，说完立刻逃跑', allowed_entity_terms=['老周'])
    assert dialogue_delivery_field_violations('gaze_during_line', '看向突然闯入的持刀男人', allowed_entity_terms=['老周'])


def test_v17_3_character_alias_is_allowed_for_delivery_gaze_but_not_subject_ownership():
    from runtime.stages.director import _allowed_director_entity_terms
    from runtime.director_execution_authority import dialogue_delivery_field_violations

    ctx = _context()
    ctx['assets']['characters']['char_001']['canonical_name'] = '老周'
    ctx['assets']['characters']['char_001']['aliases'] = ['周师傅', '师傅']
    terms = _allowed_director_entity_terms(ctx)
    assert '老周' in terms and '师傅' in terms
    assert dialogue_delivery_field_violations('gaze_during_line', '看向师傅', allowed_entity_terms=terms) == []


def test_v17_4_unrecognized_camera_language_is_soft_not_hard():
    from runtime.camera_grammar import framing_note_violations, framing_note_unrecognized_clauses

    note = '抽屉边缘形成自然边框，引导视线聚焦于钥匙本身，留有空间感'
    assert framing_note_violations(note) == []
    assert framing_note_unrecognized_clauses(note) == []

    ctx = _context()
    ctx['shot']['description'] = '工具箱最底下的抽屉半开，露出里面的钥匙。'
    ctx['shot']['source_evidence'] = [{'quote': ctx['shot']['description']}]
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'detail', 'foreground_character_refs': [],
        'shot_size': 'close', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '抽屉边缘形成自然边框，引导视线聚焦于钥匙本身，留有空间感',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']


def test_v17_4_unknown_but_non_leaking_camera_phrase_is_warning_only():
    ctx = _context()
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '保持视觉呼吸',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']
    warnings = [e for e in errors if e.get('code') == 'W016_CAMERA_GRAMMAR_UNRECOGNIZED']
    assert warnings


def test_v17_4_mixed_errors_apply_deterministic_stabilizer_before_model_repair():
    from runtime.orchestrator import _director_shot_errors

    ctx = _context()
    raw = _director()
    raw['shot_purpose'] = 'establish_space'
    raw['visual_target'] = {
        'target_type': 'character', 'character_refs': ['char_001'],
        'prop_refs': [], 'environment_keys': [],
    }
    raw['visual_focus'] = {
        'focus_type': 'body_region', 'subject_refs': ['char_001'],
        'body_regions': {'char_001': ['hands']}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '保持视觉呼吸',
    }

    canonical, errors, changes = _director_shot_errors({}, {}, {}, ctx['shot'], raw, ctx, is_first=True)
    assert changes > 0
    assert canonical['visual_focus']['focus_type'] == 'character'
    assert canonical['visual_focus']['body_regions'] == {}
    assert not [e for e in errors if e.get('type') == 'director_shot_size_focus_conflict']
    assert [e for e in errors if e.get('code') == 'W016_CAMERA_GRAMMAR_UNRECOGNIZED']


def test_v17_4_camera_diversity_heuristics_are_soft_quality_signals():
    from runtime.stages.director import SOFT_QUALITY_ERROR_TYPES

    assert 'director_repeated_execution_design' in SOFT_QUALITY_ERROR_TYPES
    assert 'director_scene_design_monoculture' in SOFT_QUALITY_ERROR_TYPES
    assert 'director_scene_camera_distribution_pressure' in SOFT_QUALITY_ERROR_TYPES


def test_v17_5_contract_identity_invalidates_v17_4_checkpoint(tmp_path):
    from runtime.checkpoints import CheckpointStore, unit_input_hash

    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    old_payload = copy.deepcopy(payload)
    old_payload['contract_version'] = 'director_shot.v17_4'
    checkpoints = CheckpointStore(tmp_path / 'checkpoints')
    checkpoints.save('run_old_v174', 'director:SH001', {
        'unit_id': 'director:SH001', 'stage': 'director', 'status': 'completed',
        'input_hash': unit_input_hash(old_payload),
        'contract_id': 'director_shot.v17_4|model-envelope.v1',
        'output': {'director': _director()},
    })
    assert checkpoints.get_reusable(
        'run_old_v174', 'director:SH001', payload,
        contract_id='director_shot.v18_0_2|model-envelope.v1',
    ) is None


def test_v17_5_unrecognized_safe_delivery_wording_is_soft_and_preserved():
    from runtime.director_execution_authority import (
        dialogue_delivery_field_violations,
        dialogue_delivery_hard_violations,
        filter_dialogue_delivery_item,
    )
    from runtime.stages.director import SOFT_QUALITY_ERROR_TYPES

    samples = {
        'emotion': '有点无奈又疲惫',
        'pace': '不紧不慢地说',
        'delivery': '语气里有一点无奈，话说得很收着',
    }
    for field, value in samples.items():
        violations = dialogue_delivery_field_violations(field, value, allowed_entity_terms=['老周', '年轻人'])
        assert violations == ['outside_delivery_grammar']
        assert dialogue_delivery_hard_violations(field, value, allowed_entity_terms=['老周', '年轻人']) == []

    item = {
        'frozen_text_unit_id': 'ftu_dialogue_001', 'speaker_ref': 'char_001',
        **samples,
    }
    filtered = filter_dialogue_delivery_item(item, allowed_entity_terms=['老周', '年轻人'])
    assert filtered['emotion'] == samples['emotion']
    assert filtered['pace'] == samples['pace']
    assert filtered['delivery'] == samples['delivery']
    assert 'director_dialogue_delivery_grammar_unrecognized' in SOFT_QUALITY_ERROR_TYPES


def test_v17_5_director_validator_does_not_repair_safe_unknown_delivery_wording():
    ctx = _context()
    ctx['shot']['dialogue'] = [{'character_id': 'char_001', 'line': '后来呢？'}]
    ctx['shot']['frozen_text_unit_refs'] = {'dialogue': ['ftu_dialogue_001'], 'narration': []}
    ctx['production_semantics']['dialogue'] = [{'character_id': 'char_001', 'line': '后来呢？', 'offscreen': False}]
    raw = _director()
    raw['dialogue_delivery'] = [{
        'frozen_text_unit_id': 'ftu_dialogue_001', 'speaker_ref': 'char_001',
        'emotion': '有点无奈又疲惫',
        'pace': '不紧不慢地说',
        'delivery': '语气里有一点无奈，话说得很收着',
        'volume': '', 'pause': '', 'gaze_during_line': '',
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E029_DIALOGUE_DELIVERY_AUTHORITY']
    warnings = [e for e in errors if e.get('code') == 'W020_DIALOGUE_DELIVERY_GRAMMAR_UNRECOGNIZED']
    assert len(warnings) == 3


def test_v17_5_dialogue_delivery_story_leak_and_unauthorized_gaze_remain_hard():
    from runtime.director_execution_authority import dialogue_delivery_hard_violations

    assert dialogue_delivery_hard_violations('delivery', '听见枪声后压低声音', allowed_entity_terms=['老周']) == ['delivery_contains_story_event']
    assert dialogue_delivery_hard_violations('pace', '说完立刻逃跑', allowed_entity_terms=['老周']) == ['delivery_contains_story_event']
    assert dialogue_delivery_hard_violations('gaze_during_line', '看向突然闯入的持刀男人', allowed_entity_terms=['老周']) == ['delivery_contains_story_event']
    assert dialogue_delivery_hard_violations('gaze_during_line', '看向陌生男人', allowed_entity_terms=['老周']) == ['unauthorized_gaze_target']


def test_v17_6_unresolved_free_camera_entity_is_soft_and_not_repaired():
    ctx = _context()
    ctx['shot']['description'] = '老周弯腰打开工具箱最底下的抽屉，低头看向抽屉内部。'
    ctx['shot']['source_evidence'] = [{'quote': ctx['shot']['description']}]
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'detail', 'foreground_character_refs': [],
        'shot_size': 'close', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '抽屉与手部动作占据画面主体',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']
    warnings = [e for e in errors if e.get('code') == 'W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED']
    assert warnings
    assert warnings[0].get('camera_authority_violations')


def test_v17_6_unresolved_camera_note_is_omitted_but_structured_camera_survives():
    shot = _shot(purpose='detail')
    shot['director']['camera_execution'] = {
        'framing_type': 'detail', 'foreground_character_refs': [],
        'shot_size': 'close', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '抽屉与手部动作占据画面主体',
    }
    shot['director']['execution_framing'] = {'framing_type': 'detail', 'foreground_character_refs': []}
    shot['director']['execution_shot_design'] = {'shot_size': 'close', 'camera': 'eye_level', 'movement': 'static'}
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    camera = result['shot_consumption_manifest']['camera']
    assert '局部细节构图' in camera
    assert '平视机位' in camera
    assert '固定镜头' in camera
    assert '抽屉与手部动作' not in camera
    assert '构图：' not in camera


def test_v17_6_invented_camera_entity_is_soft_dropped_not_production_blocker():
    ctx = _context()
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '尸体作为前景虚化',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']
    assert [e for e in errors if e.get('code') == 'W021_CAMERA_NOTE_AUTHORITY_UNRESOLVED']

    shot = _shot(purpose='continuity')
    shot['director']['camera_execution'] = canonical['camera_execution']
    shot['director']['execution_framing'] = canonical['execution_framing']
    shot['director']['execution_shot_design'] = canonical['execution_shot_design']
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    assert '尸体' not in result['shot_consumption_manifest']['camera']
    from runtime.shot_manifest import render_shot_prompt
    result['prompt_seedance'] = render_shot_prompt(result['shot_consumption_manifest'])
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness['errors'] if e.get('type') == 'E027_CAMERA_FIELD_OWNERSHIP']


def test_v17_6_unknown_safe_performance_execution_wording_is_soft_and_preserved():
    ctx = _context()
    raw = _director()
    raw['performance_execution'] = [{
        'character_ref': 'char_001',
        'movement': '脚下位置微微调整',
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E028_DIRECTOR_EXECUTION_AUTHORITY']
    assert [e for e in errors if e.get('code') == 'W022_PERFORMANCE_EXECUTION_GRAMMAR_UNRECOGNIZED']

    shot = _shot(purpose='continuity')
    shot['director']['performance_execution'] = canonical['performance_execution']
    shot['director']['performance_actions'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    assert '脚下位置微微调整' in result['shot_consumption_manifest']['performance_text']


def test_v17_8_objective_performance_execution_is_soft_dropped_not_repaired():
    ctx = _context()
    raw = _director()
    raw['performance_execution'] = [{
        'character_ref': 'char_001',
        'movement': '突然冲出房间并关上门',
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    warnings = [e for e in errors if e.get('code') == 'W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE']
    assert warnings
    assert any('unauthorized_objective_action' in (e.get('authority_violations') or []) for e in warnings)
    from runtime.stages.director import SOFT_QUALITY_ERROR_TYPES
    assert 'director_performance_execution_unsafe' in SOFT_QUALITY_ERROR_TYPES


def test_v17_6_open_language_fields_share_one_hard_soft_principle():
    from runtime.director_execution_authority import (
        performance_execution_field_violations,
        performance_execution_hard_violations,
        dialogue_delivery_field_violations,
        dialogue_delivery_hard_violations,
    )
    from runtime.camera_grammar import framing_note_violations, framing_note_authority_violations

    authorities = ['老周站在摊前，工具箱抽屉半开，钥匙露出一角。']
    allowed = ['老周', '工具箱', '抽屉', '钥匙']

    # Safe natural acting language may be outside today's positive vocabulary,
    # but lack of lexical recognition is not an objective story violation.
    safe_movement = '脚下位置微微调整'
    assert performance_execution_field_violations('movement', safe_movement, authorities, allowed_entity_terms=allowed)
    assert performance_execution_hard_violations('movement', safe_movement, authorities, allowed_entity_terms=allowed) == []

    # Objective story change remains hard.
    unsafe_movement = '突然冲出房间并关上门'
    assert performance_execution_hard_violations('movement', unsafe_movement, authorities, allowed_entity_terms=allowed)

    # Safe delivery wording can be unrecognized without becoming a hard failure.
    safe_delivery = '说得很轻但很稳'
    assert dialogue_delivery_field_violations('delivery', safe_delivery, allowed_entity_terms=allowed)
    assert dialogue_delivery_hard_violations('delivery', safe_delivery, allowed_entity_terms=allowed) == []
    assert dialogue_delivery_hard_violations('delivery', '听见枪声后压低声音', allowed_entity_terms=allowed)

    # Free camera prose may have unresolved entity parsing; that is soft because
    # framing_note is non-authoritative and will be omitted from rendering.
    note = '抽屉与手部动作占据画面主体'
    assert framing_note_violations(note) == []
    assert framing_note_authority_violations(note, authority_texts=authorities, allowed_entity_terms=allowed)
    # Explicit field-ownership leakage is still detectable, but framing_note is
    # non-authoritative so Director treats it as soft-drop rather than Repair.
    assert framing_note_violations('老周皱眉，夕阳照在脸上')



def test_v17_7_unsafe_framing_note_is_soft_dropped_not_repaired():
    from runtime.stages.director import SOFT_QUALITY_ERROR_TYPES

    ctx = _context()
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '老周皱眉，夕阳照在脸上',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']
    warnings = [e for e in errors if e.get('code') == 'W023_CAMERA_NOTE_DROPPED_UNSAFE']
    assert warnings
    assert warnings[0].get('camera_grammar_violations') == ['non_camera_semantics']
    assert 'director_camera_note_unsafe' in SOFT_QUALITY_ERROR_TYPES

    shot = _shot(purpose='continuity')
    shot['director']['camera_execution'] = canonical['camera_execution']
    shot['director']['execution_framing'] = canonical['execution_framing']
    shot['director']['execution_shot_design'] = canonical['execution_shot_design']
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    camera = result['shot_consumption_manifest']['camera']
    assert '老周皱眉' not in camera
    assert '夕阳照在脸上' not in camera
    assert '构图：' not in camera


def test_v17_7_dialogue_leak_in_framing_note_is_soft_dropped():
    ctx = _context()
    ctx['shot']['dialogue'] = [{'character_id': 'char_001', 'line': '后来呢？'}]
    raw = _director()
    raw['camera_execution'] = {
        'framing_type': 'single', 'foreground_character_refs': [],
        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
        'framing_note': '人物偏左，后来呢？',
    }
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    assert not [e for e in errors if e.get('code') == 'E027_CAMERA_FIELD_OWNERSHIP']
    warnings = [e for e in errors if e.get('code') == 'W023_CAMERA_NOTE_DROPPED_UNSAFE']
    assert warnings and warnings[0].get('leaked_dialogue') is True


def test_v17_7_old_v17_6_checkpoint_is_not_reusable(tmp_path):
    from runtime.checkpoints import CheckpointStore, unit_input_hash

    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    old_payload = copy.deepcopy(payload)
    old_payload['contract_version'] = 'director_shot.v17_6'
    checkpoints = CheckpointStore(tmp_path / 'checkpoints')
    checkpoints.save('run_old_v176', 'director:SH001', {
        'unit_id': 'director:SH001', 'stage': 'director', 'status': 'completed',
        'input_hash': unit_input_hash(old_payload),
        'contract_id': 'director_shot.v17_6|model-envelope.v1',
        'output': {'director': _director()},
    })
    assert checkpoints.get_reusable(
        'run_old_v176', 'director:SH001', payload,
        contract_id='director_shot.v18_0_2|model-envelope.v1',
    ) is None



def test_v17_7_final_readiness_keeps_e027_as_defense_for_bypassed_unsafe_manifest():
    from runtime.shot_manifest import render_shot_prompt

    shot = _shot(purpose='continuity')
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = []
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    # Simulate corrupted/legacy data bypassing the compiler's framing_note filter.
    manifest = result['shot_consumption_manifest']
    manifest['camera'] = '平视机位，固定镜头；构图：老周皱眉，夕阳照在脸上'
    manifest.setdefault('provenance', {})['camera_framing_authority'] = ['老周站在摊前。']
    result['prompt_seedance'] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert [e for e in readiness['errors'] if e.get('type') == 'E027_CAMERA_FIELD_OWNERSHIP']


def test_v17_8_local_articulation_verbs_do_not_become_objective_story_actions():
    from runtime.director_execution_authority import performance_execution_field_violations

    authority = ['人物站在房间里。']
    legal = {
        'expression': '嘴角微微抬起',
        'gaze': '抬起眼睛看向对方',
        'body': '缓慢抬起下颌',
        'hands': '抬起手又慢慢放下',
        'micro_reaction': '嘴角刚抬起又收住',
    }
    for field, value in legal.items():
        assert performance_execution_field_violations(field, value, authority, allowed_entity_terms=['人物']) == []

    # A body word elsewhere in the clause must not blanket-authorize an object action.
    assert 'unauthorized_objective_action' in performance_execution_field_violations(
        'body', '肩膀放松后放下箱子', authority, allowed_entity_terms=['人物']
    )


def test_v17_8_unsafe_execution_is_warning_compiler_drop_and_not_repair_blocker():
    from runtime.stages.director import SOFT_QUALITY_ERROR_TYPES

    ctx = _context()
    raw = _director()
    raw['performance_execution'] = [{
        'character_ref': 'char_001',
        'expression': '嘴角微微抬起',
        'movement': '突然冲出房间并关上门',
    }]
    canonical, _ = canonicalize_director_fragment(raw, ctx, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, ctx, is_first_global_shot=True)
    unsafe = [e for e in errors if e.get('code') == 'W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE']
    assert unsafe and unsafe[0]['path'].endswith('.movement')
    assert 'director_performance_execution_unsafe' in SOFT_QUALITY_ERROR_TYPES
    assert not [e for e in errors if e.get('code') == 'E028_DIRECTOR_EXECUTION_AUTHORITY']

    shot = _shot(purpose='continuity')
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = canonical['performance_execution']
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert '嘴角微微抬起' in manifest['performance_text']
    assert '突然冲出房间并关上门' not in manifest['performance_text']

    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness['errors'] if e.get('type') == 'E028_DIRECTOR_EXECUTION_AUTHORITY']
    assert [w for w in readiness['warnings'] if w.get('type') == 'W024_PERFORMANCE_EXECUTION_DROPPED_UNSAFE']


def test_v17_8_compile_authority_matches_director_semantics_authority():
    shot = _shot(purpose='continuity')
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = [{
        'character_ref': 'char_001',
        'movement': '年轻人打开抽屉',
    }]
    semantics = _semantics()
    semantics['visual_events'] = [{
        'action': '年轻人打开抽屉',
        'character_refs': ['char_001'],
        'prop_refs': [],
        'source_evidence': [],
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, semantics, _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert '年轻人打开抽屉' in manifest['performance_text']
    assert '年轻人打开抽屉' in manifest['provenance']['performance_execution_authority']
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness['errors'] if e.get('type') == 'E028_DIRECTOR_EXECUTION_AUTHORITY']


def test_v17_8_unsafe_dialogue_delivery_is_soft_dropped_without_touching_frozen_line():
    shot = _shot(dialogue=True, purpose='speaker')
    shot['frozen_text_unit_refs'] = {'dialogue': ['FT001'], 'narration': []}
    shot['director']['performance_actions'] = [{
        'character_ref': 'char_001', 'action': '年轻人开口问话',
        'source_evidence': [{'quote': '后来呢？'}],
    }]
    shot['director']['performance_execution'] = [{'character_ref': 'char_001', 'expression': '嘴角微微收紧'}]
    shot['director']['dialogue_delivery'] = [{
        'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
        'delivery': '听见枪声后压低声音',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert '后来呢？' in manifest['dialogue']
    assert '听见枪声后压低声音' not in manifest['dialogue']
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness['errors'] if e.get('type') == 'E029_DIALOGUE_DELIVERY_AUTHORITY']
    assert [w for w in readiness['warnings'] if w.get('type') == 'W025_DIALOGUE_DELIVERY_DROPPED_UNSAFE']


def test_v17_8_final_readiness_keeps_e028_only_for_actual_render_leakage():
    from runtime.shot_manifest import render_shot_prompt

    shot = _shot(purpose='continuity')
    shot['director']['performance_actions'] = []
    shot['director']['performance_execution'] = [{
        'character_ref': 'char_001',
        'movement': '突然冲出房间并关上门',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert '突然冲出房间并关上门' not in manifest['performance_text']
    # Simulate a corrupted/legacy compiler bypass that leaks the rejected field.
    manifest['performance_text'] = '年轻人突然冲出房间并关上门'
    result['prompt_seedance'] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert [e for e in readiness['errors'] if e.get('type') == 'E028_DIRECTOR_EXECUTION_AUTHORITY']


def test_v17_9_old_v17_8_checkpoint_is_not_reusable(tmp_path):
    from runtime.checkpoints import CheckpointStore, unit_input_hash

    ctx = _context()
    payload = build_director_shot_payload(ctx, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    old_payload = copy.deepcopy(payload)
    old_payload['contract_version'] = 'director_shot.v17_8'
    checkpoints = CheckpointStore(tmp_path / 'checkpoints')
    checkpoints.save('run_old_v178', 'director:SH001', {
        'unit_id': 'director:SH001', 'stage': 'director', 'status': 'completed',
        'input_hash': unit_input_hash(old_payload),
        'contract_id': 'director_shot.v17_8|model-envelope.v1',
        'output': {'director': _director()},
    })
    assert checkpoints.get_reusable(
        'run_old_v178', 'director:SH001', payload,
        contract_id='director_shot.v18_0_2|model-envelope.v1',
    ) is None


def test_v17_9_readiness_uses_modifier_provenance_for_same_wording_cross_source_gaze():
    shot = _shot(dialogue=True, purpose='speaker')
    shot['frozen_text_unit_refs'] = {'dialogue': ['FT001'], 'narration': []}
    shot['director']['performance_execution'] = [{
        'character_ref': 'char_001',
        'gaze': '看向窗外',
    }]
    shot['director']['dialogue_delivery'] = [{
        'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
        'gaze_during_line': '看向窗外',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    # performance_execution may legally render this natural gaze, while the same
    # dialogue_delivery field is rejected because its target is not a current entity.
    assert '看向窗外' in manifest['gaze']
    trace = manifest['provenance']['rendered_modifier_trace']
    assert any(x.get('source') == 'performance_execution' and x.get('field') == 'gaze' and x.get('value') == '看向窗外' for x in trace)
    assert not any(x.get('source') == 'dialogue_delivery' and x.get('field') == 'gaze_during_line' and x.get('value') == '看向窗外' for x in trace)
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness['errors'] if e.get('type') == 'E029_DIALOGUE_DELIVERY_AUTHORITY']
    assert [w for w in readiness['warnings'] if w.get('type') == 'W025_DIALOGUE_DELIVERY_DROPPED_UNSAFE']


def test_v17_9_compiler_accepts_current_character_alias_for_dialogue_gaze():
    story = _story()
    story['characters'][0]['aliases'] = ['周师傅', '师傅']
    shot = _shot(dialogue=True, purpose='speaker')
    shot['frozen_text_unit_refs'] = {'dialogue': ['FT001'], 'narration': []}
    shot['director']['dialogue_delivery'] = [{
        'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
        'gaze_during_line': '看向师傅',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), story, _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert '看向师傅' in manifest['gaze']
    assert '师傅' in manifest['provenance']['camera_allowed_entity_terms']
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert not [e for e in readiness['errors'] if e.get('type') == 'E029_DIALOGUE_DELIVERY_AUTHORITY']


def test_v17_9_final_readiness_still_blocks_actual_e029_render_leakage():
    from runtime.shot_manifest import render_shot_prompt

    shot = _shot(dialogue=True, purpose='speaker')
    shot['frozen_text_unit_refs'] = {'dialogue': ['FT001'], 'narration': []}
    shot['director']['dialogue_delivery'] = [{
        'frozen_text_unit_id': 'FT001', 'speaker_ref': 'char_001',
        'gaze_during_line': '看向陌生男人',
    }]
    result = compile_shot_consumption_prompt_v2d(
        shot, _semantics(dialogue=True), _story(), _script(), _pvb(), {'scenes': []}, _style()
    )
    manifest = result['shot_consumption_manifest']
    assert '看向陌生男人' not in manifest['gaze']
    # Simulate a corrupted/legacy compiler bypass. No legal modifier trace owns
    # this text, so provenance-aware readiness must still fail hard.
    manifest['gaze'] = '年轻人看向陌生男人'
    result['prompt_seedance'] = render_shot_prompt(manifest)
    readiness = validate_production_readiness(
        compiled_project={'shot_prompts': [result], 'character_prompts': [], 'scene_prompts': []},
        shot_specs=[shot], script=None,
    )
    assert [e for e in readiness['errors'] if e.get('type') == 'E029_DIALOGUE_DELIVERY_AUTHORITY']

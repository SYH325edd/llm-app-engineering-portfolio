from __future__ import annotations

import copy

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimeV20
from runtime.source_index import build_source_index
from runtime.stages.director import canonicalize_director_fragment, validate_director_fragment
from runtime.shot_manifest import build_shot_consumption_manifest, render_shot_prompt, _dialogue_text, _narration_text


SOURCE = (
    '深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。'
    '门卫Tom推门进来，说：“医生马上来。”'
    '窗外下着雨。'
    'Sophia没有回答。'
)


class ContractAcceptanceModel:
    """A generic contract fixture, not a story-specific production implementation.

    It intentionally exercises the new boundaries in one run:
    source refs, a background speaker, selected narration, authorized Latin proper
    nouns, visible low-role PVB, production semantics, director micro-performance,
    state/ShotSpec and the final fixed prompt template.
    """

    def __init__(self):
        self.calls: list[tuple[str, str | None]] = []

    def generate_json(self, stage, system_prompt, payload):
        self.calls.append((stage, payload.get('unit_id')))
        if stage == 'story_bible':
            return {
                'bible_id': '', 'project_id': '', 'version': 1,
                'characters': [
                    {
                        'character_id': '', 'canonical_name': 'Sophia', 'aliases': [], 'role_type': 'main',
                        'explicit_facts': ['Sophia在医院病房，手里握着iPhone', 'Sophia没有回答'],
                        'inferred_facts': [], 'identity_lock': {}, 'visual_lock': {},
                        'source_evidence': [{'source_refs': ['SRC0001'], 'supports': ['explicit_facts[0]']}, {'source_refs': ['SRC0004'], 'supports': ['explicit_facts[1]']}],
                    },
                    {
                        'character_id': '', 'canonical_name': 'Tom', 'aliases': ['门卫Tom'], 'role_type': 'background',
                        'explicit_facts': ['Tom进入病房并说医生马上来'],
                        'inferred_facts': [], 'identity_lock': {}, 'visual_lock': {},
                        'source_evidence': [{'source_refs': ['SRC0002'], 'supports': ['explicit_facts[0]']}],
                    },
                ],
                'scenes': [{
                    'scene_id': '', 'canonical_name': '医院病房', 'name': '医院病房', 'time': '深夜', 'weather': '雨',
                    'explicit_facts': ['Sophia和Tom位于医院病房'],
                    'visual_lock': {},
                    'source_evidence': [{'source_refs': ['SRC0001', 'SRC0002', 'SRC0003', 'SRC0004'], 'supports': ['explicit_facts[0]', 'time', 'weather']}],
                }],
                'props': [{
                    'prop_id': '', 'canonical_name': 'iPhone', 'name': 'iPhone', 'aliases': [],
                    'narrative_importance': 'low', 'visual_presence': 'present', 'visual_asset_required': True,
                    'explicit_facts': ['Sophia手里握着iPhone'],
                    'source_evidence': [{'source_refs': ['SRC0001'], 'supports': ['explicit_facts[0]']}],
                }],
                'narrative_contexts': [],
            }
        if stage == 'scene_plan':
            return {'scenes': [{
                'source_refs': ['SRC0001', 'SRC0002', 'SRC0003', 'SRC0004'],
                'context_ref': '', 'context_transition': 'continue', 'location_ref': 'scene_001', 'time': '深夜',
                'character_refs': ['char_001', 'char_002'], 'prop_refs': ['prop_001'],
                'continuous_with_previous': False,
                'dramatic_goal': '呈现病房内的短暂交互', 'conflict': '', 'turning_point': '',
                'beat_list': [
                    {'source_refs': ['SRC0001'], 'description': 'Sophia半躺在病床上，手里握着iPhone。', 'type': 'setup'},
                    {'source_refs': ['SRC0002', 'SRC0003', 'SRC0004'], 'description': '门卫Tom进入病房并说医生马上来，Sophia没有回答。', 'type': 'interaction'},
                ],
            }]}
        if stage == 'script_scene':
            return {'scene': {
                'scene_heading': '医院病房 - 深夜',
                'scene_description': 'Sophia在病床上，Tom随后进入病房。',
                'beats': [
                    {
                        'description': 'Sophia半躺在病床上，手里握着iPhone。',
                        'dialogue': [],
                        'narration': ['深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。'],
                    },
                    {
                        'description': '门卫Tom推门进来，窗外下着雨，Sophia没有回答。',
                        'dialogue': [{'character_id': 'char_002', 'line': '医生马上来。'}],
                        'narration': [],
                    },
                ],
            }}
        if stage == 'storyboard_scene':
            return {'scene': {
                'shots': [
                    {
                        'beat_id': 'B001', 'character_refs': ['char_001'], 'prop_refs': ['prop_001'],
                        'shot_size': 'close', 'camera': 'eye_level', 'movement': 'push_in',
                        'composition': 'Sophia位于病床右侧，iPhone握在手中。', 'duration': 3.0,
                        'description': 'Sophia半躺在病床上，手里握着iPhone。', 'dialogue': [],
                        'narration': ['深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。'],
                        'continuity': {'continuous_with_previous': False, 'axis_side': 'neutral', 'eyeline_match': 'not_applicable'},
                        'source_evidence': [{'quote': 'Sophia半躺在病床上，手里握着iPhone。'}],
                    },
                    {
                        'beat_id': 'B002', 'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
                        'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
                        'composition': 'Tom从门口进入，Sophia留在病床一侧。', 'duration': 4.0,
                        'description': '门卫Tom推门进来，Sophia没有回答。',
                        'dialogue': [{'character_id': 'char_002', 'line': '医生马上来。'}],
                        'narration': [],
                        'continuity': {'continuous_with_previous': True, 'axis_side': 'neutral', 'eyeline_match': 'not_applicable'},
                        'source_evidence': [{'quote': '门卫Tom推门进来，窗外下着雨，Sophia没有回答。'}],
                    },
                ],
            }}
        if stage == 'pvb_character':
            cid = payload['story_character']['character_id']
            if cid == 'char_001':
                return {'character': {
                    'visual_identity': {'age_appearance': '年轻成年女性', 'face': '自然真实面部', 'hair': '深色中长发', 'body': '偏瘦自然体态', 'skin': '自然肤色'},
                    'wardrobe': {'default': '病房中的简洁衣服', 'outerwear': '', 'shirt': '素色上衣', 'footwear': '平底鞋', 'accessory': ''},
                }}
            return {'character': {
                'visual_identity': {'age_appearance': '成年男性', 'face': '普通门卫面部特征', 'hair': '短发', 'body': '中等体态', 'skin': '自然肤色'},
                'wardrobe': {'default': '简洁门卫工作衣服', 'outerwear': '工作外套', 'shirt': '素色上衣', 'footwear': '工作鞋', 'accessory': ''},
            }}
        if stage == 'psb_scene':
            return {'scene': {'production_visual': {
                'space': '单人医院病房', 'layout': '病床靠墙，门位于床尾一侧', 'materials': '浅色墙面与金属病床',
                'lighting': '深夜柔和室内照明', 'color': '低饱和冷中性色', 'environment': '安静整洁的病房空间',
            }}}
        if stage == 'style_guide':
            return {
                'era': '当代', 'region': '未限定', 'genre': '现实主义短剧',
                'tone': '克制写实', 'visual_reference': '真实摄影质感',
            }
        if stage == 'production_semantics_shot':
            shot = payload['shot']
            evidence = list((payload.get('program_owned') or {}).get('current_shot_evidence') or [])
            quote = evidence[0]
            dialogue = [
                {'character_id': x.get('character_id'), 'line': x.get('line'), 'offscreen': False}
                for x in (shot.get('dialogue') or [])
            ]
            audio = []
            if shot.get('shot_id') == 'SH002':
                audio.append({
                    'audio_type': 'diegetic', 'audio_role': 'environment', 'origin': 'production_design',
                    'content': '窗外轻微雨声', 'source_evidence': [],
                })
            return {'production_semantics': {
                'visual_events': [{
                    'action': shot['description'],
                    'character_refs': list(shot.get('character_refs') or []),
                    'prop_refs': list(shot.get('prop_refs') or []),
                    'source_evidence': [{'quote': quote}],
                }],
                'audio_events': audio,
                'renderability_status': 'renderable', 'renderability_issues': [],
                'dialogue': dialogue, 'diegetic_text': [], 'production_choices': [], 'appearance_overlays': [],
            }}
        if stage == 'director_shot':
            shot = payload['shot']
            refs = list(shot.get('character_refs') or [])
            evidence = list((payload.get('program_owned') or {}).get('current_shot_action_evidence') or [])
            quote = evidence[0]
            if shot.get('shot_id') == 'SH001':
                actions = [{
                    'character_ref': 'char_001',
                    'action': 'Sophia视线短暂停在手机上，呼吸保持自然，手指轻微收紧',
                    'transformation_type': 'visible_state_expression',
                    'dependency_tags': ['eyes', 'hands', 'upper_body'],
                    'source_evidence': [{'quote': quote}],
                }]
                focus = {'focus_type': 'character', 'subject_refs': ['char_001'], 'body_regions': {'char_001': ['eyes', 'hands']}, 'prop_refs': ['prop_001'], 'environment_keys': []}
            else:
                actions = [
                    {
                        'character_ref': 'char_002', 'action': 'Tom推门后停在门口，开口说话',
                        'transformation_type': 'visible_state_expression', 'dependency_tags': ['upper_body', 'mouth', 'spatial_interaction'],
                        'source_evidence': [{'quote': quote}],
                    },
                    {
                        'character_ref': 'char_001', 'action': 'Sophia没有回应，只把视线转向门口',
                        'transformation_type': 'visible_state_expression', 'dependency_tags': ['eyes', 'head'],
                        'source_evidence': [{'quote': quote}],
                    },
                ]
                focus = {'focus_type': 'reaction', 'subject_refs': refs, 'body_regions': {'char_002': ['mouth', 'upper_body'], 'char_001': ['eyes', 'head']}, 'prop_refs': [], 'environment_keys': []}
            performance_execution = ([{
                'character_ref': 'char_001',
                'gaze': '视线短暂停在手机上',
                'hands': '手指在手机边缘轻微收紧',
            }] if shot.get('shot_id') == 'SH001' else [{
                'character_ref': 'char_002',
                'movement': '推门后停在门口，身体保持面向病床',
                'body': '上半身略微前倾后停住',
            }, {
                'character_ref': 'char_001',
                'gaze': '视线从手机转向门口',
                'micro_reaction': '没有回应，只出现短暂的视线变化',
            }])
            return {'director': {
                'dramatic_intent': '保持当前事件不变，只强化可见表演与人物反应',
                'primary_subject_refs': refs,
                'reaction_target_refs': ['char_001'] if shot.get('shot_id') == 'SH002' else [],
                'performance_actions': actions,
                'performance_logic': [],
                'performance_execution': performance_execution,
                'dialogue_delivery': [],
                'visual_focus': focus,
                'action_delta': {'characters': {}, 'props': {}, 'environment': {}},
                'continuity_scope': {'mode': 'reset' if shot.get('shot_id') == 'SH001' else 'inherit'},
            }}
        raise AssertionError((stage, payload.get('unit_id')))


def test_source_index_keeps_sentence_closing_quote_with_spoken_sentence():
    units = build_source_index(SOURCE)
    assert units[1]['text'] == '门卫Tom推门进来，说：“医生马上来。”'
    assert units[2]['text'] == '窗外下着雨。'
    assert ''.join(x['text'] for x in units) == SOURCE


def test_rebalanced_contract_full_stateful_chain_reaches_fixed_prompt_template(tmp_path):
    model = ContractAcceptanceModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / 'runs'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints'),
    )
    run = runtime.start(SOURCE, '通用契约验收')
    assert run['status'] == 'completed', run.get('error')
    assert run['compile_status'] in {'ok', 'warning'}
    assert run['artifacts']['static_evaluation']['passed'] is True
    assert run['artifacts']['consumption_evaluation']['passed'] is True

    # Background narrative role does not prohibit source-authored dialogue, and a
    # visible low-role character receives a production PVB instead of becoming an
    # asset-less downstream reference.
    assert ('pvb_character', 'pvb:char_002') in model.calls
    assert run['artifacts']['script']['scenes'][0]['beats'][1]['dialogue'] == [
        {'character_id': 'char_002', 'line': '医生马上来。'}
    ]

    prompts = run['artifacts']['compiled_project']['shot_prompts']
    assert len(prompts) == 2
    first = prompts[0]['prompt_seedance']
    second = prompts[1]['prompt_seedance']
    for label in (
        '镜号：', '时长：', '场景：', '人物空间站位：', '景别：', '摄法：',
        '画面内容：', '旁白：', '台词：', '动作音效：', '环境音效：', '氛围音效：', '配乐：无',
    ):
        assert label in first
    assert '深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。' in first
    assert 'Tom（画内）：“医生马上来。”' in second
    assert '窗外轻微雨声' in second
    assert '深色中长发' in first
    assert '自然真实面部' in first
    assert '单人医院病房' in first
    assert '写实生活流' in first
    assert 'Sophia视线短暂停在手机上' in first


def test_director_is_soft_for_visible_performance_but_hard_for_persistent_psychology():
    context = {
        'shot': {'shot_id': 'SH001', 'character_refs': ['char_001'], 'prop_refs': [], 'dialogue': [], 'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static'},
        'program_owned': {
            'allowed_character_refs': ['char_001'], 'allowed_prop_refs': [],
            'current_shot_action_evidence': ['她没有回答。'],
            'environment_focus_authority': [],
        },
        'previous_state_out': {'characters': {}, 'props': {}, 'environment': {}},
    }
    fragment = {
        'dramatic_intent': '强化沉默的可见反应', 'primary_subject_refs': ['char_001'], 'reaction_target_refs': [],
        'performance_actions': [{
            'character_ref': 'char_001', 'action': '她短暂停顿，轻轻抿嘴并移开视线',
            'transformation_type': 'visible_state_expression', 'dependency_tags': ['mouth', 'eyes'],
            'source_evidence': [{'quote': '她没有回答。'}],
        }],
        'visual_focus': {'focus_type': 'character', 'subject_refs': ['char_001'], 'body_regions': {'char_001': ['mouth', 'eyes']}, 'prop_refs': [], 'environment_keys': []},
        'action_delta': {'characters': {'char_001': {'relationship_state': '不再信任对方'}}, 'props': {}, 'environment': {}},
        'continuity_scope': {'mode': 'reset'},
    }
    canonical, _ = canonicalize_director_fragment(fragment, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    types = {x['type'] for x in errors}
    assert 'nonpersistent_semantic_state' in types
    assert 'unanchored_performance_evidence' not in types


def test_final_prompt_dialogue_strips_outer_quotes_without_python311_fstring_escape_regression():
    story = {
        'characters': [
            {'character_id': 'char_001', 'canonical_name': 'Tom'},
        ],
    }
    manifest = {
        'shot_id': 'SH001',
        'duration': 2.0,
        'aspect_ratio': '9:16',
        'scene': '病房',
        'time_label': '深夜',
        'character_positions': 'Tom位于门口',
        'shot_size': '近景',
        'camera': '平视机位',
        'movement': '固定镜头',
        'composition': 'Tom站在门口',
        'visual_content': 'Tom推门后开口。',
        'narration': [],
        'dialogue': [{'character_id': 'char_001', 'line': '“医生马上来。”', 'offscreen': False}],
        'action_sfx': '无',
        'environment_sfx': '无',
        'atmosphere_sfx': '无',
    }
    dialogue = _dialogue_text(
        {'dialogue': manifest['dialogue']},
        {'dialogue': manifest['dialogue']},
        story,
    )
    assert dialogue == 'Tom（画内）：“医生马上来。”'
    assert '““医生马上来。””' not in dialogue


def test_production_semantics_nested_context_ids_are_program_owned_end_to_end(tmp_path):
    class WrongNestedContextModel(ContractAcceptanceModel):
        def generate_json(self, stage, system_prompt, payload):
            out = super().generate_json(stage, system_prompt, payload)
            if stage == 'story_bible':
                out = copy.deepcopy(out)
                out['narrative_contexts'] = [{
                    'context_id': '',
                    'reality_status': 'reality',
                    'temporal_mode': 'present',
                    'representation_mode': 'direct',
                    'source_evidence': [{'source_refs': ['SRC0001', 'SRC0002', 'SRC0003', 'SRC0004']}],
                }]
            elif stage == 'scene_plan':
                out = copy.deepcopy(out)
                out['scenes'][0]['context_ref'] = 'context_001'
            elif stage == 'production_semantics_shot' and payload['shot']['shot_id'] == 'SH002':
                out = copy.deepcopy(out)
                quote = payload['program_owned']['current_shot_evidence'][0]
                out['production_semantics']['production_choices'] = [{
                    'type': 'natural_reaction',
                    'choice': 'Tom推门后在门口短暂停住。',
                    'affected_character_refs': ['char_002'],
                    'affected_prop_refs': [],
                    'narrative_context_ref': 'context_wrong',
                    'impact': 'no_story_change',
                    'rationale': '不改变剧情，只明确已有进入动作后的自然停顿。',
                    'story_changes': {
                        'new_characters': [], 'new_relationships': [], 'new_plot_outcomes': [],
                        'new_dialogue_information': [], 'new_locations': [], 'new_key_props': [],
                    },
                    'source_evidence': [{'quote': quote}],
                }]
            return out

    model = WrongNestedContextModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / 'runs-context-owner'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints-context-owner'),
    )
    run = runtime.start(SOURCE, 'Production Semantics context ownership regression')
    assert run['status'] == 'completed', run.get('error')
    sh002 = next(x for x in run['artifacts']['production_semantics']['shots'] if x['shot_id'] == 'SH002')
    assert sh002['production_choices'][0]['narrative_context_ref'] == 'context_001'
    assert [x for x in model.calls if x[0] == 'production_semantics_shot'] == [
        ('production_semantics_shot', 'production_semantics:SH001'),
        ('production_semantics_shot', 'production_semantics:SH002'),
    ]


def test_production_semantics_boolean_representation_drift_does_not_consume_repair(tmp_path):
    class StringBooleanModel(ContractAcceptanceModel):
        def generate_json(self, stage, system_prompt, payload):
            out = super().generate_json(stage, system_prompt, payload)
            if stage == 'production_semantics_shot' and payload['shot'].get('dialogue'):
                out = copy.deepcopy(out)
                for item in out['production_semantics'].get('dialogue', []):
                    item['offscreen'] = 'false'
            return out

    model = StringBooleanModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / 'runs-bool-normalize'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints-bool-normalize'),
    )
    run = runtime.start(SOURCE, 'Production Semantics boolean representation regression')
    assert run['status'] == 'completed', run.get('error')
    semantic_calls = [x for x in model.calls if x[0] == 'production_semantics_shot']
    assert semantic_calls == [
        ('production_semantics_shot', 'production_semantics:SH001'),
        ('production_semantics_shot', 'production_semantics:SH002'),
    ]
    dialogue_shot = next(
        x for x in run['artifacts']['production_semantics']['shots']
        if x.get('dialogue')
    )
    assert all(item['offscreen'] is False for item in dialogue_shot['dialogue'])

LOW_CONF_DIALOGUE_SOURCE = (
    '深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。'
    '门卫Tom推门进来，看向窗外：“雨还没停？”'
    'Tom说：“医生马上来。”'
    'Sophia没有回答。'
)


class LowConfidenceQuotedDialogueModel(ContractAcceptanceModel):
    def generate_json(self, stage, system_prompt, payload):
        if stage == 'story_bible':
            self.calls.append((stage, payload.get('unit_id')))
            return {
                'bible_id': '', 'project_id': '', 'version': 1,
                'characters': [
                    {
                        'character_id': '', 'canonical_name': 'Sophia', 'aliases': [], 'role_type': 'main',
                        'explicit_facts': ['Sophia在医院病房，手里握着iPhone', 'Sophia没有回答'],
                        'inferred_facts': [], 'identity_lock': {}, 'visual_lock': {},
                        'source_evidence': [
                            {'source_refs': ['SRC0001'], 'supports': ['explicit_facts[0]']},
                            {'source_refs': ['SRC0004'], 'supports': ['explicit_facts[1]']},
                        ],
                    },
                    {
                        'character_id': '', 'canonical_name': 'Tom', 'aliases': ['门卫Tom'], 'role_type': 'background',
                        'explicit_facts': ['Tom进入病房并说话'], 'inferred_facts': [], 'identity_lock': {}, 'visual_lock': {},
                        'source_evidence': [{'source_refs': ['SRC0002', 'SRC0003'], 'supports': ['explicit_facts[0]']}],
                    },
                ],
                'scenes': [{
                    'scene_id': '', 'canonical_name': '医院病房', 'name': '医院病房', 'time': '深夜', 'weather': '',
                    'explicit_facts': ['Sophia和Tom位于医院病房'], 'visual_lock': {},
                    'source_evidence': [{'source_refs': ['SRC0001', 'SRC0002', 'SRC0003', 'SRC0004'], 'supports': ['explicit_facts[0]', 'time']}],
                }],
                'props': [{
                    'prop_id': '', 'canonical_name': 'iPhone', 'name': 'iPhone', 'aliases': [],
                    'narrative_importance': 'low', 'visual_presence': 'present', 'visual_asset_required': True,
                    'explicit_facts': ['Sophia手里握着iPhone'],
                    'source_evidence': [{'source_refs': ['SRC0001'], 'supports': ['explicit_facts[0]']}],
                }],
                'narrative_contexts': [],
            }
        if stage == 'scene_plan':
            self.calls.append((stage, payload.get('unit_id')))
            return {'scenes': [{
                'source_refs': ['SRC0001', 'SRC0002', 'SRC0003', 'SRC0004'],
                'context_ref': '', 'context_transition': 'continue', 'location_ref': 'scene_001', 'time': '深夜',
                'character_refs': ['char_001', 'char_002'], 'prop_refs': ['prop_001'],
                'continuous_with_previous': False,
                'dramatic_goal': '呈现病房中的短暂交流', 'conflict': '', 'turning_point': '',
                'beat_list': [
                    {'source_refs': ['SRC0001'], 'description': 'Sophia在病床上握着iPhone。', 'type': 'setup'},
                    {'source_refs': ['SRC0002', 'SRC0003', 'SRC0004'], 'description': 'Tom进入病房并连续说话，Sophia没有回答。', 'type': 'interaction'},
                ],
            }]}
        if stage == 'script_scene':
            self.calls.append((stage, payload.get('unit_id')))
            return {'scene': {
                'scene_heading': '医院病房 - 深夜',
                'scene_description': 'Sophia在病床上，Tom随后进入。',
                'beats': [
                    {
                        'description': 'Sophia半躺在病床上，手里握着iPhone。',
                        'dialogue': [],
                        'narration': ['深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。'],
                    },
                    {
                        'description': 'Tom进入病房，看向窗外后说话，Sophia没有回答。',
                        'dialogue': [
                            {'character_id': 'char_002', 'line': '雨还没停？'},
                            {'character_id': 'char_002', 'line': '医生马上来。'},
                        ],
                        'narration': [],
                    },
                ],
            }}
        if stage == 'storyboard_scene':
            self.calls.append((stage, payload.get('unit_id')))
            return {'scene': {'shots': [
                {
                    'beat_id': 'B001', 'character_refs': ['char_001'], 'prop_refs': ['prop_001'],
                    'shot_size': 'close', 'camera': 'eye_level', 'movement': 'push_in',
                    'composition': 'Sophia位于病床右侧，iPhone握在手中。', 'duration': 3.0,
                    'description': 'Sophia半躺在病床上，手里握着iPhone。', 'dialogue': [],
                    'narration': ['深夜，医院病房里，Sophia半躺在病床上，手里握着iPhone。'],
                    'continuity': {'continuous_with_previous': False, 'axis_side': 'neutral', 'eyeline_match': 'not_applicable'},
                    'source_evidence': [{'quote': 'Sophia半躺在病床上，手里握着iPhone。'}],
                },
                {
                    'beat_id': 'B002', 'character_refs': ['char_001', 'char_002'], 'prop_refs': [],
                    'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static',
                    'composition': 'Tom位于门口一侧，Sophia留在病床边。', 'duration': 5.0,
                    'description': '门卫Tom推门进来，看向窗外，Sophia没有回答。',
                    'dialogue': [
                        {'character_id': 'char_002', 'line': '雨还没停？'},
                        {'character_id': 'char_002', 'line': '医生马上来。'},
                    ],
                    'narration': [],
                    'continuity': {'continuous_with_previous': True, 'axis_side': 'neutral', 'eyeline_match': 'not_applicable'},
                    'source_evidence': [
                        {'quote': '门卫Tom推门进来，看向窗外：“雨还没停？”'},
                        {'quote': 'Tom说：“医生马上来。”'},
                        {'quote': 'Sophia没有回答。'},
                    ],
                },
            ]}}
        return super().generate_json(stage, system_prompt, payload)


def test_full_chain_accepts_source_quoted_dialogue_outside_high_confidence_manifest(tmp_path):
    model = LowConfidenceQuotedDialogueModel()
    runtime = RuntimeV20(
        model=model,
        store=RunStore(tmp_path / 'runs-low-confidence-dialogue'),
        checkpoints=CheckpointStore(tmp_path / 'checkpoints-low-confidence-dialogue'),
    )
    run = runtime.start(LOW_CONF_DIALOGUE_SOURCE, '低置信引号对白全链验收')
    assert run['status'] == 'completed', run.get('error')
    assert run['compile_status'] in {'ok', 'warning'}
    script_dialogue = run['artifacts']['script']['scenes'][0]['beats'][1]['dialogue']
    assert [x['line'] for x in script_dialogue] == ['雨还没停？', '医生马上来。']
    second_prompt = run['artifacts']['compiled_project']['shot_prompts'][1]['prompt_seedance']
    assert '雨还没停？' in second_prompt
    assert '医生马上来。' in second_prompt


def test_final_prompt_narration_does_not_inject_separator_between_frozen_segments():
    shot = {"narration": ["人物停了一秒，", "又继续向前走。"]}
    assert _narration_text(shot, {}) == "人物停了一秒，又继续向前走。"

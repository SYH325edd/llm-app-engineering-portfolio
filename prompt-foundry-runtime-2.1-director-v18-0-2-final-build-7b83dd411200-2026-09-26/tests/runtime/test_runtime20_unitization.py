from __future__ import annotations

import copy

import pytest

from app.store import RunStore
from runtime.checkpoints import CheckpointStore
from runtime.orchestrator import RuntimePaused, RuntimeV20


class MultiUnitModel:
    def __init__(self):
        self.calls = []

    def generate_json(self, stage, system_prompt, payload):
        uid = payload.get('unit_id')
        self.calls.append((stage, uid))
        if stage == 'story_bible':
            return {
                'bible_id':'b','project_id':'p','version':1,
                'characters':[
                    {'character_id':'char_001','canonical_name':'甲','aliases':[],'role_type':'main','explicit_facts':['甲在房间'], 'inferred_facts':[], 'identity_lock':{}, 'visual_lock':{}, 'source_evidence':[{'quote':'甲在房间'}]},
                    {'character_id':'char_002','canonical_name':'乙','aliases':[],'role_type':'supporting','explicit_facts':['乙在走廊'], 'inferred_facts':[], 'identity_lock':{}, 'visual_lock':{}, 'source_evidence':[{'quote':'乙在走廊'}]},
                ],
                'scenes':[
                    {'scene_id':'scene_001','canonical_name':'房间','name':'房间','time':'白天','weather':'','explicit_facts':[],'visual_lock':{},'source_evidence':[{'quote':'房间'}]},
                    {'scene_id':'scene_002','canonical_name':'走廊','name':'走廊','time':'白天','weather':'','explicit_facts':[],'visual_lock':{},'source_evidence':[{'quote':'走廊'}]},
                ],
                'props':[], 'narrative_contexts':[]
            }
        if stage == 'scene_plan':
            return {'scenes':[
                {'scene_id':'SC001','context_ref':'','context_transition':'continue','location_ref':'scene_001','time':'白天','character_refs':['char_001'],'prop_refs':[],'continuous_with_previous':False,'dramatic_goal':'甲','conflict':'','turning_point':'','beat_list':[{'beat_id':'B001','description':'甲在房间。','type':'setup'}]},
                {'scene_id':'SC002','context_ref':'','context_transition':'continue','location_ref':'scene_002','time':'白天','character_refs':['char_002'],'prop_refs':[],'continuous_with_previous':False,'dramatic_goal':'乙','conflict':'','turning_point':'','beat_list':[{'beat_id':'B002','description':'乙在走廊。','type':'setup'}]},
            ]}
        if stage == 'script_scene':
            scene_id = payload['scene_plan_scene']['scene_id']
            char = 'char_001' if scene_id == 'SC001' else 'char_002'
            name = '甲' if scene_id == 'SC001' else '乙'
            beat = payload['required_beat_ids'][0]
            loc = payload['scene_plan_scene']['location_ref']
            return {'scene': {'scene_id':scene_id,'context_ref':'','location_ref':loc,'scene_heading':name,'scene_description':('甲在房间。' if name == '甲' else '乙在走廊。'),'beats':[{'beat_id':beat,'description':('甲在房间。' if name == '甲' else '乙在走廊。'),'dialogue':[]}]}}
        if stage == 'storyboard_scene':
            ps = payload['scene_plan_scene']; ss = payload['script_scene']; scene_id=ps['scene_id']; char=ps['character_refs'][0]
            name = '甲' if char == 'char_001' else '乙'
            return {'scene': {'scene_id':scene_id,'context_ref':'','location_ref':ps['location_ref'],'shots':[{
                'shot_id':'SH001','scene_id':scene_id,'beat_id':ss['beats'][0]['beat_id'],'character_refs':[char],'prop_refs':[],
                'shot_size':'medium','camera':'eye_level','movement':'static','composition':f'{name}位于画面中央','duration':3.0,'description':ss['beats'][0]['description'],'dialogue':[],
                'continuity':{'continuous_with_previous':False,'axis_side':'neutral','eyeline_match':'not_applicable'},'source_evidence':[{'quote':ss['beats'][0]['description']}]
            }]}}
        if stage == 'production_semantics_shot':
            shot = payload.get('shot', {}) or {}
            evidence = (payload.get('program_owned', {}) or {}).get('current_shot_evidence') or []
            quote = next((str(x).strip() for x in evidence if isinstance(x, str) and str(x).strip()), '')
            description = str(shot.get('description') or '').strip()
            visual_events = []
            if description and quote:
                visual_events.append({
                    'action': description,
                    'character_refs': list(shot.get('character_refs') or []),
                    'prop_refs': list(shot.get('prop_refs') or []),
                    'source_evidence': [{'quote': quote}],
                })
            return {'production_semantics': {
                'visual_events': visual_events,
                'audio_events': [],
                'renderability_status': 'renderable',
                'renderability_issues': [],
                'dialogue': [
                    {'character_id': x.get('character_id'), 'line': x.get('line'), 'offscreen': False}
                    for x in (payload.get('shot', {}).get('dialogue') or [])
                ],
                'diegetic_text': [],
                'production_choices': [],
                'appearance_overlays': [],
            }}
        if stage == 'director_shot':
            shot=payload['shot']; char=shot['character_refs'][0]; quote=shot['description']; first=shot['shot_id']=='SH001'
            return {'director': {
                'dramatic_intent':f'保持镜头叙事重点在{char}的当前行为上','primary_subject_refs':[char],'reaction_target_refs':[],
                'performance_actions':[{'character_ref':char,'action':quote,'transformation_type':'visible_state_expression','dependency_tags':['upper_body'],'source_evidence':[{'quote':quote}]}],
                'visual_focus':{'focus_type':'character','subject_refs':[char],'body_regions':{char:['upper_body']},'prop_refs':[],'environment_keys':[]},
                'action_delta':{'characters':{},'props':{},'environment':{}},'state_out':{'characters':{},'props':{},'environment':{}},
                'continuity_scope':{'mode':'reset' if first else 'reset'}
            }}
        if stage == 'pvb_character':
            c=payload['story_character']; cid=c['character_id']
            def ent(v): return {'value':v,'source':'production_design','status':'candidate'}
            return {'character': {'character_id':cid,'visual_identity':{'age_appearance':ent('成年'),'face':ent('自然面部'),'hair':ent('黑发'),'body':ent('自然体态'),'skin':ent('自然肤色')},'wardrobe':{'default':ent('日常'),'outerwear':ent('外套'),'shirt':ent('上衣'),'footwear':ent('鞋'),'accessory':{'value':'','source':'','status':'optional_absent'}},'status':'candidate','version':1}}
        if stage == 'psb_scene':
            sid=payload['story_scene']['scene_id']
            def ent(v): return {'value':v,'source':'production_design','status':'candidate'}
            values = {
                'space': '日常室内空间',
                'layout': '主体活动区位于画面中央，通行动线保持清晰',
                'materials': '常规墙地面与日常家具材质',
                'lighting': '自然环境光均匀照明',
                'color': '低饱和中性色',
                'environment': '日常使用状态',
            }
            return {'scene': {'scene_id':sid,'production_visual':{k:ent(v) for k,v in values.items()},'status':'candidate','version':1}}
        if stage == 'style_guide':
            return {k:{'value':k,'source':'production_design','status':'candidate'} for k in ['era','region','genre','tone','visual_reference']}
        raise AssertionError((stage,uid))


def test_runtime_unitizes_script_storyboard_director_pvb_and_psb(tmp_path):
    model=MultiUnitModel()
    run=RuntimeV20(model=model, store=RunStore(tmp_path/'runs'), checkpoints=CheckpointStore(tmp_path/'checkpoints')).start('甲在房间。乙在走廊。','多单元')
    assert run['status']=='completed'
    assert model.calls.count(('script_scene','script:SC001'))==1
    assert model.calls.count(('script_scene','script:SC002'))==1
    assert model.calls.count(('storyboard_scene','storyboard:SC001'))==1
    assert model.calls.count(('storyboard_scene','storyboard:SC002'))==1
    assert model.calls.count(('director_shot','director:SH001'))==1
    assert model.calls.count(('director_shot','director:SH002'))==1
    assert model.calls.count(('pvb_character','pvb:char_001'))==1
    assert model.calls.count(('pvb_character','pvb:char_002'))==1
    assert model.calls.count(('psb_scene','psb:scene_001'))==1
    assert model.calls.count(('psb_scene','psb:scene_002'))==1
    assert not any(stage=='director' for stage,_ in model.calls)
    assert run['counts']['shots']==2
    assert len(run['artifacts']['compiled_project']['character_prompts'])==2
    assert len(run['artifacts']['compiled_project']['scene_prompts'])==2
    assert len(run['artifacts']['compiled_project']['shot_prompts'])==2
    assert run['artifacts']['static_evaluation']['passed'] is True


def test_retry_one_unit_reuses_unaffected_checkpoints(tmp_path):
    model=MultiUnitModel()
    rt=RuntimeV20(model=model, store=RunStore(tmp_path/'runs'), checkpoints=CheckpointStore(tmp_path/'checkpoints'))
    run=rt.start('甲在房间。乙在走廊。','最小重试')
    assert run['status']=='completed'
    before=list(model.calls)

    run=rt.retry_unit(run['run_id'], 'script:SC001')
    assert run['status']=='completed'
    after=model.calls[len(before):]

    # Only the explicitly retried Script unit must call the model again in this fixture.
    # Its downstream Scene/Shot inputs are unchanged, so their completed checkpoints are reusable.
    assert ('script_scene','script:SC001') in after
    assert ('script_scene','script:SC002') not in after
    assert ('storyboard_scene','storyboard:SC002') not in after
    assert ('pvb_character','pvb:char_002') not in after
    assert ('psb_scene','psb:scene_002') not in after


def test_retry_invalidation_clears_all_consumption_compile_views_and_status(tmp_path):
    model = MultiUnitModel()
    rt = RuntimeV20(model=model, store=RunStore(tmp_path/'runs'), checkpoints=CheckpointStore(tmp_path/'checkpoints'))
    run = rt.start('甲在房间。乙在走廊。', '消费层重试清理')
    assert run['status'] == 'completed'
    assert 'legacy_compiled_project' in run['artifacts']
    assert 'consumption_evaluation' in run['artifacts']
    assert 'consumption_evaluation' in run['validations']
    assert 'production_readiness' in run['artifacts']
    assert 'production_readiness' in run['validations']
    assert run.get('compiler_version') == 'consumption_v2m'

    rt._invalidate_from(run, 'script:SC001')

    for key in ['compiled_project', 'consumption_v1_compiled_project', 'legacy_compiled_project', 'static_evaluation', 'consumption_evaluation', 'production_readiness']:
        assert key not in run['artifacts']
    assert 'static_evaluation' not in run['validations']
    assert 'consumption_evaluation' not in run['validations']
    assert 'production_readiness' not in run['validations']
    assert 'compiler_version' not in run
    assert 'compile_status' not in run


def test_compile_asset_preflight_routes_missing_identity_back_to_pvb_and_resume_regenerates_only_asset(tmp_path):
    model = MultiUnitModel()
    rt = RuntimeV20(model=model, store=RunStore(tmp_path/'runs'), checkpoints=CheckpointStore(tmp_path/'checkpoints'))
    run = rt.start('甲在房间。乙在走廊。', 'PVB recovery attribution')
    assert run['status'] == 'completed'

    # Simulate a legacy/stale locked artifact that passed an older PVB contract
    # with no usable identity values. Story Bible has no visual lock in this fixture.
    bad = run['artifacts']['pvb']['characters'][0]
    assert bad['character_id'] == 'char_001'
    for section in ('visual_identity', 'wardrobe'):
        for entry in (bad.get(section) or {}).values():
            if isinstance(entry, dict):
                entry['value'] = ''

    before_calls = list(model.calls)
    with pytest.raises(RuntimePaused):
        rt._compile(run, run['artifacts'])

    assert run['error']['failure_kind'] == 'compile_asset_preflight_failure'
    assert run['error']['retryable'] is True
    assert run['error']['retry_mode'] == 'regenerate_source_units'
    assert run['error']['source_unit_ids'] == ['pvb:char_001']

    resumed = rt.resume(run['run_id'])
    assert resumed['status'] == 'completed'
    after = model.calls[len(before_calls):]
    assert ('pvb_character', 'pvb:char_001') in after
    assert ('director_shot', 'director:SH001') not in after
    assert resumed['artifacts']['production_readiness']['passed'] is True


class BlankOncePVBModel(MultiUnitModel):
    def __init__(self):
        super().__init__()
        self.pvb_attempts = {}

    def generate_json(self, stage, system_prompt, payload):
        if stage == 'pvb_character':
            cid = payload['story_character']['character_id']
            self.pvb_attempts[cid] = self.pvb_attempts.get(cid, 0) + 1
            if cid == 'char_001' and self.pvb_attempts[cid] == 1:
                self.calls.append((stage, payload.get('unit_id')))
                return {'character': {
                    'visual_identity': {k: '' for k in ('age_appearance','face','hair','body','skin')},
                    'wardrobe': {k: '' for k in ('default','outerwear','shirt','footwear','accessory')},
                }}
        return super().generate_json(stage, system_prompt, payload)


def test_pvb_v3_1_repairs_all_empty_new_asset_inside_own_unit_before_compile(tmp_path):
    model = BlankOncePVBModel()
    rt = RuntimeV20(model=model, store=RunStore(tmp_path/'runs'), checkpoints=CheckpointStore(tmp_path/'checkpoints'))
    run = rt.start('甲在房间。乙在走廊。', 'PVB local repair')
    assert run['status'] == 'completed'
    assert model.pvb_attempts['char_001'] == 2
    unit = run['units']['pvb:char_001']
    assert unit['repair_count'] == 1
    assert unit['attempts'][0]['status'] == 'validation_failed'
    assert any(e.get('type') == 'pvb_missing_identity_anchor' for e in unit['attempts'][0]['errors'])
    assert unit['attempts'][1]['status'] in {'passed', 'passed_with_quality_warnings'}
    assert run['artifacts']['production_readiness']['passed'] is True

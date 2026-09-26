from __future__ import annotations

import ast
import copy
import inspect

import runtime.stages.director as director_stage

from prompt_foundry_v1_3.state_resolver import empty_state
from runtime.stages.director import (
    SYSTEM_PROMPT,
    build_director_shot_payload,
    canonicalize_director_fragment,
    stabilize_director_contract_conflicts,
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


def test_first_shot_reset_and_speaker_refs_are_program_owned():
    raw = _director()
    raw.pop('speaker_target_refs', None)
    raw['continuity_scope'] = {'mode': 'inherit'}
    canonical, changes = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    assert canonical['speaker_target_refs'] == []
    assert canonical['continuity_scope'] == {'mode': 'reset'}
    assert changes >= 1
    assert validate_director_fragment(canonical, _context(), is_first_global_shot=True) == []


def test_unknown_director_and_nested_fields_are_rejected():
    raw = _director()
    raw['mood'] = 'invented'
    raw['performance_actions'][0]['camera_instruction'] = 'push in'
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert any(e['type'] == 'extra_director_field' and e['path'] == 'director.mood' for e in errors)
    assert any(e['type'] == 'extra_director_field' and 'camera_instruction' in e['path'] for e in errors)


def test_partial_scope_must_reference_existing_previous_state_fields_before_checkpoint():
    previous = {'characters': {'char_001': {'position': '窗边'}}, 'props': {}, 'environment': {}}
    raw = _director()
    raw['continuity_scope'] = {
        'mode': 'partial',
        'inherit': {'characters': {'char_001': ['missing_field']}, 'props': {}, 'environment': []},
    }
    canonical, _ = canonicalize_director_fragment(raw, _context(previous), is_first_global_shot=False)
    errors = validate_director_fragment(canonical, _context(previous), is_first_global_shot=False)
    assert any(e['type'] == 'invalid_continuity_character_field' for e in errors)
    assert not any(e['type'] == 'state_resolution_failure' for e in errors)


def test_v10_program_derives_state_out_from_action_delta_inside_director_unit():
    previous = {'characters': {'char_001': {'position': '窗边'}}, 'props': {}, 'environment': {}}
    raw = _director()
    raw['continuity_scope'] = {'mode': 'inherit'}
    raw['action_delta'] = {'characters': {'char_001': {'position': '门边'}}, 'props': {}, 'environment': {}}
    raw['state_out'] = {'characters': {'char_001': {'position': '错误值'}}, 'props': {}, 'environment': {}}
    canonical, _ = canonicalize_director_fragment(raw, _context(previous), is_first_global_shot=False)
    errors = validate_director_fragment(canonical, _context(previous), is_first_global_shot=False)
    assert canonical['state_out']['characters']['char_001']['position'] == '门边'
    assert not any(e['type'] in {'action_delta_not_reflected_in_state_out', 'state_out_change_without_delta'} for e in errors)


def test_performance_evidence_must_be_anchored_in_current_context():
    raw = _director()
    raw['performance_actions'][0]['source_evidence'] = [{'quote': '原文里完全不存在的句子'}]
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert any(e['type'] == 'unanchored_performance_evidence' for e in errors)


def test_illegal_primary_or_reaction_refs_are_not_silently_filtered():
    raw = _director()
    raw['primary_subject_refs'] = ['prop_001']
    raw['reaction_target_refs'] = ['char_999']
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    assert canonical['primary_subject_refs'] == ['prop_001']
    assert canonical['reaction_target_refs'] == ['char_999']
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert any(e['type'] == 'invalid_primary_subject_ref' for e in errors)
    assert any(e['type'] == 'invalid_reaction_target_ref' for e in errors)


def test_payload_contains_only_current_context_and_exact_contract():
    payload = build_director_shot_payload(_context(), unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    assert payload['program_owned']['first_global_shot_requires_reset'] is True
    assert 'source_text' not in payload
    assert payload['output_template']['director']['performance_actions'] == []


def test_partial_continuity_contract_exposes_only_existing_previous_state_fields():
    previous = {
        'characters': {'char_001': {'position': '窗边', 'pose': '站立'}},
        'props': {'prop_001': {'holder_ref': 'char_001'}},
        'environment': {'door_state': 'open'},
    }
    payload = build_director_shot_payload(
        _context(previous), unit_id='director:SH008', is_first_global_shot=False
    )
    continuity = payload['output_contract']['continuity_scope']
    partial = continuity['partial']
    assert continuity['model_shape'] == {'mode': 'reset|inherit|partial', 'inherit_paths': []}
    assert partial['allowed_inherit_fields'] == {
        'characters': {'char_001': ['pose', 'position']},
        'props': {'prop_001': ['holder_ref']},
        'environment': ['door_state'],
    }
    assert partial['allowed_inherit_paths'] == [
        'characters.char_001.pose',
        'characters.char_001.position',
        'props.prop_001.holder_ref',
        'environment.door_state',
    ]
    assert partial['canonical_example'] == {
        'mode': 'partial',
        'inherit': {
            'characters': {'char_001': ['pose']},
            'props': {'prop_001': ['holder_ref']},
            'environment': ['door_state'],
        },
    }


def test_partial_continuity_reports_unknown_refs_and_fields_before_state_resolver():
    previous = {
        'characters': {'char_001': {'position': '窗边'}},
        'props': {'prop_001': {'holder_ref': 'char_001'}},
        'environment': {'door_state': 'open'},
    }
    raw = _director()
    raw['continuity_scope'] = {
        'mode': 'partial',
        'inherit': {
            'characters': {'char_999': ['position'], 'char_001': ['missing_field']},
            'props': {'prop_999': ['holder_ref'], 'prop_001': ['missing_field']},
            'environment': ['missing_field'],
        },
    }
    canonical, _ = canonicalize_director_fragment(
        raw, _context(previous), is_first_global_shot=False
    )
    errors = validate_director_fragment(
        canonical, _context(previous), is_first_global_shot=False
    )
    types = {e['type'] for e in errors}
    assert 'invalid_continuity_character_ref' in types
    assert 'invalid_continuity_character_field' in types
    assert 'invalid_continuity_prop_ref' in types
    assert 'invalid_continuity_prop_field' in types
    assert 'invalid_continuity_environment_field' in types
    assert 'state_resolution_failure' not in types


def test_director_v7_uses_only_current_shot_action_evidence():
    context = _context()
    context["shot"]["description"] = "周迟擦咖啡机并问话。"
    context["shot"]["source_evidence"] = [{"quote": "周迟擦咖啡机并问话。"}]
    context["shot"]["dialogue"] = [{"character_id": "char_001", "line": "上夜班？"}]
    context["production_semantics"]["visual_events"] = [{
        "action": "周迟擦咖啡机并问话。",
        "character_refs": ["char_001"],
        "prop_refs": ["prop_001"],
        "source_evidence": [{"quote": "周迟擦咖啡机并问话。"}],
    }]
    context["production_semantics"]["dialogue"] = [{"character_id": "char_001", "line": "上夜班？", "offscreen": False}]
    context["script_beat"]["description"] = "下一镜女人摇头。"
    payload = build_director_shot_payload(context, unit_id="director:SH001", is_first_global_shot=True)
    assert payload["contract_version"] == "director_shot.v18_0_2"
    assert payload["program_owned"]["current_shot_action_evidence"] == ["周迟擦咖啡机并问话。", "上夜班？"]
    assert payload["output_contract"]["script_beat_role"] == "context_only_not_performance_evidence"
    assert "Context ≠ Evidence" in SYSTEM_PROMPT


def test_director_system_prompt_uses_production_semantics_as_action_authority():
    whitelist_line = next(line for line in SYSTEM_PROMPT.splitlines() if line.startswith("每个 performance_action.source_evidence"))
    assert "production_semantics.visual_events" in whitelist_line
    assert "production_choices" in whitelist_line
    assert "仅由 shot.source_evidence" not in whitelist_line
    assert "script_beat" not in whitelist_line
    assert "audio_events" not in whitelist_line



def test_director_rejects_action_evidence_from_beat_but_not_current_shot():
    context = _context()
    context["script_beat"]["description"] = "女人摇头。"
    raw = _director()
    raw["performance_actions"][0]["action"] = "女人摇头"
    raw["performance_actions"][0]["source_evidence"] = [{"quote": "女人摇头。"}]
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e["type"] == "unanchored_performance_evidence" for e in errors)


def test_director_v10_exposes_program_owned_state_out_and_transient_speaking_contract():
    payload = build_director_shot_payload(
        _context(), unit_id='director:SH014', is_first_global_shot=False
    )
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    # Repair instructions live in the system prompt / repair_instruction and are not
    # resent in every normal high-fanout Director payload.
    assert 'repair_rules' not in payload['output_contract']
    assert 'stale_action_delta' in SYSTEM_PROMPT
    assert 'action_delta' in SYSTEM_PROMPT
    assert payload['output_contract']['transient_state_fields']['characters'] == ['speaking']
    assert 'state_out' in payload['output_contract']['program_owned_fields']
    assert 'state_out' not in payload['output_contract']['model_owned_fields']
    assert 'speaking' in SYSTEM_PROMPT


def test_director_validator_rejects_speaking_as_persistent_delta_and_program_drops_it_from_state_out():
    context = _context()
    raw = _director()
    raw['continuity_scope'] = {'mode': 'reset'}
    raw['action_delta'] = {'characters': {'char_001': {'speaking': '正在说话'}}, 'props': {}, 'environment': {}}
    raw, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(raw, context, is_first_global_shot=True)
    assert any(e['type'] == 'transient_state_in_action_delta' for e in errors)
    assert 'speaking' not in raw['state_out'].get('characters', {}).get('char_001', {})



def test_director_prompt_prefers_chinese_but_allows_authorized_proper_nouns():
    assert "performance_actions.action 以简体中文可执行表演谓词为主" in SYSTEM_PROMPT
    assert "可以在动词之后保留合法动作对象的人名、地名、品牌、型号等专有名词" in SYSTEM_PROMPT


def test_director_rejects_speaking_action_that_restates_dialogue_semantics():
    context = _context()
    context["shot"]["description"] = "年轻人开口询问，另一人回答。"
    context["shot"]["source_evidence"] = [{"quote": "年轻人开口询问，另一人回答。"}]
    context["shot"]["dialogue"] = [
        {"character_id": "char_001", "line": "等多久？"},
    ]
    context["production_semantics"]["dialogue"] = [{"character_id": "char_001", "line": "等多久？", "offscreen": False}]
    context["program_owned"]["allowed_character_refs"] = ["char_001"]
    raw = _director()
    raw["performance_actions"] = [{
        "character_ref": "char_001",
        "action": "问等多久",
        "transformation_type": "visible_state_expression",
        "dependency_tags": ["mouth"],
        "source_evidence": [{"quote": "等多久？"}],
    }]
    raw["primary_subject_refs"] = ["char_001"]
    raw["reaction_target_refs"] = []
    raw["continuity_scope"] = {"mode": "reset"}
    raw["action_delta"] = {"characters": {}, "props": {}, "environment": {}}
    raw["state_out"] = {"characters": {}, "props": {}, "environment": {}}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e["type"] == "director_speech_action_restates_dialogue" for e in errors)


def test_director_does_not_reject_latin_performance_action_on_language_alone():
    raw = _director()
    raw["performance_actions"][0]["action"] = "looks toward the door"
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert not any(e.get("type") == "director_non_chinese_action" for e in errors)


def test_director_does_not_reject_latin_environment_focus_on_language_alone():
    raw = _director()
    raw["visual_focus"]["environment_keys"] = ["glass_window", "窗外天色"]
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert not any(e.get("type") == "director_non_chinese_environment_focus" for e in errors)



def test_director_v14_rejects_chinese_environment_focus_when_upstream_has_no_support():
    raw = _director()
    raw["visual_focus"]["environment_keys"] = ["霓虹广告牌"]
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert any(e["type"] == "director_unanchored_environment_focus" for e in errors)


def test_director_v14_accepts_environment_focus_anchored_in_current_shot_text():
    raw = _director()
    raw["visual_focus"]["environment_keys"] = ["窗边"]
    canonical, _ = canonicalize_director_fragment(raw, _context(), is_first_global_shot=True)
    errors = validate_director_fragment(canonical, _context(), is_first_global_shot=True)
    assert not any(e["type"] == "director_unanchored_environment_focus" for e in errors)


def test_v15_partial_inherit_paths_are_program_converted_to_canonical_scope():
    previous = {
        'characters': {'char_001': {'position': '窗边', 'pose': '站立'}},
        'props': {'prop_001': {'held_by': 'char_001'}},
        'environment': {'door_state': 'open'},
    }
    raw = _director()
    raw['continuity_scope'] = {
        'mode': 'partial',
        'inherit_paths': [
            'characters.char_001.position',
            'props.prop_001.held_by',
            'environment.door_state',
        ],
    }
    canonical, changes = canonicalize_director_fragment(raw, _context(previous), is_first_global_shot=False)
    assert canonical['continuity_scope'] == {
        'mode': 'partial',
        'inherit': {
            'characters': {'char_001': ['position']},
            'props': {'prop_001': ['held_by']},
            'environment': ['door_state'],
        },
    }
    assert changes >= 1
    assert not any(e['type'] == 'shape_type_mismatch' for e in validate_director_fragment(canonical, _context(previous), is_first_global_shot=False))


def test_v15_empty_partial_selection_normalizes_to_reset_instead_of_shape_failure():
    previous = {'characters': {'char_001': {'position': '窗边'}}, 'props': {}, 'environment': {}}
    for scope in (
        {'mode': 'partial', 'inherit_paths': []},
        {'mode': 'partial', 'inherit': []},
        {'mode': 'partial', 'inherit': None},
    ):
        raw = _director()
        raw['continuity_scope'] = copy.deepcopy(scope)
        canonical, _ = canonicalize_director_fragment(raw, _context(previous), is_first_global_shot=False)
        assert canonical['continuity_scope'] == {'mode': 'reset'}
        errors = validate_director_fragment(canonical, _context(previous), is_first_global_shot=False)
        assert not any(e.get('path') == 'director.continuity_scope.inherit' for e in errors)


def test_v15_provider_template_matches_director_envelope_and_flat_continuity_model_shape():
    from runtime.model_schema import provider_json_schema

    payload = build_director_shot_payload(_context(), unit_id='director:SH006', is_first_global_shot=False)
    schema_format = provider_json_schema('director_shot', payload['provider_output_template'])
    schema = schema_format['json_schema']['schema']
    assert schema['required'] == ['director']
    director_schema = schema['properties']['director']
    scope_schema = director_schema['properties']['continuity_scope']
    assert scope_schema['required'] == ['mode', 'inherit_paths']
    assert scope_schema['properties']['inherit_paths']['items']['type'] == 'string'
    assert payload['output_template']['director']['continuity_scope'] == {'mode': 'inherit', 'inherit_paths': []}


def test_v15_provider_schema_requires_complete_performance_action_evidence_item():
    from runtime.model_schema import provider_json_schema

    payload = build_director_shot_payload(_context(), unit_id='director:SH012', is_first_global_shot=False)
    # Prompt-facing template must stay neutral: no fabricated action example.
    assert payload['output_template']['director']['performance_actions'] == []

    schema = provider_json_schema('director_shot', payload['provider_output_template'])['json_schema']['schema']
    actions = schema['properties']['director']['properties']['performance_actions']
    action_item = actions['items']
    assert set(action_item['required']) == {
        'character_ref', 'action', 'transformation_type', 'dependency_tags', 'source_evidence'
    }
    evidence = action_item['properties']['source_evidence']
    assert evidence['minItems'] == 1
    assert evidence['items']['required'] == ['quote']
    assert evidence['items']['properties']['quote']['type'] == 'string'


def test_v15_missing_performance_evidence_exposes_executable_repair_authority():
    context = _context()
    raw = _director()
    raw['performance_actions'][0]['source_evidence'] = []
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    error = next(e for e in errors if e['type'] == 'director_missing_performance_evidence')
    assert error['path'] == 'director.performance_actions[0].source_evidence'
    assert error['target_path'] == 'director.performance_actions[0]'
    assert error['available_current_shot_action_evidence']
    assert 'delete this performance_action' in error['repair_action']
    assert 'director_missing_performance_evidence' in SYSTEM_PROMPT


def test_v16_rejects_precision_body_focus_with_wide_execution_design():
    context = _context()
    raw = _director()
    raw['visual_target'] = {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {
        'focus_type': 'body_region', 'subject_refs': ['char_001'],
        'body_regions': {'char_001': ['hands']}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e['type'] == 'director_shot_size_focus_conflict' for e in errors)


def test_v16_visual_target_can_differ_from_speaker_source():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['shot']['dialogue'] = [{'character_id': 'char_001', 'line': '我只是助理。'}]
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['production_semantics']['dialogue'] = [{'character_id': 'char_001', 'line': '我只是助理。', 'offscreen': False}]
    raw = _director()
    raw['performance_actions'] = []
    raw['primary_subject_refs'] = ['char_001']
    raw['reaction_target_refs'] = []
    raw['visual_target'] = {'target_type': 'character', 'character_refs': ['char_002'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {'focus_type': 'character', 'subject_refs': ['char_002'], 'body_regions': {}, 'prop_refs': [], 'environment_keys': []}
    raw['execution_shot_design'] = {'shot_size': 'close', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert canonical['speaker_target_refs'] == ['char_001']
    assert canonical['visual_target']['character_refs'] == ['char_002']
    assert not any(e['type'] in {'director_visual_target_focus_mismatch', 'speaker_target_mismatch'} for e in errors)


def test_v16_flags_three_consecutive_identical_execution_designs_as_quality_issue():
    context = _context()
    context['program_owned']['recent_shot_designs'] = [
        {'shot_id': 'SH001', 'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static'},
        {'shot_id': 'SH002', 'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static'},
    ]
    raw = _director()
    raw['execution_shot_design'] = {'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=False)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=False)
    assert any(e['type'] == 'director_repeated_execution_design' for e in errors)


def test_v16_payload_exposes_base_and_recent_design_context():
    context = _context()
    context['program_owned']['recent_shot_designs'] = [
        {'shot_id': 'SH000', 'scene_id': 'SC000', 'shot_size': 'close', 'camera': 'low_angle', 'movement': 'push_in'}
    ]
    payload = build_director_shot_payload(context, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['contract_version'] == 'director_shot.v18_0_2'
    assert payload['program_owned']['base_execution_fallback'] == {'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static'}
    assert payload['program_owned']['base_shot_fact_constraints']['required_character_refs'] == ['char_001']
    assert 'base_shot_design' not in payload['program_owned']
    assert payload['program_owned']['recent_shot_designs'][0]['shot_size'] == 'close'
    assert payload['output_contract']['allowed_values']['execution_shot_design.shot_size']


def test_v16_provider_schema_carries_visual_target_and_execution_design_shape():
    from runtime.model_schema import provider_json_schema
    payload = build_director_shot_payload(_context(), unit_id='director:SH020', is_first_global_shot=False)
    schema = provider_json_schema('director_shot', payload['provider_output_template'])['json_schema']['schema']
    director_schema = schema['properties']['director']
    assert 'visual_target' in director_schema['required']
    assert 'execution_shot_design' in director_schema['required']
    design = director_schema['properties']['execution_shot_design']
    assert design['required'] == ['shot_size', 'camera', 'movement']
    target = director_schema['properties']['visual_target']
    assert target['required'] == ['target_type', 'character_refs', 'prop_refs', 'environment_keys']


def test_v16_1_over_shoulder_requires_distinct_foreground_and_visual_target():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    raw = _director()
    raw['performance_actions'] = []
    raw['shot_purpose'] = 'relationship'
    raw['visual_target'] = {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {'focus_type': 'character', 'subject_refs': ['char_001'], 'body_regions': {}, 'prop_refs': [], 'environment_keys': []}
    raw['execution_framing'] = {'framing_type': 'over_shoulder', 'foreground_character_refs': ['char_002']}
    raw['execution_shot_design'] = {'shot_size': 'medium_close', 'camera': 'high_angle', 'movement': 'handheld'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert not any(e['type'] in {'director_over_shoulder_invalid', 'director_over_shoulder_target_conflict', 'director_shot_purpose_framing_conflict'} for e in errors)


def test_v16_1_reaction_purpose_rejects_wide_and_forces_readable_scale():
    context = _context()
    raw = _director()
    raw['performance_actions'] = []
    raw['shot_purpose'] = 'reaction'
    raw['visual_target'] = {'target_type': 'reaction', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {'focus_type': 'reaction', 'subject_refs': ['char_001'], 'body_regions': {'char_001': ['face']}, 'prop_refs': [], 'environment_keys': []}
    raw['execution_framing'] = {'framing_type': 'reaction', 'foreground_character_refs': []}
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert any(e['type'] == 'director_shot_purpose_design_conflict' for e in errors)


def test_v16_1_three_shot_repetition_is_hard_when_target_or_purpose_changes():
    context = _context()
    context['program_owned']['recent_shot_designs'] = [
        {'shot_id': 'SH001', 'scene_id': 'SC001', 'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static', 'shot_purpose': 'speaker', 'visual_target': {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}},
        {'shot_id': 'SH002', 'scene_id': 'SC001', 'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static', 'shot_purpose': 'speaker', 'visual_target': {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}},
    ]
    raw = _director()
    raw['performance_actions'] = []
    raw['shot_purpose'] = 'detail'
    raw['visual_target'] = {'target_type': 'prop', 'character_refs': [], 'prop_refs': ['prop_001'], 'environment_keys': []}
    raw['visual_focus'] = {'focus_type': 'prop', 'subject_refs': [], 'body_regions': {}, 'prop_refs': ['prop_001'], 'environment_keys': []}
    raw['execution_framing'] = {'framing_type': 'detail', 'foreground_character_refs': []}
    raw['execution_shot_design'] = {'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=False)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=False)
    assert any(e['type'] == 'director_repeated_execution_design' for e in errors)


def test_v16_1_payload_exposes_scene_design_summary_for_sequence_level_camera_judgment():
    context = _context()
    context['program_owned']['scene_design_summary'] = {
        'prior_shot_count': 5,
        'shot_size_counts': {'medium_close': 4, 'wide': 1},
        'camera_counts': {'eye_level': 5},
        'movement_counts': {'static': 5},
        'framing_counts': {'single': 4, 'two_shot': 1},
        'purpose_counts': {'speaker': 3, 'relationship': 1, 'establish_space': 1},
    }
    payload = build_director_shot_payload(context, unit_id='director:SH006', is_first_global_shot=False)
    assert payload['program_owned']['scene_design_summary']['prior_shot_count'] == 5
    assert payload['program_owned']['scene_design_summary']['shot_size_counts']['medium_close'] == 4


def test_v16_1_establish_and_detail_purposes_require_decisive_scale_not_generic_medium_close():
    establish_context = _context()
    establish = _director()
    establish['performance_actions'] = []
    establish['shot_purpose'] = 'establish_space'
    establish['visual_target'] = {'target_type': 'environment', 'character_refs': [], 'prop_refs': [], 'environment_keys': ['室内空间']}
    establish['visual_focus'] = {'focus_type': 'environment', 'subject_refs': [], 'body_regions': {}, 'prop_refs': [], 'environment_keys': ['室内空间']}
    establish_context['program_owned']['environment_focus_authority'] = ['室内空间']
    establish['execution_framing'] = {'framing_type': 'environment', 'foreground_character_refs': []}
    establish['execution_shot_design'] = {'shot_size': 'medium', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(establish, establish_context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, establish_context, is_first_global_shot=True)
    assert any(e['type'] == 'director_shot_purpose_design_conflict' for e in errors)

    detail_context = _context()
    detail = _director()
    detail['performance_actions'] = []
    detail['shot_purpose'] = 'detail'
    detail['visual_target'] = {'target_type': 'prop', 'character_refs': [], 'prop_refs': ['prop_001'], 'environment_keys': []}
    detail['visual_focus'] = {'focus_type': 'prop', 'subject_refs': [], 'body_regions': {}, 'prop_refs': ['prop_001'], 'environment_keys': []}
    detail['execution_framing'] = {'framing_type': 'detail', 'foreground_character_refs': []}
    detail['execution_shot_design'] = {'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(detail, detail_context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, detail_context, is_first_global_shot=True)
    assert any(e['type'] == 'director_shot_purpose_design_conflict' for e in errors)


def test_v16_1_shot_size_focus_conflict_exposes_executable_repair_for_precision_focus():
    context = _context()
    raw = _director()
    raw['shot_purpose'] = 'action'
    raw['visual_target'] = {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {
        'focus_type': 'body_region', 'subject_refs': ['char_001'],
        'body_regions': {'char_001': ['hands']}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    error = next(e for e in errors if e['type'] == 'director_shot_size_focus_conflict')
    assert error['path'] == 'director.execution_shot_design.shot_size'
    assert error['repair_action'] == 'change_shot_size_keep_precision_focus'
    assert error['allowed_repair_values'] == ['medium_close', 'close', 'extreme_close']
    assert error['preserve_visual_focus']['body_regions'] == {'char_001': ['hands']}
    assert 'director_shot_size_focus_conflict' in SYSTEM_PROMPT


def test_v16_1_establish_space_focus_conflict_preserves_wide_and_repairs_focus_instead():
    context = _context()
    raw = _director()
    raw['shot_purpose'] = 'establish_space'
    raw['visual_target'] = {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {
        'focus_type': 'body_region', 'subject_refs': ['char_001'],
        'body_regions': {'char_001': ['hands']}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    error = next(e for e in errors if e['type'] == 'director_shot_size_focus_conflict')
    assert error['path'] == 'director.visual_focus'
    assert error['repair_action'] == 'preserve_wide_and_relax_precision_focus'
    assert error['preserve_execution_shot_size'] == 'wide'
    assert error['precision_body_regions'] == ['hands']


def test_v16_1_repair_prompt_supports_legacy_focus_conflict_checkpoint_without_metadata():
    assert '兼容旧 checkpoint' in SYSTEM_PROMPT
    assert '只有 type/detail/path' in SYSTEM_PROMPT
    assert 'repair_instruction.invalid_output.director' in SYSTEM_PROMPT


def test_v17_9_reaction_target_does_not_require_objective_performance_and_scale_still_repairs():
    context = _context()
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['shot']['character_refs'] = ['char_001', 'char_002']
    raw = _director()
    raw['performance_actions'] = []
    raw['reaction_target_refs'] = ['char_001', 'char_002']
    raw['shot_purpose'] = 'reaction'
    raw['visual_target'] = {
        'target_type': 'reaction', 'character_refs': ['char_001', 'char_002'],
        'prop_refs': [], 'environment_keys': [],
    }
    raw['visual_focus'] = {
        'focus_type': 'reaction', 'subject_refs': ['char_001', 'char_002'],
        'body_regions': {}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_framing'] = {'framing_type': 'reaction', 'foreground_character_refs': []}
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)

    assert not any(e['type'] == 'reaction_target_without_performance' for e in errors)
    scale_error = next(
        e for e in errors
        if e['type'] == 'director_shot_purpose_design_conflict'
        and e.get('detail') == 'reaction requires a readable reaction scale'
    )
    assert scale_error['repair_action'] == 'change_shot_size_for_readable_reaction'
    assert scale_error['allowed_repair_values'] == ['medium_close', 'close', 'extreme_close']

def test_v17_9_reaction_target_without_objective_action_evidence_is_valid():
    context = _context()
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['production_semantics']['visual_events'] = [{
        'action': '甲抬眼。',
        'character_refs': ['char_001'],
        'prop_refs': [],
        'source_evidence': [{'quote': '甲抬眼。'}],
    }]
    raw = _director()
    raw['performance_actions'] = []
    raw['reaction_target_refs'] = ['char_002']
    raw['shot_purpose'] = 'reaction'
    raw['visual_target'] = {
        'target_type': 'reaction', 'character_refs': ['char_002'],
        'prop_refs': [], 'environment_keys': [],
    }
    raw['visual_focus'] = {
        'focus_type': 'reaction', 'subject_refs': ['char_002'],
        'body_regions': {}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_framing'] = {'framing_type': 'reaction', 'foreground_character_refs': []}
    raw['execution_shot_design'] = {'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert not any(e['type'] == 'reaction_target_without_performance' for e in errors)
    assert canonical['reaction_target_refs'] == ['char_002']
    assert canonical['performance_actions'] == []

def test_v17_9_payload_exposes_strict_reaction_evidence_as_context_only():
    context = _context()
    context['production_semantics']['visual_events'] = [{
        'action': '甲抬眼。',
        'character_refs': ['char_001'],
        'prop_refs': [],
        'source_evidence': [{'quote': '甲抬眼。'}],
    }]
    payload = build_director_shot_payload(context, unit_id='director:SH001', is_first_global_shot=True)
    assert payload['program_owned']['reaction_performance_evidence_by_character'] == {
        'char_001': ['甲抬眼。']
    }
    assert '不要求同角色必须存在 performance_action' in SYSTEM_PROMPT
    assert '不得为了满足 reaction 镜头而编造动作' in SYSTEM_PROMPT

def test_v16_1_deterministic_stabilizer_preserves_establish_wide_and_relaxes_hands_focus():
    context = _context()
    raw = _director()
    raw['shot_purpose'] = 'establish_space'
    raw['visual_target'] = {'target_type': 'character', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {
        'focus_type': 'body_region', 'subject_refs': ['char_001'],
        'body_regions': {'char_001': ['hands']}, 'prop_refs': [], 'environment_keys': [],
    }
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes >= 1
    assert 'establish_space_focus_relaxed' in applied
    assert stabilized['execution_shot_design']['shot_size'] == 'wide'
    assert stabilized['visual_focus']['body_regions'] == {}
    assert stabilized['visual_focus']['focus_type'] == 'character'
    assert stabilized['visual_focus']['subject_refs'] == ['char_001']
    assert not any(
        e['type'] == 'director_shot_size_focus_conflict'
        for e in validate_director_fragment(stabilized, context, is_first_global_shot=True)
    )


def test_v17_9_stabilizer_preserves_reaction_target_without_inventing_performance():
    context = _context()
    context['program_owned']['allowed_character_refs'] = ['char_001']
    context['shot']['character_refs'] = ['char_001']
    context['production_semantics']['visual_events'] = []
    raw = _director()
    raw['performance_actions'] = []
    raw['reaction_target_refs'] = ['char_001']
    raw['shot_purpose'] = 'reaction'
    raw['visual_target'] = {'target_type': 'reaction', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {'focus_type': 'reaction', 'subject_refs': ['char_001'], 'body_regions': {}, 'prop_refs': [], 'environment_keys': []}
    raw['execution_framing'] = {'framing_type': 'reaction', 'foreground_character_refs': []}
    raw['execution_shot_design'] = {'shot_size': 'medium_close', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 0
    assert applied == []
    assert stabilized['reaction_target_refs'] == ['char_001']
    assert stabilized['performance_actions'] == []
    assert stabilized['shot_purpose'] == 'reaction'
    assert not any(e['type'] == 'reaction_target_without_performance' for e in errors)

def test_v17_9_stabilizer_repairs_reaction_scale_without_synthesizing_performance():
    context = _context()
    context['program_owned']['allowed_character_refs'] = ['char_001']
    context['shot']['character_refs'] = ['char_001']
    context['production_semantics']['visual_events'] = [{
        'action': '阿宁抬眼看向门口。',
        'character_refs': ['char_001'],
        'prop_refs': [],
        'source_evidence': [{'quote': '阿宁抬眼看向门口。'}],
    }]
    raw = _director()
    raw['performance_actions'] = []
    raw['reaction_target_refs'] = ['char_001']
    raw['shot_purpose'] = 'reaction'
    raw['visual_target'] = {'target_type': 'reaction', 'character_refs': ['char_001'], 'prop_refs': [], 'environment_keys': []}
    raw['visual_focus'] = {'focus_type': 'reaction', 'subject_refs': ['char_001'], 'body_regions': {}, 'prop_refs': [], 'environment_keys': []}
    raw['execution_framing'] = {'framing_type': 'reaction', 'foreground_character_refs': []}
    raw['execution_shot_design'] = {'shot_size': 'wide', 'camera': 'eye_level', 'movement': 'static'}
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes >= 1
    assert 'reaction_readable_scale' in applied
    assert stabilized['execution_shot_design']['shot_size'] == 'medium_close'
    assert stabilized['reaction_target_refs'] == ['char_001']
    assert stabilized['performance_actions'] == []
    assert validate_director_fragment(stabilized, context, is_first_global_shot=True) == []

def test_v16_2_known_prop_in_primary_subject_refs_is_precise_and_deterministically_removed():
    context = _context()
    raw = _director()
    raw['primary_subject_refs'] = ['char_001', 'prop_001']
    raw['visual_target'] = {
        'target_type': 'prop',
        'character_refs': [],
        'prop_refs': ['prop_001'],
        'environment_keys': [],
    }
    raw['visual_focus'] = {
        'focus_type': 'prop',
        'subject_refs': [],
        'body_regions': {},
        'prop_refs': ['prop_001'],
        'environment_keys': [],
    }
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    err = next(e for e in errors if e['type'] == 'invalid_primary_subject_ref')
    assert err['path'] == 'director.primary_subject_refs[1]'
    assert err['invalid_ref'] == 'prop_001'
    assert err['repair_action'] == 'remove_prop_from_primary_subject_refs'
    assert err['allowed_character_refs'] == ['char_001']
    assert err['allowed_prop_refs'] == ['prop_001']

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 1
    assert 'prop_removed_from_primary_subject_refs:prop_001' in applied
    assert stabilized['primary_subject_refs'] == ['char_001']
    assert stabilized['visual_target']['prop_refs'] == ['prop_001']
    assert stabilized['visual_focus']['prop_refs'] == ['prop_001']
    assert not any(
        e['type'] == 'invalid_primary_subject_ref'
        for e in validate_director_fragment(stabilized, context, is_first_global_shot=True)
    )


def test_v16_2_unknown_primary_subject_ref_remains_hard_error_and_is_not_silently_dropped():
    context = _context()
    raw = _director()
    raw['primary_subject_refs'] = ['char_missing']
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    err = next(e for e in errors if e['type'] == 'invalid_primary_subject_ref')
    assert err['invalid_ref'] == 'char_missing'
    assert err['repair_action'] == 'replace_or_remove_unknown_primary_subject_ref_without_guessing'

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 0
    assert applied == []
    assert stabilized['primary_subject_refs'] == ['char_missing']


def test_v16_2_e021_evidence_named_subject_rebinds_character_ref_without_model_repair():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['assets']['characters']['char_001']['canonical_name'] = '老周'
    context['assets']['characters']['char_002'] = {
        'character_id': 'char_002',
        'canonical_name': '年轻人',
    }
    quote = '老周抬起头，看向年轻人。'
    context['program_owned']['current_shot_action_evidence'] = [quote]

    raw = _director()
    raw['primary_subject_refs'] = ['char_001', 'char_002']
    raw['performance_actions'][0]['character_ref'] = 'char_002'
    raw['performance_actions'][0]['action'] = '老周抬起头，看向年轻人'
    raw['performance_actions'][0]['source_evidence'] = [{'quote': quote}]

    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    err = next(e for e in errors if e['type'] == 'director_performance_subject_mismatch')
    assert err['repair_action'] == 'rebind_character_ref_to_evidence_subject'
    assert err['evidence_subject_ref'] == 'char_001'
    assert err['repair_targets'] == ['director.performance_actions[0].character_ref']

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 1
    assert stabilized['performance_actions'][0]['character_ref'] == 'char_001'
    assert stabilized['performance_actions'][0]['action'] == '老周抬起头，看向年轻人'
    assert 'performance_subject_rebound_to_evidence:0:char_001' in applied
    assert not any(
        e['type'] == 'director_performance_subject_mismatch'
        for e in validate_director_fragment(stabilized, context, is_first_global_shot=True)
    )


def test_v17_9_e021_ambiguous_pronoun_keeps_valid_structured_owner_and_never_spends_model_repair():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['assets']['characters']['char_001']['canonical_name'] = '老周'
    context['assets']['characters']['char_002'] = {
        'character_id': 'char_002',
        'canonical_name': '年轻人',
    }
    quote = '他抬起头，看向对面。'
    context['program_owned']['current_shot_action_evidence'] = [quote]

    raw = _director()
    raw['primary_subject_refs'] = ['char_001', 'char_002']
    raw['performance_actions'][0]['character_ref'] = 'char_002'
    raw['performance_actions'][0]['action'] = '老周抬起头，看向年轻人'
    raw['performance_actions'][0]['source_evidence'] = [{'quote': quote}]

    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    err = next(e for e in errors if e['type'] == 'director_performance_subject_mismatch')
    assert err['repair_action'] == 'strip_redundant_action_subject_prefix'
    assert err['repair_targets'] == ['director.performance_actions[0].action']

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 1
    assert stabilized['performance_actions'][0]['character_ref'] == 'char_002'
    assert stabilized['performance_actions'][0]['action'] == '抬起头，看向年轻人'
    assert 'performance_subject_prefix_stripped:0' in applied

    recanonical, _ = canonicalize_director_fragment(stabilized, context, is_first_global_shot=True)
    assert not any(
        e['type'] == 'director_performance_subject_mismatch'
        for e in validate_director_fragment(recanonical, context, is_first_global_shot=True)
    )


def test_v17_9_subject_rebind_does_not_force_reaction_target_performance_or_second_repair():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['assets']['characters']['char_001']['canonical_name'] = '老周'
    context['assets']['characters']['char_002'] = {'character_id': 'char_002', 'canonical_name': '年轻人'}
    quote = '过了几分钟，老周忽然开口：“一个朋友的。”'
    context['program_owned']['current_shot_action_evidence'] = [quote]
    context['production_semantics']['visual_events'] = [{
        'action': '老周忽然开口。',
        'character_refs': ['char_001', 'char_002'],
        'prop_refs': [],
        'source_evidence': [{'quote': quote}],
    }]
    payload = build_director_shot_payload(context, unit_id='director:SH011', is_first_global_shot=True)
    assert payload['program_owned']['reaction_performance_evidence_by_character'] == {
        'char_001': [quote]
    }

    raw = _director()
    raw['primary_subject_refs'] = ['char_001', 'char_002']
    raw['reaction_target_refs'] = ['char_002']
    raw['performance_actions'] = [{
        'character_ref': 'char_002',
        'action': '老周忽然开口',
        'transformation_type': 'visible_state_expression',
        'dependency_tags': [],
        'source_evidence': [{'quote': quote}],
    }]

    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    mismatch = next(e for e in errors if e['type'] == 'director_performance_subject_mismatch')
    assert mismatch['evidence_subject_ref'] == 'char_001'
    assert mismatch['repair_action'] == 'rebind_character_ref_to_evidence_subject'

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 1
    assert 'performance_subject_rebound_to_evidence:0:char_001' in applied
    assert stabilized['performance_actions'][0]['character_ref'] == 'char_001'
    assert stabilized['reaction_target_refs'] == ['char_002']

    final_errors = validate_director_fragment(stabilized, context, is_first_global_shot=True)
    assert not any(e['type'] == 'director_performance_subject_mismatch' for e in final_errors)
    assert not any(e['type'] == 'reaction_target_without_performance' for e in final_errors)


def test_v16_2_dialogue_wrapper_evidence_reanchors_to_exact_current_shot_dialogue_without_repair():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['assets']['characters']['char_002'] = {
        'character_id': 'char_002',
        'canonical_name': '年轻人',
    }
    context['production_semantics']['visual_events'] = []
    context['production_semantics']['production_choices'] = []
    context['production_semantics']['dialogue'] = [
        {'character_id': 'char_002', 'line': '后来呢？', 'offscreen': False},
    ]
    context['shot']['dialogue'] = [
        {'character_id': 'char_002', 'line': '后来呢？'},
    ]
    context['program_owned']['current_shot_action_evidence'] = ['后来呢？']

    raw = _director()
    raw['primary_subject_refs'] = ['char_002']
    raw['performance_actions'][0]['character_ref'] = 'char_002'
    raw['performance_actions'][0]['action'] = '年轻人抬眼后开口询问'
    raw['performance_actions'][0]['source_evidence'] = [{'quote': '年轻人问后来呢。'}]

    canonical, changes = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    assert changes >= 1
    assert canonical['performance_actions'][0]['source_evidence'] == [{'quote': '后来呢？'}]
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert not any(e['type'] == 'unanchored_performance_evidence' for e in errors)


def test_v16_2_unanchored_performance_evidence_exposes_exact_repair_authority_when_not_mechanically_reanchorable():
    context = _context()
    context['program_owned']['current_shot_action_evidence'] = ['老周抬起头。']
    raw = _director()
    raw['performance_actions'][0]['source_evidence'] = [{'quote': '完全不存在的概括句。'}]
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    error = next(e for e in errors if e['type'] == 'unanchored_performance_evidence')
    assert error['path'] == 'director.performance_actions[0].source_evidence'
    assert error['repair_targets'] == [
        'director.performance_actions[0].source_evidence',
        'director.performance_actions[0].action',
    ]
    assert error['must_change_any_of_paths'] == ['director.performance_actions[0].source_evidence']
    assert error['available_current_shot_action_evidence'] == ['老周抬起头。']


def test_v17_3_e021_uses_structured_production_semantics_owner_when_quote_itself_is_ambiguous():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_003']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_003']
    context['assets']['characters']['char_001']['canonical_name'] = '老周'
    context['assets']['characters']['char_003'] = {'character_id': 'char_003', 'canonical_name': '朋友'}
    quote = '新来的住户不认识他，只知道门口有个修鞋的老头，不爱说话，但鞋修得结实，五块钱一双，从不涨价。'
    context['program_owned']['current_shot_action_evidence'] = [quote]
    context['production_semantics']['visual_events'] = [{
        'action': '老周坐在修鞋摊前，新住户从旁经过。',
        'character_refs': ['char_001'],
        'prop_refs': [],
        'source_evidence': [{'quote': quote}],
    }]

    raw = _director()
    raw['primary_subject_refs'] = ['char_001']
    raw['performance_actions'][0]['character_ref'] = 'char_003'
    raw['performance_actions'][0]['action'] = '老周坐在摊前，目光保持在手上的活计'
    raw['performance_actions'][0]['source_evidence'] = [{'quote': quote}]

    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    err = next(e for e in errors if e['type'] == 'director_performance_subject_mismatch')
    assert err['repair_action'] == 'rebind_character_ref_to_evidence_subject'
    assert err['evidence_subject_ref'] == 'char_001'
    assert err['semantic_evidence_subject_refs'] == ['char_001']

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 1
    assert stabilized['performance_actions'][0]['character_ref'] == 'char_001'
    assert 'performance_subject_rebound_to_evidence:0:char_001' in applied
    assert not any(e['type'] == 'director_performance_subject_mismatch' for e in validate_director_fragment(stabilized, context, is_first_global_shot=True))


def test_v17_9_director_err_helper_calls_never_exceed_declared_positional_arity():
    source = inspect.getsource(director_stage)
    tree = ast.parse(source)
    bad = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == '_err':
            if len(node.args) > 2:
                bad.append((node.lineno, len(node.args)))
    assert bad == []


def test_v17_9_performance_budget_warning_does_not_crash_validation():
    context = _context()
    raw = _director()
    raw['performance_execution'] = [{
        'character_ref': 'char_001',
        'expression': '嘴角轻微收紧并很快恢复' * 40,
    }]
    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    warning = next(e for e in errors if e.get('type') == 'director_performance_budget_high')
    assert warning['code'] == 'W015_PERFORMANCE_BUDGET_HIGH'
    assert warning['path'] == 'director.performance_execution'


def test_v17_9_action_owner_is_structural_and_same_owner_name_is_canonicalized_to_predicate():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['assets']['characters']['char_001']['canonical_name'] = '甲'
    context['assets']['characters']['char_002'] = {'character_id': 'char_002', 'canonical_name': '乙'}

    raw = _director()
    raw['primary_subject_refs'] = ['char_001']
    raw['performance_actions'][0]['character_ref'] = 'char_001'
    raw['performance_actions'][0]['action'] = '甲缓慢地抬头看向乙'

    canonical, changes = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    assert changes >= 1
    assert canonical['performance_actions'][0]['character_ref'] == 'char_001'
    assert canonical['performance_actions'][0]['action'] == '缓慢地抬头看向乙'


def test_v17_9_e021_multi_candidate_evidence_strips_conflicting_subject_without_model_repair():
    context = _context()
    context['shot']['character_refs'] = ['char_001', 'char_002']
    context['program_owned']['allowed_character_refs'] = ['char_001', 'char_002']
    context['assets']['characters']['char_001']['canonical_name'] = '甲'
    context['assets']['characters']['char_002'] = {'character_id': 'char_002', 'canonical_name': '乙'}
    quote = '后来他走进隔壁的门面。'
    context['program_owned']['current_shot_action_evidence'] = [quote]
    context['production_semantics']['visual_events'] = [{
        'action': '后来他走进隔壁的门面。',
        'character_refs': ['char_001', 'char_002'],
        'prop_refs': [],
        'source_evidence': [{'quote': quote}],
    }]

    raw = _director()
    raw['primary_subject_refs'] = ['char_001', 'char_002']
    raw['performance_actions'][0]['character_ref'] = 'char_002'
    raw['performance_actions'][0]['action'] = '甲走进隔壁的门面'
    raw['performance_actions'][0]['source_evidence'] = [{'quote': quote}]

    canonical, _ = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    err = next(e for e in errors if e['type'] == 'director_performance_subject_mismatch')
    assert err['semantic_evidence_subject_refs'] == ['char_001', 'char_002']
    assert err['evidence_candidate_subject_refs'] == ['char_001', 'char_002']
    assert err['repair_action'] == 'strip_redundant_action_subject_prefix'
    assert err['repair_targets'] == ['director.performance_actions[0].action']

    stabilized, changes, applied = stabilize_director_contract_conflicts(canonical, errors, context)
    assert changes == 1
    assert stabilized['performance_actions'][0]['character_ref'] == 'char_002'
    assert stabilized['performance_actions'][0]['action'] == '走进隔壁的门面'
    assert 'performance_subject_prefix_stripped:0' in applied

    recanonical, _ = canonicalize_director_fragment(stabilized, context, is_first_global_shot=True)
    final_errors = validate_director_fragment(recanonical, context, is_first_global_shot=True)
    assert not any(e['type'] == 'director_performance_subject_mismatch' for e in final_errors)


def test_v17_9_optional_director_enrichment_is_fail_soft_before_validation():
    context = _context()
    context['shot']['dialogue'] = [{'character_id': 'char_001', 'line': '知道了。'}]
    context['shot']['frozen_text_unit_refs'] = {'dialogue': ['ftu_001']}
    raw = _director()
    raw['performance_logic'] = [{
        'character_ref': 'char_missing',
        'base_emotion': '紧张',
        'emotion_delta': '',
        'trigger': '',
        'behavior_goal': '',
        'behavior_tendency': '',
        'evidence_source': [],
    }]
    raw['performance_execution'] = [{
        'character_ref': 'char_missing',
        'expression': '皱眉', 'gaze': '', 'breathing': '', 'body': '', 'hands': '',
        'movement': '', 'micro_reaction': '', 'action_transition': '', 'end_state': '',
    }]
    raw['dialogue_delivery'] = [
        {
            'frozen_text_unit_id': 'ftu_001', 'speaker_ref': 'char_missing',
            'emotion': '', 'volume': '', 'pace': '', 'pause': '', 'delivery': '', 'gaze_during_line': '',
        },
        {
            'frozen_text_unit_id': 'ftu_001', 'speaker_ref': 'char_001',
            'emotion': '平静', 'volume': '', 'pace': '', 'pause': '', 'delivery': '', 'gaze_during_line': '',
        },
        {
            'frozen_text_unit_id': 'ftu_missing', 'speaker_ref': 'char_001',
            'emotion': '', 'volume': '', 'pace': '', 'pause': '', 'delivery': '', 'gaze_during_line': '',
        },
    ]

    canonical, changes = canonicalize_director_fragment(raw, context, is_first_global_shot=True)
    assert changes >= 4
    assert canonical['performance_logic'] == []
    assert canonical['performance_execution'] == []
    assert len(canonical['dialogue_delivery']) == 1
    assert canonical['dialogue_delivery'][0]['frozen_text_unit_id'] == 'ftu_001'
    assert canonical['dialogue_delivery'][0]['speaker_ref'] == 'char_001'
    errors = validate_director_fragment(canonical, context, is_first_global_shot=True)
    assert not any(e['type'] in {
        'director_invalid_performance_logic_character_ref',
        'director_invalid_performance_execution_character_ref',
        'director_dialogue_delivery_unknown_frozen_unit',
        'director_dialogue_delivery_speaker_mismatch',
        'director_dialogue_delivery_duplicate',
    } for e in errors)


def test_v17_9_camera_design_coherence_is_quality_not_core_blocker():
    assert {
        'director_shot_purpose_design_conflict',
        'director_shot_purpose_framing_conflict',
        'director_over_shoulder_invalid',
        'director_over_shoulder_target_conflict',
        'director_two_shot_invalid',
        'director_framing_design_conflict',
        'director_framing_target_conflict',
        'director_shot_size_focus_conflict',
        'director_visual_target_focus_mismatch',
    }.issubset(director_stage.SOFT_QUALITY_ERROR_TYPES)

from __future__ import annotations

from typing import Any, Dict, Iterable, List

TRANSFORMATION_TYPES = {
    'physical_sequence_expansion',
    'visible_state_expression',
    'temporal_order_expansion',
}
DEPENDENCY_TAGS = {
    'face', 'eyes', 'mouth', 'head', 'neck',
    'upper_body', 'lower_body', 'hands', 'feet',
    'wardrobe_interaction', 'prop_interaction',
    'spatial_interaction', 'body_detail',
}
FOCUS_TYPES = {
    'character', 'body_region', 'prop',
    'spatial_relation', 'environment', 'reaction',
}
BODY_REGIONS = {
    'face', 'eyes', 'mouth', 'head', 'neck',
    'upper_body', 'lower_body', 'hands', 'feet',
}
CONTINUITY_MODES = {'inherit', 'partial', 'reset'}

STATIC_ASSET_STATE_KEYS = {
    'age_appearance', 'face', 'hair', 'body', 'skin',
    'wardrobe', 'default', 'outerwear', 'shirt', 'footwear', 'accessory',
    'space', 'layout', 'materials', 'lighting', 'color', 'weather',
    'visual_reference',
}

DIRECTOR_OUTPUT_SCHEMA_V1_3A = {
    'type': 'object',
    'additionalProperties': False,
    'required': [
        'dramatic_intent', 'primary_subject_refs', 'speaker_target_refs',
        'reaction_target_refs', 'performance_actions', 'visual_focus',
        'action_delta', 'state_out', 'continuity_scope',
    ],
    'properties': {
        'dramatic_intent': {'type': 'string'},
        'primary_subject_refs': {'type': 'array', 'items': {'type': 'string'}},
        'speaker_target_refs': {'type': 'array', 'items': {'type': 'string'}},
        'reaction_target_refs': {'type': 'array', 'items': {'type': 'string'}},
        'performance_actions': {'type': 'array'},
        'visual_focus': {'type': 'object'},
        'action_delta': {'type': 'object'},
        'state_out': {'type': 'object'},
        'continuity_scope': {'type': 'object'},
    },
}

FORBIDDEN_PERFORMANCE_MODIFIERS = {
    '缓慢', '迅速', '突然', '猛地', '犹豫', '坚定', '小心翼翼',
    '轻轻', '用力', '深情', '复杂', '愤怒', '羞愧', '难过',
    '心动', '暧昧', '颤抖', '收紧',
}

REQUIRED_DIRECTOR_FIELDS = {
    'dramatic_intent',
    'primary_subject_refs',
    'speaker_target_refs',
    'reaction_target_refs',
    'performance_actions',
    'visual_focus',
    'action_delta',
    'state_out',
    'continuity_scope',
}
FORBIDDEN_DIRECTOR_PROMPT_FIELDS = {'image_prompt', 'video_prompt', 'platform_prompt'}


DIRECTOR_SYSTEM_PROMPT_V1_3A = '''你是 Prompt Foundry v1.3 的影视分镜导演执行层。\n你只做导演执行决策，不创建新的叙事事实。\n所有角色、场景、道具只能使用既有稳定 ID。\n每个镜头必须输出 director：dramatic_intent、primary_subject_refs、speaker_target_refs、reaction_target_refs、performance_actions、visual_focus、action_delta、state_out、continuity_scope。\nstate_in 由程序计算，禁止输出。\nperformance_actions 只能把原文已支持的动作做最小物理展开、可见状态表达或时间顺序显式化；禁止新增情绪结论、速度/力度判断、表情、身体反应或新动作。\n不得生成 image_prompt、video_prompt 或 platform_prompt。'''

DIRECTOR_CONSTRAINTS_V1_3A = [
    '不得新增剧情、对白、人物关系、角色、道具、地点或 narrative context',
    'primary_subject_refs / reaction_target_refs 只能引用当前 Shot.character_refs',
    'speaker_target_refs 必须与当前 Shot 对白说话者集合一致，允许说话者离屏',
    'performance_actions 必须逐角色绑定 stable character_id，并携带 transformation_type、dependency_tags、source_evidence',
    'state_out 只保存下一镜需要继承的动态状态；不得复制 Story Bible/PVB/PSB 静态资产',
    'continuity_scope.partial 必须显式列出继承字段',
    'Validator 只检查，不修复、不补字段',
]


def _error(errors: List[dict], etype: str, shot_id: str, detail: str) -> None:
    errors.append({'type': etype, 'shot_id': shot_id, 'detail': detail})


def _speaker_refs_from_shot(shot: dict) -> List[str]:
    refs: List[str] = []
    for item in shot.get('dialogue', []) or []:
        ref = item.get('character_id')
        if ref and ref not in refs:
            refs.append(ref)
    return refs


def _script_beat_map(script: dict) -> Dict[tuple, dict]:
    out: Dict[tuple, dict] = {}
    for scene in script.get('scenes', []) or []:
        scene_id = scene.get('scene_id')
        for beat in scene.get('beats', []) or []:
            out[(scene_id, beat.get('beat_id'))] = beat
    return out


def _valid_state_map(value: Any) -> bool:
    if not isinstance(value, dict):
        return False
    for key in ('characters', 'props', 'environment'):
        if key not in value or not isinstance(value.get(key), dict):
            return False
    return True


def _dialogue_pair_set(items: Iterable[dict]) -> set[tuple]:
    return {
        (item.get('character_id'), item.get('line'))
        for item in (items or [])
        if item.get('character_id') and item.get('line') is not None
    }


def _validate_state_refs(
    errors: List[dict],
    shot_id: str,
    state_name: str,
    state: dict,
    story_char_refs: set,
    story_prop_refs: set,
) -> None:
    for ref in (state.get('characters', {}) or {}):
        if ref not in story_char_refs:
            _error(errors, f'invalid_{state_name}_character_ref', shot_id, f'unknown character ref in {state_name}: {ref}')
    for ref in (state.get('props', {}) or {}):
        if ref not in story_prop_refs:
            _error(errors, f'invalid_{state_name}_prop_ref', shot_id, f'unknown prop ref in {state_name}: {ref}')


def _static_asset_keys(value: Any) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, child in value.items():
            if key in STATIC_ASSET_STATE_KEYS:
                found.add(key)
            found.update(_static_asset_keys(child))
    elif isinstance(value, list):
        for child in value:
            found.update(_static_asset_keys(child))
    return found


def validate_storyboard_director_v1_3a(story_bible: dict, script: dict, storyboard: dict) -> Dict[str, Any]:
    errors: List[dict] = []
    beat_map = _script_beat_map(script)
    story_char_refs = {item.get('character_id') for item in story_bible.get('characters', []) or []}
    story_prop_refs = {item.get('prop_id') for item in story_bible.get('props', []) or []}

    for scene in storyboard.get('scenes', []) or []:
        for shot in scene.get('shots', []) or []:
            shot_id = shot.get('shot_id', '')
            director = shot.get('director')
            if not isinstance(director, dict):
                _error(errors, 'missing_director', shot_id, 'shot.director is required in v1.3-A')
                continue

            missing_fields = sorted(REQUIRED_DIRECTOR_FIELDS - set(director))
            for field in missing_fields:
                _error(errors, 'missing_director_field', shot_id, f'missing director field: {field}')

            for field in sorted(FORBIDDEN_DIRECTOR_PROMPT_FIELDS & set(director)):
                _error(errors, 'forbidden_director_prompt_field', shot_id, f'Director must not emit {field}')

            if not isinstance(director.get('dramatic_intent'), str) or not director.get('dramatic_intent', '').strip():
                _error(errors, 'invalid_dramatic_intent', shot_id, 'dramatic_intent must be a non-empty string')

            shot_chars = set(shot.get('character_refs', []) or [])
            for ref in director.get('primary_subject_refs', []) or []:
                if ref not in shot_chars:
                    _error(errors, 'invalid_primary_subject_ref', shot_id, f'{ref} is not in shot.character_refs')

            expected_speakers = _speaker_refs_from_shot(shot)
            actual_speakers = director.get('speaker_target_refs', []) or []
            if set(actual_speakers) != set(expected_speakers):
                _error(
                    errors,
                    'speaker_target_mismatch',
                    shot_id,
                    f'expected speakers {expected_speakers}, got {actual_speakers}',
                )
            for ref in actual_speakers:
                if ref not in story_char_refs:
                    _error(errors, 'invalid_speaker_target_ref', shot_id, f'unknown speaker ref: {ref}')

            beat = beat_map.get((scene.get('scene_id'), shot.get('beat_id')))
            if beat is None:
                _error(errors, 'missing_script_beat', shot_id, 'shot scene_id/beat_id not found in Script')
            else:
                allowed_pairs = _dialogue_pair_set(beat.get('dialogue', []))
                for pair in _dialogue_pair_set(shot.get('dialogue', [])):
                    if pair not in allowed_pairs:
                        _error(
                            errors,
                            'speaker_ownership_mismatch',
                            shot_id,
                            f'shot dialogue pair not owned by Script beat: {pair}',
                        )

            reaction_refs = list(director.get('reaction_target_refs', []) or [])
            for ref in reaction_refs:
                if ref not in shot_chars:
                    _error(errors, 'invalid_reaction_target_ref', shot_id, f'{ref} is not in shot.character_refs')
            performance_refs = {
                item.get('character_ref')
                for item in (director.get('performance_actions', []) or [])
                if isinstance(item, dict) and item.get('character_ref')
            }
            for ref in reaction_refs:
                if ref in shot_chars and ref not in performance_refs:
                    _error(
                        errors,
                        'reaction_target_without_performance',
                        shot_id,
                        f'reaction target {ref} requires a same-character performance_action',
                    )

            if 'state_in' in director:
                _error(errors, 'director_owns_no_state_in', shot_id, 'state_in is program-owned and must not be emitted by Director')

            shot_props = set(shot.get('prop_refs', []) or [])
            focus = director.get('visual_focus', {}) or {}
            focus_type = focus.get('focus_type')
            if focus_type not in FOCUS_TYPES:
                _error(errors, 'invalid_visual_focus_type', shot_id, f'unsupported focus_type: {focus_type}')
            for ref in focus.get('subject_refs', []) or []:
                if ref not in shot_chars:
                    _error(errors, 'invalid_visual_focus_subject_ref', shot_id, f'{ref} is not in shot.character_refs')
            for ref in focus.get('prop_refs', []) or []:
                if ref not in shot_props:
                    _error(errors, 'invalid_visual_focus_prop_ref', shot_id, f'{ref} is not in shot.prop_refs')
            for ref, regions in (focus.get('body_regions', {}) or {}).items():
                if ref not in shot_chars:
                    _error(errors, 'invalid_visual_focus_subject_ref', shot_id, f'{ref} body_regions target is not in shot.character_refs')
                for region in regions or []:
                    if region not in BODY_REGIONS:
                        _error(errors, 'invalid_visual_focus_body_region', shot_id, f'unsupported body region: {region}')

            action_delta = director.get('action_delta')
            if not _valid_state_map(action_delta):
                _error(errors, 'invalid_action_delta_structure', shot_id, 'action_delta must contain dict characters/props/environment maps')
            else:
                _validate_state_refs(errors, shot_id, 'action_delta', action_delta, story_char_refs, story_prop_refs)

            state_out = director.get('state_out')
            if not _valid_state_map(state_out):
                _error(errors, 'invalid_state_out_structure', shot_id, 'state_out must contain dict characters/props/environment maps')
            else:
                _validate_state_refs(errors, shot_id, 'state_out', state_out, story_char_refs, story_prop_refs)
                leaked = sorted(_static_asset_keys(state_out))
                if leaked:
                    _error(
                        errors,
                        'static_asset_leak_in_state_out',
                        shot_id,
                        'state_out must contain dynamic persistent state only; static asset key(s): ' + ', '.join(leaked),
                    )

            scope = director.get('continuity_scope', {}) or {}
            mode = scope.get('mode')
            if mode not in CONTINUITY_MODES:
                _error(errors, 'invalid_continuity_mode', shot_id, f'unsupported continuity mode: {mode}')
            if mode == 'partial':
                inherit = scope.get('inherit')
                if not isinstance(inherit, dict):
                    _error(errors, 'invalid_partial_continuity_scope', shot_id, 'partial continuity requires explicit inherit map')
                else:
                    chars = {item.get('character_id') for item in story_bible.get('characters', []) or []}
                    props = {item.get('prop_id') for item in story_bible.get('props', []) or []}
                    for ref, fields in (inherit.get('characters', {}) or {}).items():
                        if ref not in chars:
                            _error(errors, 'invalid_continuity_character_ref', shot_id, f'unknown character ref in continuity scope: {ref}')
                        if not isinstance(fields, list) or not fields or not all(isinstance(x, str) and x for x in fields):
                            _error(errors, 'invalid_partial_continuity_scope', shot_id, f'character continuity fields for {ref} must be a non-empty-string list')
                    for ref, fields in (inherit.get('props', {}) or {}).items():
                        if ref not in props:
                            _error(errors, 'invalid_continuity_prop_ref', shot_id, f'unknown prop ref in continuity scope: {ref}')
                        if not isinstance(fields, list) or not fields or not all(isinstance(x, str) and x for x in fields):
                            _error(errors, 'invalid_partial_continuity_scope', shot_id, f'prop continuity fields for {ref} must be a non-empty-string list')
                    env = inherit.get('environment', [])
                    if not isinstance(env, list) or not all(isinstance(x, str) and x for x in env):
                        _error(errors, 'invalid_partial_continuity_scope', shot_id, 'environment continuity fields must be a string list')

            for perf in director.get('performance_actions', []) or []:
                ref = perf.get('character_ref')
                if ref not in shot_chars:
                    _error(errors, 'invalid_performance_character_ref', shot_id, f'{ref} is not in shot.character_refs')

                transform = perf.get('transformation_type')
                if transform not in TRANSFORMATION_TYPES:
                    _error(errors, 'invalid_transformation_type', shot_id, f'unsupported transformation_type: {transform}')

                for tag in perf.get('dependency_tags', []) or []:
                    if tag not in DEPENDENCY_TAGS:
                        _error(errors, 'invalid_dependency_tag', shot_id, f'unsupported dependency_tag: {tag}')

                evidence = perf.get('source_evidence', []) or []
                quotes = [str(item.get('quote', '')).strip() for item in evidence if isinstance(item, dict)]
                quotes = [q for q in quotes if q]
                if not quotes:
                    _error(errors, 'missing_performance_evidence', shot_id, 'performance action requires non-empty source_evidence.quote')

                action_text = str(perf.get('action', ''))
                evidence_text = ' '.join(quotes)
                unsupported = [term for term in FORBIDDEN_PERFORMANCE_MODIFIERS if term in action_text and term not in evidence_text]
                if unsupported:
                    _error(
                        errors,
                        'unsupported_performance_modifier',
                        shot_id,
                        'unsupported modifier(s) not present in evidence: ' + ', '.join(sorted(unsupported)),
                    )

    return {'passed': not errors, 'errors': errors}

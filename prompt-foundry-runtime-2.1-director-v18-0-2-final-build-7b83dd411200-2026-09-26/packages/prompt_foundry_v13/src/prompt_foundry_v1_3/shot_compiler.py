from __future__ import annotations

from typing import Any, Dict, List

from . import asset_compilers as _base

BODY_TAGS = {'face', 'eyes', 'mouth', 'head', 'neck', 'upper_body', 'lower_body', 'hands', 'feet'}
BODY_REGION_FIELD_MAP = _base.CHARACTER_FIELD_REGIONS
CHARACTER_FIELD_MATRIX = _base.CHARACTER_FIELD_MATRIX
SCENE_FIELD_MATRIX = _base.SCENE_FIELD_MATRIX
PSB_FIELDS = _base.PSB_FIELDS

DEFAULT_REGIONS_BY_SHOT_SIZE = {
    'extreme_close': {'face', 'head'},
    'close': {'face', 'head', 'upper_body'},
    'medium_close': {'face', 'head', 'upper_body', 'hands'},
    'medium': {'face', 'head', 'upper_body', 'lower_body', 'hands'},
    'wide': {'face', 'head', 'upper_body', 'lower_body', 'full_body', 'hands', 'feet'},
    'extreme_wide': {'full_body'},
}

BODY_REGION_LABELS = {
    'face': '脸部', 'eyes': '眼部', 'mouth': '嘴部', 'head': '头部', 'neck': '颈部',
    'upper_body': '上半身', 'lower_body': '下半身', 'hands': '手部', 'feet': '脚部', 'full_body': '全身',
}
STATE_FIELD_LABELS = {
    'position': '位置', 'held_prop_refs': '手持道具', 'body_state': '身体状态',
    'holder_ref': '持有人', 'state': '状态', 'stove_state': '灶台状态',
}


def _find(items: List[dict], key: str, value: str) -> dict | None:
    for item in items or []:
        if item.get(key) == value:
            return item
    return None


def _char_name(sb: dict, cid: str) -> str:
    item = _find(sb.get('characters', []), 'character_id', cid)
    return (item or {}).get('canonical_name') or cid


def _prop_name(sb: dict, pid: str) -> str:
    item = _find(sb.get('props', []), 'prop_id', pid)
    return (item or {}).get('canonical_name') or (item or {}).get('name') or pid


def _segment(segment_id: str, segment_type: str, text: str, sources: List[dict]) -> dict:
    return {'segment_id': segment_id, 'segment_type': segment_type, 'text': text, 'sources': sources}


def _field_visible(field: str, regions: set[str]) -> bool:
    return bool(BODY_REGION_FIELD_MAP.get(field, set()) & regions)


def _character_execution(shot: dict, cid: str) -> tuple[set[str], set[str], bool]:
    director = shot.get('director') or {}
    focus = director.get('visual_focus') or {}
    explicit = set((focus.get('body_regions') or {}).get(cid, []) or [])
    deps: set[str] = set()
    has_performance = False
    for item in director.get('performance_actions', []) or []:
        if item.get('character_ref') != cid:
            continue
        has_performance = True
        deps.update(item.get('dependency_tags', []) or [])
    regions_from_deps = deps & BODY_TAGS
    regions = explicit | regions_from_deps
    active = (
        cid in set(director.get('primary_subject_refs', []) or [])
        or cid in set(director.get('reaction_target_refs', []) or [])
        or has_performance
        or cid in set(focus.get('subject_refs', []) or [])
    )
    if not regions:
        regions = set(DEFAULT_REGIONS_BY_SHOT_SIZE.get(shot.get('shot_size'), {'face', 'head', 'upper_body'}))
    return regions, deps, active


def _select_character_fields(values: dict, shot: dict, cid: str) -> List[str]:
    shot_size = shot.get('shot_size') or 'medium'
    regions, deps, active = _character_execution(shot, cid)
    ordered = list(CHARACTER_FIELD_MATRIX.get(shot_size, CHARACTER_FIELD_MATRIX['medium']))
    selected = [f for f in ordered if values.get(f) and _field_visible(f, regions)]

    # Skin is not a generic hand/feet identity anchor in v1.3. It requires an
    # explicit same-character body_detail dependency.
    if 'body_detail' not in deps:
        selected = [f for f in selected if f != 'skin']

    forced: List[str] = []
    if 'body_detail' in deps and values.get('skin') and _field_visible('skin', regions):
        forced.append('skin')
    if 'wardrobe_interaction' in deps:
        for field in ('wardrobe.outerwear', 'wardrobe.shirt', 'wardrobe.default', 'wardrobe.accessory'):
            if values.get(field) and _field_visible(field, regions):
                forced.append(field)
                break

    merged: List[str] = []
    for field in forced + selected:
        if field not in merged:
            merged.append(field)
    return merged[:3] if active else merged[:1]


def select_shot_consumption_v1_3(
    shot: dict, sb: dict, pvb: dict, psb: dict, style_guide: dict,
    mode: str = 'production'
) -> dict:
    """Derive per-shot consumption from structured Director execution data only."""
    director = shot.get('director')
    if not isinstance(director, dict):
        raise ValueError('ShotSpec v1.3 requires director')
    if not isinstance(shot.get('state_in'), dict):
        raise ValueError('ShotSpec v1.3 requires program-owned state_in')

    warnings: List[dict] = []
    chars: Dict[str, dict] = {}
    resolved_refs = {'scene': shot.get('location_ref'), 'characters': [], 'props': []}

    for cid in shot.get('character_refs', []) or []:
        char = _base.find_sb_char(sb, cid)
        if not char:
            warnings.append({'type': 'invalid_character_ref', 'character_id': cid, 'detail': 'character_refs 引用了不存在的角色。'})
            continue
        resolved_refs['characters'].append(cid)
        role = char.get('role_type')
        if role in {'main', 'supporting'}:
            full = _base.resolve_character_visuals(sb, pvb, cid, mode)
            selected = _select_character_fields(full, shot, cid)
            chars[cid] = {
                'canonical_name': char.get('canonical_name', cid),
                'role_type': role,
                'selected_fields': selected,
                'values': {f: full[f] for f in selected if f in full},
                'sources': {f: _base._character_visual_source(sb, pvb, cid, f) for f in selected if f in full},
            }
        else:
            chars[cid] = {
                'canonical_name': char.get('canonical_name', cid), 'role_type': role,
                'selected_fields': [], 'values': {}, 'sources': {},
            }

    scene_id = shot.get('location_ref')
    scene = _base.find_sb_scene(sb, scene_id)
    scene_visuals = _base.resolve_scene_visuals(sb, psb, scene_id, mode) if scene else {}
    if not scene:
        warnings.append({'type': 'invalid_scene_ref', 'scene_id': scene_id, 'detail': 'location_ref 引用了不存在的场景。'})

    selected_scene_fields = set(SCENE_FIELD_MATRIX.get(shot.get('shot_size') or 'medium', SCENE_FIELD_MATRIX['medium']))
    all_deps: set[str] = set()
    for item in director.get('performance_actions', []) or []:
        all_deps.update(item.get('dependency_tags', []) or [])
    focus_type = (director.get('visual_focus') or {}).get('focus_type')
    if 'spatial_interaction' in all_deps or focus_type == 'spatial_relation':
        selected_scene_fields.update({'space', 'layout', 'environment'})
    if focus_type == 'environment':
        selected_scene_fields.update(PSB_FIELDS)

    scene_values = {f: scene_visuals[f] for f in PSB_FIELDS if f in selected_scene_fields and scene_visuals.get(f)}
    story_facts = _base._selected_story_scene_facts(scene_visuals, selected_scene_fields)
    scene_sources = {f: {'source': 'psb', 'source_ref': f'scenes[{scene_id}].production_visual.{f}'} for f in scene_values}
    story_sources = {k: {'source': 'story_bible', 'source_ref': f"scenes[{scene_id}].visual_lock.{k.split('.',1)[1]}"} for k in story_facts}

    props = []
    for pid in shot.get('prop_refs', []) or []:
        prop = _base.find_sb_prop(sb, pid)
        if not prop:
            warnings.append({'type': 'invalid_prop_ref', 'prop_id': pid, 'detail': 'prop_refs 引用了不存在的道具。'})
            continue
        resolved_refs['props'].append(pid)
        if prop.get('visual_presence') == 'present' and prop.get('visual_asset_required') is True:
            props.append({
                'prop_id': pid,
                'name': prop.get('canonical_name') or prop.get('name') or pid,
                'source': {'source': 'story_bible', 'source_ref': f'props[{pid}]'},
            })

    style = _base._style_values(style_guide, mode)
    return {
        'selector_version': '1.3',
        'shot_id': shot.get('shot_id'),
        'characters': chars,
        'scene': {
            'scene_id': scene_id,
            'selected_fields': [f for f in PSB_FIELDS if f in selected_scene_fields],
            'production_visual': scene_values,
            'story_facts': story_facts,
            'sources': {**scene_sources, **story_sources},
        },
        'props': props,
        'style': style,
        'style_sources': {k: {'source': 'style_guide', 'source_ref': f'style_guide.{k}'} for k in style},
        'resolved_refs': resolved_refs,
        'warnings': warnings,
    }


def _render_value(value: Any, sb: dict) -> str:
    if isinstance(value, list):
        rendered = []
        for item in value:
            if isinstance(item, str) and item.startswith('prop_'):
                rendered.append(_prop_name(sb, item))
            else:
                rendered.append(str(item))
        return '、'.join(rendered)
    if isinstance(value, str) and value.startswith('char_'):
        return _char_name(sb, value)
    if isinstance(value, str) and value.startswith('prop_'):
        return _prop_name(sb, value)
    return str(value)


def _render_state(state: dict, sb: dict) -> str:
    parts: List[str] = []
    for cid, fields in (state.get('characters', {}) or {}).items():
        vals = [f"{STATE_FIELD_LABELS.get(k, k.replace('_', ' '))}：{_render_value(v, sb)}" for k, v in fields.items()]
        if vals:
            parts.append(f"{_char_name(sb, cid)}（{'，'.join(vals)}）")
    for pid, fields in (state.get('props', {}) or {}).items():
        vals = [f"{STATE_FIELD_LABELS.get(k, k.replace('_', ' '))}：{_render_value(v, sb)}" for k, v in fields.items()]
        if vals:
            parts.append(f"{_prop_name(sb, pid)}（{'，'.join(vals)}）")
    for key, value in (state.get('environment', {}) or {}).items():
        parts.append(f"{STATE_FIELD_LABELS.get(key, key.replace('_', ' '))}：{_render_value(value, sb)}")
    return '；'.join(parts)


def _render_focus(focus: dict, sb: dict) -> str:
    parts: List[str] = []
    subjects = [_char_name(sb, cid) for cid in focus.get('subject_refs', []) or []]
    if subjects:
        parts.append('主体：' + '、'.join(subjects))
    for cid, regions in (focus.get('body_regions', {}) or {}).items():
        labels = [BODY_REGION_LABELS.get(r, r) for r in regions or []]
        if labels:
            parts.append(f"{_char_name(sb, cid)}：{'、'.join(labels)}")
    props = [_prop_name(sb, pid) for pid in focus.get('prop_refs', []) or []]
    if props:
        parts.append('道具：' + '、'.join(props))
    env = focus.get('environment_keys', []) or []
    if env:
        parts.append('环境：' + '、'.join(env))
    return '；'.join(parts)


def compile_shot_prompt_v1_3(
    shot: dict, sb: dict, pvb: dict, psb: dict, style_guide: dict,
    mode: str = 'production', aspect_ratio: str = '9:16'
) -> dict:
    view = select_shot_consumption_v1_3(shot, sb, pvb, psb, style_guide, mode)
    director = shot['director']
    sid = shot.get('shot_id')
    scene_id = shot.get('location_ref')
    scene = _base.find_sb_scene(sb, scene_id) or {}
    scene_name = scene.get('canonical_name') or scene.get('name') or scene_id or ''
    scene_time = scene.get('time') or ''
    segments: List[dict] = []

    header = f"{shot.get('duration', '')}秒，{aspect_ratio}竖屏，{scene_name}" + (f"，{scene_time}" if scene_time else '') + '。'
    segments.append(_segment(f'{sid}.header', 'camera', header, [
        {'source': 'shotspec', 'source_ref': f'shots[{sid}].duration'},
        {'source': 'story_bible', 'source_ref': f'scenes[{scene_id}].name'},
    ]))

    camera = (
        f"镜头：\n{_base.SHOT_SIZE_MAP.get(shot.get('shot_size'), shot.get('shot_size', ''))}，"
        f"{_base.CAMERA_MAP.get(shot.get('camera'), shot.get('camera', ''))}，"
        f"{_base.MOVEMENT_MAP.get(shot.get('movement'), shot.get('movement', ''))}"
    )
    comp = (shot.get('composition') or '').strip().rstrip('。；，,. ')
    if comp:
        camera += f'；构图：{comp}'
    camera += '。'
    segments.append(_segment(f'{sid}.camera', 'camera', camera, [
        {'source': 'shotspec', 'source_ref': f'shots[{sid}].shot_size'},
        {'source': 'shotspec', 'source_ref': f'shots[{sid}].camera'},
        {'source': 'shotspec', 'source_ref': f'shots[{sid}].movement'},
        {'source': 'shotspec', 'source_ref': f'shots[{sid}].composition'},
    ]))

    subject_parts: List[str] = []
    subject_sources: List[dict] = []
    for cid in shot.get('character_refs', []) or []:
        c = view['characters'].get(cid)
        if not c:
            continue
        vals = [str(c['values'][f]) for f in c['selected_fields'] if c['values'].get(f)]
        subject_parts.append('，'.join([c['canonical_name']] + vals) if vals else c['canonical_name'])
        subject_sources.append({'source': 'story_bible', 'source_ref': f'characters[{cid}].canonical_name'})
        subject_sources.extend(c['sources'].values())
    if view['props']:
        subject_parts.append('可见道具：' + '、'.join(p['name'] for p in view['props']))
        subject_sources.extend(p['source'] for p in view['props'])
    if subject_parts:
        segments.append(_segment(f'{sid}.subjects', 'character_visual', '主体：\n' + '；'.join(subject_parts) + '。', subject_sources))

    state_text = _render_state(shot.get('state_in') or {}, sb)
    if state_text:
        segments.append(_segment(f'{sid}.state_in', 'state', '当前状态：\n' + state_text + '。', [
            {'source': 'state_resolver', 'source_ref': f'shots[{sid}].state_in'}
        ]))

    description = (shot.get('description') or '').strip()
    if description:
        segments.append(_segment(f'{sid}.action', 'action', '本镜动作：\n' + description, [
            {'source': 'shotspec', 'source_ref': f'shots[{sid}].description'}
        ]))

    performance_parts = []
    performance_sources = []
    for idx, item in enumerate(director.get('performance_actions', []) or []):
        performance_parts.append(f"{_char_name(sb, item.get('character_ref'))}：{item.get('action', '')}")
        performance_sources.append({'source': 'director', 'source_ref': f'shots[{sid}].director.performance_actions[{idx}]'})
    if performance_parts:
        segments.append(_segment(f'{sid}.performance', 'performance', '人物表演：\n' + '；'.join(performance_parts) + '。', performance_sources))

    focus_text = _render_focus(director.get('visual_focus') or {}, sb)
    if focus_text:
        segments.append(_segment(f'{sid}.focus', 'visual_focus', '视觉重点：\n' + focus_text + '。', [
            {'source': 'director', 'source_ref': f'shots[{sid}].director.visual_focus'}
        ]))

    delta_text = _render_state(director.get('action_delta') or {}, sb)
    if delta_text:
        segments.append(_segment(f'{sid}.delta', 'state', '本镜变化：\n' + delta_text + '。', [
            {'source': 'director', 'source_ref': f'shots[{sid}].director.action_delta'}
        ]))

    rendered_dialogue = []
    dialogue_sources = []
    for idx, item in enumerate(shot.get('dialogue') or []):
        speaker = item.get('character_name') or _char_name(sb, item.get('character_id', ''))
        line = item.get('line') or item.get('text') or ''
        if line:
            rendered_dialogue.append(f'{speaker}说：“{line}”')
            dialogue_sources.append({'source': 'shotspec', 'source_ref': f'shots[{sid}].dialogue[{idx}]'})
    if rendered_dialogue:
        segments.append(_segment(f'{sid}.dialogue', 'dialogue', '对白：\n' + '；'.join(rendered_dialogue) + '。', dialogue_sources))

    scene_parts = []
    scene_sources = []
    story_subset = view['scene']['story_facts']
    non_lighting_story = {
        k: v for k, v in story_subset.items()
        if _base.STORY_SCENE_FACT_GROUP.get(k.split('.', 1)[1]) != 'lighting'
    }
    if non_lighting_story:
        hard = _base._format_story_scene_facts(non_lighting_story)
        if hard:
            scene_parts.append(hard)
            scene_sources.extend(view['scene']['sources'][k] for k in non_lighting_story)
    for field in ('space', 'layout', 'materials', 'environment'):
        value = view['scene']['production_visual'].get(field)
        if value:
            scene_parts.append(str(value)); scene_sources.append(view['scene']['sources'][field])
    if scene_parts:
        segments.append(_segment(f'{sid}.scene', 'scene_visual', '场景环境：\n' + '；'.join(scene_parts) + '。', scene_sources))

    light_parts = []
    light_sources = []
    for key, value in story_subset.items():
        if _base.STORY_SCENE_FACT_GROUP.get(key.split('.', 1)[1]) == 'lighting':
            light_parts.append(str(value))
            light_sources.append(view['scene']['sources'][key])
    for field in ('lighting', 'color'):
        value = view['scene']['production_visual'].get(field)
        if value:
            light_parts.append(str(value)); light_sources.append(view['scene']['sources'][field])
    if light_parts:
        segments.append(_segment(f'{sid}.lighting', 'scene_visual', '光影色调：\n' + '；'.join(light_parts) + '。', light_sources))

    style_parts = [view['style'][k] for k in ('genre', 'tone', 'visual_reference') if view['style'].get(k)]
    if style_parts:
        segments.append(_segment(f'{sid}.style', 'style', '视觉风格与画质：\n' + '；'.join(style_parts) + '。', [
            view['style_sources'][k] for k in ('genre', 'tone', 'visual_reference') if k in view['style_sources']
        ]))

    if shot.get('continuity', {}).get('continuous_with_previous') or state_text:
        parts = ['与上一镜保持已声明的动态状态连续']
        axis = (shot.get('continuity') or {}).get('axis_side')
        if axis and axis != 'neutral':
            parts.append(f'保持当前轴线侧：{axis}')
        segments.append(_segment(f'{sid}.continuity', 'continuity', '连续性：\n' + '；'.join(parts) + '。', [
            {'source': 'shotspec', 'source_ref': f'shots[{sid}].continuity'},
            {'source': 'state_resolver', 'source_ref': f'shots[{sid}].state_in'},
        ]))

    segments.append(_segment(f'{sid}.constraints', 'platform_constraint',
        '平台约束：\n动作按时间顺序连续可见；人物表演只使用上面已经声明的可见动作；单镜头只保留一个主运镜；不得新增人物、剧情事件、对白、表情、身体反应、字幕、水印或无依据的可阅读文字。',
        [{'source': 'platform_constraint', 'source_ref': 'seedance.single_shot.v1.3'}]
    ))

    prompt = '\n\n'.join(seg['text'] for seg in segments if seg.get('text'))
    return {
        'shot_id': sid,
        'scene_id': shot.get('scene_id'),
        'context_ref': shot.get('context_ref', ''),
        'beat_id': shot.get('beat_id'),
        'prompt_seedance': prompt,
        'prompt_segments': segments,
        'consumption_view': view,
        'resolved_refs': view['resolved_refs'],
        'resolved_visuals': {cid: data['values'] for cid, data in view['characters'].items()},
        'warnings': view['warnings'],
    }


def compile_project_v1_3(
    project_id: str, sb: dict, pvb: dict, psb: dict, style_guide: dict,
    shots: List[dict], mode: str = 'production'
) -> dict:
    """Keep v1.1 Character/Scene compilation and use v1.3 only for Shot compilation."""
    character_prompts = []
    scene_prompts = []
    shot_prompts = []
    warnings = []
    compile_failures = []

    for char in sb.get('characters', []) or []:
        if char.get('role_type') not in {'main', 'supporting'}:
            continue
        cid = char.get('character_id')
        try:
            character_prompts.append(_base.compile_character_prompt(sb, pvb, style_guide, cid, mode))
        except Exception as exc:
            compile_failures.append({'target_type': 'character', 'target_id': cid, 'detail': str(exc)})

    for scene in sb.get('scenes', []) or []:
        scene_id = scene.get('scene_id')
        try:
            result = _base.compile_scene_prompt(sb, psb, style_guide, scene_id, mode)
            scene_prompts.append(result)
            warnings.extend(result.get('warnings', []))
        except Exception as exc:
            compile_failures.append({'target_type': 'scene', 'target_id': scene_id, 'detail': str(exc)})

    for shot in shots:
        shot_id = shot.get('shot_id')
        try:
            result = compile_shot_prompt_v1_3(shot, sb, pvb, psb, style_guide, mode)
            shot_prompts.append(result)
            warnings.extend(result.get('warnings', []))
        except Exception as exc:
            compile_failures.append({'target_type': 'shot', 'target_id': shot_id, 'detail': str(exc)})

    return {
        'project_id': project_id,
        'mode': mode,
        'character_prompts': character_prompts,
        'scene_prompts': scene_prompts,
        'shot_prompts': shot_prompts,
        'warnings': warnings,
        'compile_failures': compile_failures,
    }

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional

PVB_VISUAL_FIELDS = ('age_appearance', 'face', 'hair', 'body', 'skin')

PVB_WARDROBE_FIELDS = ('default', 'outerwear', 'shirt', 'footwear', 'accessory')

PSB_FIELDS = ('space', 'layout', 'materials', 'lighting', 'color', 'environment')

SHOT_SIZE_MAP = {'extreme_wide': '大远景', 'wide': '广角全景', 'medium': '中景', 'medium_close': '中近景', 'close': '近景', 'extreme_close': '特写'}

CAMERA_MAP = {'eye_level': '平视机位', 'high_angle': '高角度俯拍', 'low_angle': '低角度仰拍', 'overhead': '顶视机位', 'dutch': '斜角机位', 'pov': '主观视角'}

MOVEMENT_MAP = {'static': '固定镜头', 'pan': '横摇', 'tilt': '纵摇', 'dolly': '移动镜头', 'truck': '平移', 'crane': '升降', 'handheld': '手持镜头', 'zoom': '变焦', 'push_in': '缓慢推近', 'pull_out': '缓慢拉远'}

def _find(items: Iterable[dict], id_key: str, value: str) -> Optional[dict]:
    for item in items or []:
        if item.get(id_key) == value:
            return item
    return None

def find_sb_char(sb: dict, char_id: str) -> Optional[dict]:
    return _find(sb.get('characters', []), 'character_id', char_id)

def find_sb_scene(sb: dict, scene_id: str) -> Optional[dict]:
    return _find(sb.get('scenes', []), 'scene_id', scene_id)

def find_sb_prop(sb: dict, prop_id: str) -> Optional[dict]:
    return _find(sb.get('props', []), 'prop_id', prop_id)

def find_pvb_char(pvb: dict, char_id: str) -> Optional[dict]:
    return _find(pvb.get('characters', []), 'character_id', char_id)

def find_psb_scene(psb: dict, scene_id: str) -> Optional[dict]:
    return _find(psb.get('scenes', []), 'scene_id', scene_id)

def _entry_consumable(entry: Optional[dict], mode: str) -> bool:
    if not entry:
        return False
    status = entry.get('status')
    if status == 'locked':
        return True
    return mode == 'preview' and status == 'confirmed'

def _pvb_entry(char: dict, field_path: str) -> Optional[dict]:
    if field_path.startswith('wardrobe.'):
        return char.get('wardrobe', {}).get(field_path.split('.', 1)[1])
    return char.get('visual_identity', {}).get(field_path)

def _story_visual_value(sb_char: dict, field_path: str) -> Optional[Any]:
    key = field_path.split('.', 1)[1] if field_path.startswith('wardrobe.') else field_path
    value = sb_char.get('visual_lock', {}).get(key)
    return value if value not in (None, '') else None

def resolve_character_visuals(sb: dict, pvb: dict, char_id: str, mode: str='production') -> Dict[str, Any]:
    sb_char = find_sb_char(sb, char_id)
    if not sb_char:
        return {}
    pvb_char = find_pvb_char(pvb, char_id)
    field_paths = list(PVB_VISUAL_FIELDS) + [f'wardrobe.{x}' for x in PVB_WARDROBE_FIELDS]
    out: Dict[str, Any] = {}
    for field in field_paths:
        hard = _story_visual_value(sb_char, field)
        if hard is not None:
            out[field] = hard
            continue
        if not pvb_char:
            continue
        entry = _pvb_entry(pvb_char, field)
        if not entry or entry.get('status') == 'skipped':
            continue
        if _entry_consumable(entry, mode):
            value = entry.get('value')
            if value not in (None, ''):
                out[field] = value
    return out

def _style_values(style_guide: dict, mode: str='production') -> Dict[str, str]:
    out = {}
    for key in ('era', 'region', 'genre', 'tone', 'visual_reference'):
        entry = (style_guide or {}).get(key)
        if entry and _entry_consumable(entry, mode) and entry.get('value'):
            out[key] = entry['value']
    return out

def _compact_subject_traits(values: Dict[str, Any], max_items: int=3) -> List[str]:
    priority = ('hair', 'face', 'wardrobe.outerwear', 'wardrobe.default', 'wardrobe.shirt', 'body', 'age_appearance')
    result = []
    for key in priority:
        if values.get(key):
            result.append(str(values[key]))
        if len(result) >= max_items:
            break
    return result

def _format_story_scene_facts(scene_visuals: Dict[str, Any]) -> str:
    labels = {'key_area': '主要区域', 'market_state': '环境状态', 'building_type': '建筑类型', 'elevator': '电梯', 'lighting': '光照事实', 'layout': '空间布局', 'condition': '环境状态', 'chair_count': '椅子数量', 'size': '空间大小', 'fixed_elements': '固定元素', 'outside_light': '外部光线', 'table': '桌子'}
    vals = []
    for key, value in scene_visuals.items():
        if not key.startswith('story.'):
            continue
        raw_key = key.split('.', 1)[1]
        if isinstance(value, list):
            value = '、'.join(map(str, value))
        vals.append(f'{labels.get(raw_key, raw_key)}：{value}')
    return '；'.join(vals)

def compile_character_prompt(sb: dict, pvb: dict, style_guide: dict, char_id: str, mode: str='production') -> dict:
    sb_char = find_sb_char(sb, char_id)
    if not sb_char:
        raise ValueError(f'invalid character_id: {char_id}')
    role = sb_char.get('role_type')
    if role not in {'main', 'supporting'}:
        raise ValueError(f'{char_id} role_type={role} does not require Character Prompt')
    visuals = resolve_character_visuals(sb, pvb, char_id, mode)
    style = _style_values(style_guide, mode)
    if not visuals:
        raise ValueError(f'{char_id} has no consumable visual data in mode={mode}')
    identity = [visuals[k] for k in PVB_VISUAL_FIELDS if k in visuals]
    wardrobe = [visuals[f'wardrobe.{k}'] for k in PVB_WARDROBE_FIELDS if f'wardrobe.{k}' in visuals]
    style_parts = [style[k] for k in ('era', 'genre', 'tone', 'visual_reference') if style.get(k)]
    sections = [f"角色：{sb_char['canonical_name']}"]
    if identity:
        sections.append('主体：\n' + '；'.join(map(str, identity)) + '。')
    if wardrobe:
        sections.append('服装：\n' + '；'.join(map(str, wardrobe)) + '。')
    if style_parts:
        sections.append('风格：\n' + '；'.join(style_parts) + '。')
    sections.append('约束：\n保持写实、自然的人物比例与真实材质；不得新增剧情动作、人物关系或身份信息；不得使用未锁定的视觉候选；避免网红脸、过度妆容、过度磨皮和无依据的奢华造型。')
    return {'character_id': char_id, 'canonical_name': sb_char['canonical_name'], 'prompt_gpt_image': '\n\n'.join(sections)}

def compile_scene_prompt(sb: dict, psb: dict, style_guide: dict, scene_id: str, mode: str='production') -> dict:
    scene = find_sb_scene(sb, scene_id)
    if not scene:
        raise ValueError(f'invalid scene_id: {scene_id}')
    visuals = resolve_scene_visuals(sb, psb, scene_id, mode)
    style = _style_values(style_guide, mode)
    env = [visuals[k] for k in ('space', 'layout', 'materials', 'environment') if visuals.get(k)]
    hard = _format_story_scene_facts(visuals)
    if hard:
        env.insert(0, hard)
    light = [visuals[k] for k in ('lighting', 'color') if visuals.get(k)]
    style_parts = [style[k] for k in ('era', 'region', 'genre', 'tone', 'visual_reference') if style.get(k)]
    scene_name = scene.get('canonical_name') or scene.get('name') or scene_id
    warnings = []
    has_production_visual = any((visuals.get(k) for k in PSB_FIELDS))
    if not has_production_visual:
        warnings.append({'type': 'missing_scene_visual', 'scene_id': scene_id, 'detail': f'{scene_id} 缺少当前 {mode} mode 可消费的 Production Scene Bible 视觉数据。'})
    sections = [f'场景：{scene_name}']
    if env:
        sections.append('环境：\n' + '；'.join(map(str, env)) + '。')
    if light:
        sections.append('光影：\n' + '；'.join(map(str, light)) + '。')
    if style_parts:
        sections.append('风格：\n' + '；'.join(style_parts) + '。')
    sections.append('约束：\n不得新增人物、剧情事件或剧情关键道具；不得改变 Story Bible 已确定的空间、时间和环境事实；不添加无依据的品牌、Logo、招牌文案或可阅读文字；避免商业广告式过度精修和不符合故事环境的奢华布景。')
    return {'scene_id': scene_id, 'scene_name': scene_name, 'prompt_gpt_image': '\n\n'.join(sections), 'warnings': warnings}

CHARACTER_FIELD_MATRIX = {'extreme_close': ('face', 'hair', 'skin', 'wardrobe.accessory'), 'close': ('face', 'hair', 'skin', 'wardrobe.outerwear', 'wardrobe.shirt', 'wardrobe.accessory'), 'medium_close': ('face', 'hair', 'wardrobe.outerwear', 'wardrobe.shirt', 'body', 'skin', 'wardrobe.accessory'), 'medium': ('hair', 'body', 'wardrobe.outerwear', 'wardrobe.shirt', 'face', 'wardrobe.accessory'), 'wide': ('body', 'wardrobe.outerwear', 'wardrobe.default', 'wardrobe.footwear', 'hair', 'face'), 'extreme_wide': ('body', 'wardrobe.outerwear', 'wardrobe.default', 'wardrobe.footwear', 'hair')}

SCENE_FIELD_MATRIX = {'extreme_close': ('lighting', 'color'), 'close': ('lighting', 'color'), 'medium_close': ('layout', 'lighting', 'color'), 'medium': ('space', 'layout', 'lighting', 'color', 'environment'), 'wide': ('space', 'layout', 'materials', 'lighting', 'color', 'environment'), 'extreme_wide': ('space', 'layout', 'materials', 'lighting', 'color', 'environment')}

STORY_SCENE_FACT_GROUP = {'key_area': 'layout', 'market_state': 'environment', 'building_type': 'space', 'elevator': 'space', 'lighting': 'lighting', 'layout': 'layout', 'condition': 'environment', 'chair_count': 'layout', 'size': 'space', 'fixed_elements': 'layout', 'outside_light': 'lighting', 'table': 'layout'}

CHARACTER_FIELD_REGIONS = {'age_appearance': {'face', 'head', 'upper_body', 'full_body'}, 'face': {'face', 'head', 'upper_body', 'full_body'}, 'hair': {'head', 'face', 'upper_body', 'full_body'}, 'body': {'upper_body', 'lower_body', 'full_body'}, 'skin': {'face', 'head', 'neck', 'upper_body', 'lower_body', 'full_body', 'hands', 'feet'}, 'wardrobe.default': {'upper_body', 'lower_body', 'full_body'}, 'wardrobe.outerwear': {'upper_body', 'full_body'}, 'wardrobe.shirt': {'upper_body', 'full_body'}, 'wardrobe.footwear': {'lower_body', 'full_body', 'feet'}, 'wardrobe.accessory': {'face', 'head', 'upper_body', 'full_body', 'hands'}}

def _character_visual_source(sb: dict, pvb: dict, char_id: str, field_path: str) -> dict:
    sb_char = find_sb_char(sb, char_id) or {}
    key = field_path.split('.', 1)[1] if field_path.startswith('wardrobe.') else field_path
    if (sb_char.get('visual_lock') or {}).get(key) not in (None, ''):
        return {'source': 'story_bible', 'source_ref': f'characters[{char_id}].visual_lock.{key}'}
    return {'source': 'pvb', 'source_ref': f'characters[{char_id}].{field_path}'}

def _selected_story_scene_facts(scene_visuals: dict, selected_scene_fields: set[str]) -> dict:
    out = {}
    for key, value in scene_visuals.items():
        if not key.startswith('story.'):
            continue
        raw = key.split('.', 1)[1]
        group = STORY_SCENE_FACT_GROUP.get(raw)
        if group in selected_scene_fields:
            out[key] = value
    return out
def resolve_scene_visuals(sb: dict, psb: dict, scene_id: str, mode: str = "production") -> Dict[str, Any]:
    """Resolve scene visuals with Story Bible > PSB authority collision guard."""
    scene = find_sb_scene(sb, scene_id)
    if not scene:
        return {}
    out: Dict[str, Any] = {}
    story_lock = scene.get("visual_lock", {}) or {}
    for key, value in story_lock.items():
        if value not in (None, "", [], {}):
            out[f"story.{key}"] = value
    psb_scene = find_psb_scene(psb, scene_id)
    if not psb_scene:
        return out
    production = psb_scene.get("production_visual", {}) or {}
    for field in PSB_FIELDS:
        if story_lock.get(field) not in (None, "", [], {}):
            continue
        entry = production.get(field)
        if not entry or entry.get("status") == "skipped":
            continue
        if _entry_consumable(entry, mode):
            value = entry.get("value")
            if value not in (None, ""):
                out[field] = value
    return out

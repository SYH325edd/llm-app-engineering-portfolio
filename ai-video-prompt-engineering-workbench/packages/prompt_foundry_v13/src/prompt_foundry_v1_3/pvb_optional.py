from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

OPTIONAL_ABSENT = 'optional_absent'
OPTIONAL_ABSENT_FIELDS = {'wardrobe.accessory'}
NON_CONSUMING_STATUSES = {'skipped', OPTIONAL_ABSENT}
VALID_STATUSES_V1_3D = {'candidate', 'confirmed', 'locked', 'skipped', OPTIONAL_ABSENT}

PSEUDO_ACCESSORY_PATTERNS = (
    '无明显装饰性配饰',
    '无明显配饰',
    '无固定醒目配饰',
    '无固定配饰',
    '无特殊配饰',
    '没有明显配饰',
)

PVB_GENERATOR_OPTIONAL_RULES_V1_3D = [
    'wardrobe.accessory 是可选生产字段。',
    '若 Story Bible 已明确 accessory，则该字段必须 status=skipped，value/source 为空。',
    '若 Story Bible 未规定 accessory，且角色视觉生产不需要固定配饰，则输出 status=optional_absent，value/source 为空。',
    '不得为了字段完整性生成“无明显装饰性配饰”“无固定醒目配饰”等伪内容。',
    '若确有生产上必须固定的具体配饰，则仍输出 candidate，并给出具体可视值。',
    'v1.3-D 只把 wardrobe.accessory 定义为 optional_absent；其他字段语义保持原契约。',
]


def _find(items: Iterable[dict], key: str, value: str) -> Optional[dict]:
    for item in items or []:
        if item.get(key) == value:
            return item
    return None


def _error(errors: List[dict], etype: str, character_id: str, field: str, detail: str) -> None:
    errors.append({
        'type': etype,
        'character_id': character_id,
        'field': field,
        'detail': detail,
    })


def aggregate_pvb_status_v1_3d(entries: List[dict]) -> str:
    consuming = [e for e in entries if e.get('status') not in NON_CONSUMING_STATUSES]
    if not consuming:
        return 'locked'
    statuses = [e.get('status') for e in consuming]
    if all(s == 'locked' for s in statuses):
        return 'locked'
    if all(s in {'confirmed', 'locked'} for s in statuses) and any(s == 'confirmed' for s in statuses):
        return 'confirmed'
    return 'candidate'


def entry_consumable_v1_3d(entry: Optional[dict], mode: str) -> bool:
    if not entry:
        return False
    status = entry.get('status')
    if status in NON_CONSUMING_STATUSES:
        return False
    if status == 'locked':
        return True
    return mode == 'preview' and status == 'confirmed'


def _iter_entries(char: dict):
    for section in ('visual_identity', 'wardrobe'):
        for key, value in (char.get(section) or {}).items():
            yield f'{section}.{key}', value


def _story_visual_value(sb_char: Optional[dict], field_path: str) -> Any:
    if not sb_char:
        return None
    key = field_path.split('.', 1)[1] if field_path.startswith('wardrobe.') else field_path
    value = (sb_char.get('visual_lock') or {}).get(key)
    return value if value not in (None, '', [], {}) else None


def validate_pvb_optional_semantics_v1_3d(story_bible: dict, pvb: dict) -> Dict[str, Any]:
    errors: List[dict] = []
    sb_chars = story_bible.get('characters', []) or []

    for char in pvb.get('characters', []) or []:
        character_id = char.get('character_id', '')
        sb_char = _find(sb_chars, 'character_id', character_id)

        for field_path, entry in _iter_entries(char):
            if not isinstance(entry, dict):
                _error(errors, 'invalid_pvb_entry', character_id, field_path, 'PVB field entry must be an object')
                continue

            status = entry.get('status')
            if status not in VALID_STATUSES_V1_3D:
                _error(errors, 'invalid_pvb_status', character_id, field_path, f'unsupported status: {status}')
                continue

            story_value = _story_visual_value(sb_char, field_path)
            if story_value is not None and status != 'skipped':
                _error(
                    errors,
                    'story_owned_field_must_be_skipped',
                    character_id,
                    field_path,
                    'Story Bible already owns this visual field; PVB must use skipped.',
                )

            if status == OPTIONAL_ABSENT:
                if field_path not in OPTIONAL_ABSENT_FIELDS:
                    _error(
                        errors,
                        'optional_absent_not_allowed',
                        character_id,
                        field_path,
                        'optional_absent is not allowed for this field in v1.3-D.',
                    )
                if entry.get('value') not in (None, '') or entry.get('source') not in (None, ''):
                    _error(
                        errors,
                        'invalid_optional_absent_payload',
                        character_id,
                        field_path,
                        'optional_absent requires empty value and source.',
                    )

            if field_path == 'wardrobe.accessory' and status in {'candidate', 'confirmed', 'locked'}:
                text = str(entry.get('value') or '').strip()
                if any(pattern in text for pattern in PSEUDO_ACCESSORY_PATTERNS):
                    _error(
                        errors,
                        'pseudo_content_accessory',
                        character_id,
                        field_path,
                        'Accessory field contains absence wording; use optional_absent instead of pseudo-content.',
                    )

    return {'passed': not errors, 'errors': errors}


def recompute_pvb_character_status_v1_3d(char: dict) -> str:
    entries = [entry for _, entry in _iter_entries(char)]
    char['status'] = aggregate_pvb_status_v1_3d(entries)
    return char['status']


def _review_log_v1_3d(pvb: dict, reviewer: str, target: str, action: str, old_status: str, new_status: str, note: str = '') -> None:
    pvb.setdefault('review_log', []).append({
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'reviewer': reviewer,
        'target': target,
        'action': action,
        'old_status': old_status,
        'new_status': new_status,
        'note': note,
    })


def confirm_all_character_v1_3d(pvb: dict, char_id: str, reviewer: str, note: str = '') -> None:
    char = _find(pvb.get('characters', []) or [], 'character_id', char_id)
    if not char:
        raise ValueError(f'invalid character_id: {char_id}')
    old = char.get('status', 'candidate')
    for _, field_entry in _iter_entries(char):
        if field_entry.get('status') == 'candidate':
            field_entry['status'] = 'confirmed'
    new = recompute_pvb_character_status_v1_3d(char)
    _review_log_v1_3d(pvb, reviewer, f'characters[{char_id}]', 'confirm_all', old, new, note)


def lock_all_character_v1_3d(pvb: dict, char_id: str, reviewer: str, note: str = '') -> None:
    char = _find(pvb.get('characters', []) or [], 'character_id', char_id)
    if not char:
        raise ValueError(f'invalid character_id: {char_id}')
    consuming = [entry for _, entry in _iter_entries(char) if entry.get('status') not in NON_CONSUMING_STATUSES]
    if any(entry.get('status') == 'candidate' for entry in consuming):
        raise ValueError('lock_all requires all consuming fields to be confirmed or locked')
    old = char.get('status', 'candidate')
    for field_entry in consuming:
        if field_entry.get('status') == 'confirmed':
            field_entry['status'] = 'locked'
    new = recompute_pvb_character_status_v1_3d(char)
    _review_log_v1_3d(pvb, reviewer, f'characters[{char_id}]', 'lock_all', old, new, note)

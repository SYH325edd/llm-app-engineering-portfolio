from __future__ import annotations

import copy
import re
from typing import Any

from prompt_foundry_v1_3.pvb_optional import validate_pvb_optional_semantics_v1_3d
from runtime.story_projection import project_character
from runtime.authority_contract import authority_manifest


CONTRACT_VERSION = "pvb_character.v3_1"
IDENTITY_FIELDS = ("age_appearance", "face", "hair", "body", "skin")
WARDROBE_FIELDS = ("default", "outerwear", "shirt", "footwear", "accessory")
CANONICAL_TOP_FIELDS = ("character_id", "visual_identity", "wardrobe", "status", "version")
CANONICAL_LEAF_FIELDS = ("value", "source", "status")


def _is_consumable_identity_text(value: Any) -> bool:
    """Return whether a visual value can survive the current production compiler.

    Final production prompts are Chinese-first and the consumption compiler drops
    Latin-bearing asset prose rather than leaking mixed-language design text.  The
    PVB contract therefore treats an all-empty / all-nonconsumable character as an
    invalid production asset, while still allowing individual optional fields to
    remain empty.
    """
    text = str(value or "").strip()
    if not text or re.search(r"[A-Za-z]", text):
        return False
    return bool(re.search(r"[\u4e00-\u9fff0-9]", text))


def _has_minimum_identity_anchor(story_character: dict[str, Any], value: dict[str, Any]) -> bool:
    visual_lock = story_character.get("visual_lock") if isinstance(story_character.get("visual_lock"), dict) else {}
    for field in (*IDENTITY_FIELDS, *WARDROBE_FIELDS):
        if _is_consumable_identity_text(visual_lock.get(field)):
            return True
    for section, fields in (("visual_identity", IDENTITY_FIELDS), ("wardrobe", WARDROBE_FIELDS)):
        data = value.get(section) if isinstance(value.get(section), dict) else {}
        for field in fields:
            entry = data.get(field)
            if isinstance(entry, dict) and entry.get("status") not in {"skipped", "optional_absent"}:
                if _is_consumable_identity_text(entry.get("value")):
                    return True
    return False

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 的 Stage 05A：PVB Character Visual Designer。当前只处理一个需要实际出镜生产资产的 FROZEN-01 Character。角色叙事等级不决定是否需要视觉资产；只要下游镜头实际可见，就允许生成最小充分 PVB。
你只负责生成 production visual 的 value，不负责任何 ID、source、status、version，也不负责 confirmed/locked。

输出 JSON 固定为：
{"character":{"visual_identity":{"age_appearance":"","face":"","hair":"","body":"","skin":""},"wardrobe":{"default":"","outerwear":"","shirt":"","footwear":"","accessory":""}}}

规则：
1. 只输出 visual_identity 与 wardrobe 两个对象；不要输出 character_id/source/status/version。
2. 所有 10 个 canonical value 字段都必须存在并使用 JSON string；不得新增字段。
3. field_policy.story_owned_fields 已由 Story Bible 锁定：对应 value 输出空字符串，Runtime 会生成 skipped。
4. 其他字段只生成可视、可生产的外观值；不得加入剧情、身份、关系、心理、动作、镜头或环境信息。
5. wardrobe.accessory 若没有必须固定的具体配饰，输出空字符串；Runtime 会生成 optional_absent。不得写“无明显配饰/无固定配饰”等伪内容。
6. 不得生成 confirmed/locked；Stage 05A canonical checkpoint 只允许 candidate/skipped/optional_absent。
7. 如果 user payload 含 repair_instruction：以 invalid_output 为参考，只修 validation_errors 指向的视觉字段；不得借修复新增故事事实、身份、关系、动作或环境。
8. Story-owned 可视字段与本次 production design 合并后，角色至少必须存在一个可消费的具体视觉身份锚点；不得把所有可生产视觉字段同时留空。个别字段仍可为空，不得为了凑字段编造内容。
9. 只输出 JSON object，不要 markdown、解释或前后缀文本。
"""


def _story_owned(character: dict[str, Any], field: str) -> bool:
    value = (character.get("visual_lock") or {}).get(field)
    return value not in (None, "", [], {})


def _field_path(section: str, field: str) -> str:
    return f"{section}.{field}"


def build_pvb_character_payload(character: dict[str, Any], *, unit_id: str) -> dict[str, Any]:
    story_owned_fields = []
    for section, fields in (("visual_identity", IDENTITY_FIELDS), ("wardrobe", WARDROBE_FIELDS)):
        for field in fields:
            if _story_owned(character, field):
                story_owned_fields.append(_field_path(section, field))
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        "story_character": project_character(character),
        "field_policy": {
            "story_owned_fields": story_owned_fields,
            "optional_absent_fields": ["wardrobe.accessory"],
        },
        "output_template": {
            "character": {
                "visual_identity": {field: "" for field in IDENTITY_FIELDS},
                "wardrobe": {field: "" for field in WARDROBE_FIELDS},
            }
        },
        "output_contract": {
            "model_character_fields": ["visual_identity", "wardrobe"],
            "visual_identity_fields": list(IDENTITY_FIELDS),
            "wardrobe_fields": list(WARDROBE_FIELDS),
            "model_leaf_type": "string",
            "canonical_leaf_fields": list(CANONICAL_LEAF_FIELDS),
            "program_owned_fields": [
                "character_id", "canonical_leaf.source", "canonical_leaf.status", "status", "version"
            ],
            "canonical_statuses": ["candidate", "skipped", "optional_absent"],
            "authority_manifest": authority_manifest("pvb_character"),
        },
    }


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _draft_value(value: Any) -> Any:
    # Migration compatibility only: old Runtime asked the model for full leaf objects.
    # The semantic value is preserved; model-provided metadata is discarded.
    if isinstance(value, dict) and set(value).issubset({"value", "source", "status"}):
        return value.get("value")
    return value


def validate_pvb_character_model_output(value: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{"type": "shape_type_mismatch", "path": "character", "detail": "character must be JSON object", "expected": "JSON object", "actual_type": type(value).__name__}]

    allowed_top = {"visual_identity", "wardrobe"}
    legacy_program_owned = {"character_id", "status", "version"}
    for field in sorted(set(value) - allowed_top - legacy_program_owned):
        _error(errors, "extra_pvb_model_field", f"character.{field} is not owned by PVB model output", path=f"character.{field}")
    for section, fields in (("visual_identity", IDENTITY_FIELDS), ("wardrobe", WARDROBE_FIELDS)):
        data = value.get(section)
        if not isinstance(data, dict):
            _error(errors, "shape_type_mismatch", f"character.{section} must be JSON object", path=f"character.{section}", expected="JSON object", actual_type=type(data).__name__)
            continue
        for field in fields:
            if field not in data:
                _error(errors, "missing_pvb_model_field", f"character.{section}.{field} is required", path=f"character.{section}.{field}")
        for field in sorted(set(data) - set(fields)):
            _error(errors, "extra_pvb_model_field", f"character.{section}.{field} is not a canonical PVB field", path=f"character.{section}.{field}")
        for field in fields:
            if field not in data:
                continue
            raw = data[field]
            draft = _draft_value(raw)
            if not isinstance(draft, str):
                _error(errors, "invalid_pvb_model_value", f"character.{section}.{field} must be string", path=f"character.{section}.{field}", actual_type=type(draft).__name__)
            if isinstance(raw, dict) and not set(raw).issubset({"value", "source", "status"}):
                _error(errors, "extra_pvb_model_field", f"legacy leaf character.{section}.{field} contains unsupported fields", path=f"character.{section}.{field}")
    return errors


def canonicalize_pvb_character(story_character: dict[str, Any], model_value: dict[str, Any]) -> tuple[dict[str, Any], int]:
    out: dict[str, Any] = {
        "character_id": str(story_character.get("character_id") or ""),
        "visual_identity": {},
        "wardrobe": {},
        "status": "candidate",
        "version": 1,
    }
    changes = 1
    for section, fields in (("visual_identity", IDENTITY_FIELDS), ("wardrobe", WARDROBE_FIELDS)):
        source_data = model_value.get(section) if isinstance(model_value, dict) else None
        source_data = source_data if isinstance(source_data, dict) else {}
        for field in fields:
            raw = _draft_value(source_data.get(field, ""))
            value = raw if isinstance(raw, str) else raw
            if _story_owned(story_character, field):
                leaf = {"value": "", "source": "", "status": "skipped"}
            elif section == "wardrobe" and field == "accessory" and value in (None, ""):
                leaf = {"value": "", "source": "", "status": "optional_absent"}
            else:
                leaf = {"value": value, "source": "production_design", "status": "candidate"}
            out[section][field] = leaf
            changes += 1
    return out, changes


def validate_pvb_character_candidate(story_character: dict[str, Any], value: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{"type": "shape_type_mismatch", "path": "character", "detail": "canonical PVB character must be JSON object", "expected": "JSON object", "actual_type": type(value).__name__}]

    for field in sorted(set(value) - set(CANONICAL_TOP_FIELDS)):
        _error(errors, "extra_pvb_candidate_field", f"character.{field} is not part of canonical PVB", path=f"character.{field}")
    for field in CANONICAL_TOP_FIELDS:
        if field not in value:
            _error(errors, "missing_pvb_candidate_field", f"character.{field} is required", path=f"character.{field}")

    if value.get("character_id") != story_character.get("character_id"):
        _error(errors, "invalid_pvb_candidate_metadata", "character_id must match Story Bible", field="character_id")
    if value.get("status") != "candidate":
        _error(errors, "invalid_pvb_candidate_metadata", "Stage 05A character status must be candidate", field="status")
    if value.get("version") != 1:
        _error(errors, "invalid_pvb_candidate_metadata", "PVB version must be 1", field="version")

    for section, fields in (("visual_identity", IDENTITY_FIELDS), ("wardrobe", WARDROBE_FIELDS)):
        data = value.get(section)
        if not isinstance(data, dict):
            _error(errors, "shape_type_mismatch", f"character.{section} must be JSON object", path=f"character.{section}", expected="JSON object", actual_type=type(data).__name__)
            continue
        for field in fields:
            if field not in data:
                _error(errors, "missing_pvb_candidate_field", f"character.{section}.{field} is required", path=f"character.{section}.{field}")
        for field in sorted(set(data) - set(fields)):
            _error(errors, "extra_pvb_candidate_field", f"character.{section}.{field} is not canonical", path=f"character.{section}.{field}")
        for field in fields:
            entry = data.get(field)
            path = f"{section}.{field}"
            if not isinstance(entry, dict):
                _error(errors, "shape_type_mismatch", f"character.{path} must be JSON object", path=f"character.{path}", expected="JSON object", actual_type=type(entry).__name__)
                continue
            if set(entry) != set(CANONICAL_LEAF_FIELDS):
                _error(errors, "invalid_pvb_candidate_metadata", f"character.{path} must contain exactly value/source/status", field=path)
                continue
            if not isinstance(entry.get("value"), str):
                _error(errors, "invalid_pvb_candidate_value", f"character.{path}.value must be string", field=path)
                continue
            model_value = entry.get("value")
            if _story_owned(story_character, field):
                expected = {"value": "", "source": "", "status": "skipped"}
            elif section == "wardrobe" and field == "accessory" and model_value == "":
                expected = {"value": "", "source": "", "status": "optional_absent"}
            else:
                expected = {"value": model_value, "source": "production_design", "status": "candidate"}
            if entry != expected:
                _error(errors, "invalid_pvb_candidate_metadata", f"character.{path} metadata does not match Stage 05A authority policy", field=path)

    optional = validate_pvb_optional_semantics_v1_3d(
        {"characters": [copy.deepcopy(story_character)]},
        {"characters": [copy.deepcopy(value)]},
    )
    errors.extend(optional.get("errors") or [])

    if not _has_minimum_identity_anchor(story_character, value):
        repairable_paths = [
            _field_path(section, field)
            for section, fields in (("visual_identity", IDENTITY_FIELDS), ("wardrobe", WARDROBE_FIELDS))
            for field in fields
            if not _story_owned(story_character, field) and not (section == "wardrobe" and field == "accessory")
        ]
        _error(
            errors,
            "pvb_missing_identity_anchor",
            "character has no consumable canonical identity cue after Story-owned and PVB fields are combined",
            path="character",
            character_id=str(story_character.get("character_id") or ""),
            repair_targets=repairable_paths,
            must_change_any_of_paths=repairable_paths,
        )
    return errors

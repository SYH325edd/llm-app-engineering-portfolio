from __future__ import annotations

import copy
from typing import Any

from runtime.authority_contract import authority_manifest

CONTRACT_VERSION = "style_guide.v3"
STYLE_FIELDS = ("era", "region", "genre", "tone", "visual_reference")
CANONICAL_LEAF_FIELDS = ("value", "source", "status")

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 的 Stage 05C：Global Style Guide Designer。
当前只生成整个项目真正全局的风格 value。你不负责 source/status，也不负责 PVB、PSB、Storyboard 或 Director。

输出 JSON 固定为：
{"era":"","region":"","genre":"","tone":"","visual_reference":""}

规则：
1. 五个字段必须全部存在并使用 JSON string；field_policy.required_nonempty_paths 中所有字段都必须非空，output_template 的空字符串只是结构占位。无法可靠判断 era/region 时输出“未限定”；genre/tone/visual_reference 必须给出可执行的全局风格设计。
2. 不要输出 source/status；Runtime 会统一生成 production_design + candidate。
3. era/region/genre/tone/visual_reference 必须描述项目全局风格，不得把单场天气、单场灯光、局部道具或单一剧情事件写成全局风格。
4. 不得生成角色视觉、场景 production_visual、摄影参数、动作、Director 决策或最终 Prompt。
5. source_text 用于理解整体题材/语气，Story Bible 是事实边界；不得修改或新增故事事实。
6. 不得生成 confirmed/locked；Stage 05C checkpoint 只允许 candidate。
7. 如果 user payload 含 repair_instruction：以 invalid_output 为参考，只修 validation_errors 指向的全局风格字段，不得改写 Story Bible 事实或引入单场景局部事实。
8. 只输出 JSON object，不要 markdown、解释或前后缀文本。
"""


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _draft_value(value: Any) -> Any:
    # Migration compatibility for old full-leaf outputs.
    if isinstance(value, dict) and set(value).issubset({"value", "source", "status"}):
        return value.get("value")
    return value


def build_style_guide_payload(source_text: str, story_bible: dict[str, Any], *, unit_id: str) -> dict[str, Any]:
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        "source_text": source_text,
        "story_bible": copy.deepcopy(story_bible),
        "field_policy": {
            "required_nonempty_paths": list(STYLE_FIELDS),
        },
        "output_template": {field: "" for field in STYLE_FIELDS},
        "output_contract": {
            "model_fields": list(STYLE_FIELDS),
            "model_leaf_type": "string",
            "program_owned_fields": ["*.source", "*.status"],
            "canonical_leaf_fields": list(CANONICAL_LEAF_FIELDS),
            "canonical_statuses": ["candidate"],
            "candidate_value_policy": "genre/tone/visual_reference must be nonempty; era/region may use 未限定 when genuinely unknown",
            "authority_manifest": authority_manifest("style_guide"),
        },
    }


def validate_style_guide_model_output(value: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{
            "type": "shape_type_mismatch",
            "path": "style_guide",
            "detail": "style guide must be JSON object",
            "expected": "JSON object",
            "actual_type": type(value).__name__,
        }]

    for field in STYLE_FIELDS:
        if field not in value:
            _error(errors, "missing_style_model_field", f"{field} is required", field=field)
    for field in sorted(set(value) - set(STYLE_FIELDS)):
        _error(errors, "extra_style_model_field", f"{field} is not a canonical Style Guide field", field=field)

    for field in STYLE_FIELDS:
        if field not in value:
            continue
        raw = value[field]
        draft = _draft_value(raw)
        if not isinstance(draft, str):
            _error(errors, "invalid_style_model_value", f"{field} must be string", field=field, actual_type=type(draft).__name__)
            continue
        if not draft.strip():
            _error(errors, "blank_style_candidate_value", f"{field} must be nonempty", field=field)
        if isinstance(raw, dict) and not set(raw).issubset({"value", "source", "status"}):
            _error(errors, "extra_style_model_field", f"legacy leaf {field} contains unsupported fields", field=field)
    return errors


def canonicalize_style_guide(model_value: dict[str, Any]) -> tuple[dict[str, Any], int]:
    out: dict[str, Any] = {}
    for field in STYLE_FIELDS:
        raw = _draft_value(model_value.get(field, "")) if isinstance(model_value, dict) else ""
        out[field] = {"value": raw, "source": "production_design", "status": "candidate"}
    return out, len(STYLE_FIELDS)


def validate_style_guide_candidate(value: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{
            "type": "shape_type_mismatch",
            "path": "style_guide",
            "detail": "canonical style guide must be JSON object",
            "expected": "JSON object",
            "actual_type": type(value).__name__,
        }]

    for field in STYLE_FIELDS:
        if field not in value:
            _error(errors, "missing_style_candidate_field", f"{field} is required", field=field)
    for field in sorted(set(value) - set(STYLE_FIELDS)):
        _error(errors, "extra_style_candidate_field", f"{field} is not canonical", field=field)

    for field in STYLE_FIELDS:
        entry = value.get(field)
        if not isinstance(entry, dict):
            _error(errors, "shape_type_mismatch", f"{field} must be JSON object", path=field, expected="JSON object", actual_type=type(entry).__name__)
            continue
        if set(entry) != set(CANONICAL_LEAF_FIELDS):
            _error(errors, "invalid_style_candidate_metadata", f"{field} must contain exactly value/source/status", field=field)
            continue
        if not isinstance(entry.get("value"), str):
            _error(errors, "invalid_style_candidate_value", f"{field}.value must be string", field=field)
            continue
        expected = {"value": entry.get("value"), "source": "production_design", "status": "candidate"}
        if not entry.get("value", "").strip():
            _error(errors, "blank_style_candidate_value", f"{field}.value must be nonempty", field=field)
        if entry != expected:
            _error(errors, "invalid_style_candidate_metadata", f"{field} metadata must be source=production_design/status=candidate", field=field)
    return errors

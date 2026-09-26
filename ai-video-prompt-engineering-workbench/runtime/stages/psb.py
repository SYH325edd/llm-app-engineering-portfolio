from __future__ import annotations

import copy
from typing import Any

from runtime.authority_contract import authority_manifest

CONTRACT_VERSION = "psb_scene.v5"
PSB_FIELDS = ("space", "layout", "materials", "lighting", "color", "environment")
CANONICAL_TOP_FIELDS = ("scene_id", "production_visual", "status", "version")
CANONICAL_LEAF_FIELDS = ("value", "source", "status")

SYSTEM_PROMPT = """你是 Prompt Foundry Runtime 的 Stage 05B：PSB Scene Production Designer。当前只处理一个 FROZEN-01 physical Scene。
你只负责生成 6 个 production visual 的 value，不负责任何 scene_id、source、status、version，也不负责 confirmed/locked。

输出 JSON 固定为：
{"scene":{"production_visual":{"space":"","layout":"","materials":"","lighting":"","color":"","environment":""}}}

规则：
1. 只输出 production_visual；不要输出 scene_id/source/status/version。
2. production_visual 固定且必须完整包含 space/layout/materials/lighting/color/environment，所有 value 必须是 JSON string；不得新增字段。
3. field_policy.story_owned_fields 已由 Story Bible 锁定：对应 value 输出空字符串，Runtime 会生成 skipped。
4. 其余字段属于 PSB 被明确授权的生产设计空间：field_policy.required_nonempty_paths 中每个字段都必须给出保守、可见、可生产、与场景一致的非空设计值；output_template 里的空字符串只是结构占位，不是允许返回的值。不得写“未知/未说明/无信息”。
5. 生产设计补全不是新增剧情事实：可以补 layout/materials/lighting/color 等静态视觉设计，但不得改变地点身份、人物、剧情、动作、关键道具或既有 Story Bible 视觉锁。
6. 不得生成 candidate/confirmed/locked/skipped 等状态；Runtime 独占 metadata 与 authority。
7. 如果 user payload 含 repair_instruction：以 invalid_output 为参考，只修 validation_errors 指向的 production_visual 字段。若错误为 blank_psb_candidate_value，必须仅为这些空字段补上保守、非剧情性的生产设计值；不得继续留空，也不得借修复改变 Story Bible 事实。
8. 只输出 JSON object，不要 markdown、解释或前后缀文本。
"""


def _story_owned(scene: dict[str, Any], field: str) -> bool:
    value = (scene.get("visual_lock") or {}).get(field)
    return value not in (None, "", [], {})


def _error(errors: list[dict[str, Any]], etype: str, detail: str, **context: Any) -> None:
    item = {"type": etype, "detail": detail}
    item.update(context)
    errors.append(item)


def _draft_value(value: Any) -> Any:
    # Migration compatibility only: older Runtime requested full leaf objects.
    # Only semantic value survives; all model-provided metadata is discarded.
    if isinstance(value, dict) and set(value).issubset({"value", "source", "status"}):
        return value.get("value")
    return value


def build_psb_scene_payload(scene: dict[str, Any], *, unit_id: str) -> dict[str, Any]:
    owned = [field for field in PSB_FIELDS if _story_owned(scene, field)]
    return {
        "unit_id": unit_id,
        "contract_version": CONTRACT_VERSION,
        "story_scene": copy.deepcopy(scene),
        "field_policy": {
            "story_owned_fields": owned,
            "required_candidate_fields": [field for field in PSB_FIELDS if field not in owned],
            "required_nonempty_paths": [
                f"scene.production_visual.{field}" for field in PSB_FIELDS if field not in owned
            ],
        },
        "output_template": {
            "scene": {
                "production_visual": {field: "" for field in PSB_FIELDS},
            }
        },
        "output_contract": {
            "model_scene_fields": ["production_visual"],
            "production_visual_fields": list(PSB_FIELDS),
            "model_leaf_type": "string",
            "program_owned_fields": [
                "scene_id", "canonical_leaf.source", "canonical_leaf.status", "status", "version"
            ],
            "canonical_statuses": ["candidate", "skipped"],
            "candidate_value_policy": "non-story-owned fields are authorized production-design space and must be nonempty strings; conservative non-story-changing inference is required when source text does not specify the visual detail",
            "authority_manifest": authority_manifest("psb_scene"),
        },
    }


def validate_psb_scene_model_output(value: Any, story_scene: dict[str, Any]) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{
            "type": "shape_type_mismatch",
            "path": "scene",
            "detail": "scene must be JSON object",
            "expected": "JSON object",
            "actual_type": type(value).__name__,
        }]

    allowed_top = {"production_visual"}
    legacy_program_owned = {"scene_id", "status", "version"}
    for field in sorted(set(value) - allowed_top - legacy_program_owned):
        _error(errors, "extra_psb_model_field", f"scene.{field} is not owned by PSB model output", path=f"scene.{field}")

    production = value.get("production_visual")
    if not isinstance(production, dict):
        _error(
            errors,
            "shape_type_mismatch",
            "scene.production_visual must be JSON object",
            path="scene.production_visual",
            expected="JSON object",
            actual_type=type(production).__name__,
        )
        return errors

    for field in PSB_FIELDS:
        if field not in production:
            _error(errors, "missing_psb_model_field", f"scene.production_visual.{field} is required", path=f"scene.production_visual.{field}")
    for field in sorted(set(production) - set(PSB_FIELDS)):
        _error(errors, "extra_psb_model_field", f"scene.production_visual.{field} is not canonical", path=f"scene.production_visual.{field}")

    for field in PSB_FIELDS:
        if field not in production:
            continue
        raw = production[field]
        draft = _draft_value(raw)
        path = f"scene.production_visual.{field}"
        if not isinstance(draft, str):
            _error(errors, "invalid_psb_model_value", f"{path} must be string", path=path, actual_type=type(draft).__name__)
            continue
        if not _story_owned(story_scene, field) and not draft.strip():
            _error(errors, "blank_psb_candidate_value", f"{path} must be nonempty because Story Bible does not own this field", path=path)
        if isinstance(raw, dict) and not set(raw).issubset({"value", "source", "status"}):
            _error(errors, "extra_psb_model_field", f"legacy leaf {path} contains unsupported fields", path=path)
    return errors


def canonicalize_psb_scene(story_scene: dict[str, Any], model_value: dict[str, Any]) -> tuple[dict[str, Any], int]:
    out: dict[str, Any] = {
        "scene_id": str(story_scene.get("scene_id") or ""),
        "production_visual": {},
        "status": "candidate",
        "version": 1,
    }
    production = model_value.get("production_visual") if isinstance(model_value, dict) else None
    production = production if isinstance(production, dict) else {}
    for field in PSB_FIELDS:
        raw = _draft_value(production.get(field, ""))
        if _story_owned(story_scene, field):
            leaf = {"value": "", "source": "", "status": "skipped"}
        else:
            leaf = {"value": raw, "source": "production_design", "status": "candidate"}
        out["production_visual"][field] = leaf
    # This is a construction from model draft to canonical candidate, not semantic inference.
    return out, 1 + len(PSB_FIELDS)


def validate_psb_scene_candidate(story_scene: dict[str, Any], value: Any) -> list[dict[str, Any]]:
    errors: list[dict[str, Any]] = []
    if not isinstance(value, dict):
        return [{
            "type": "shape_type_mismatch",
            "path": "scene",
            "detail": "canonical PSB scene must be JSON object",
            "expected": "JSON object",
            "actual_type": type(value).__name__,
        }]

    for field in sorted(set(value) - set(CANONICAL_TOP_FIELDS)):
        _error(errors, "extra_psb_candidate_field", f"scene.{field} is not part of canonical PSB", path=f"scene.{field}")
    for field in CANONICAL_TOP_FIELDS:
        if field not in value:
            _error(errors, "missing_psb_candidate_field", f"scene.{field} is required", path=f"scene.{field}")

    if value.get("scene_id") != story_scene.get("scene_id"):
        _error(errors, "invalid_psb_candidate_metadata", "scene_id must match Story Bible", field="scene_id")
    if value.get("status") != "candidate":
        _error(errors, "invalid_psb_candidate_metadata", "Stage 05B scene status must be candidate", field="status")
    if value.get("version") != 1:
        _error(errors, "invalid_psb_candidate_metadata", "PSB version must be 1", field="version")

    production = value.get("production_visual")
    if not isinstance(production, dict):
        _error(errors, "shape_type_mismatch", "scene.production_visual must be JSON object", path="scene.production_visual", expected="JSON object", actual_type=type(production).__name__)
        return errors

    for field in PSB_FIELDS:
        if field not in production:
            _error(errors, "missing_psb_candidate_field", f"scene.production_visual.{field} is required", path=f"scene.production_visual.{field}")
    for field in sorted(set(production) - set(PSB_FIELDS)):
        _error(errors, "extra_psb_candidate_field", f"scene.production_visual.{field} is not canonical", path=f"scene.production_visual.{field}")

    for field in PSB_FIELDS:
        entry = production.get(field)
        path = f"production_visual.{field}"
        if not isinstance(entry, dict):
            _error(errors, "shape_type_mismatch", f"scene.{path} must be JSON object", path=f"scene.{path}", expected="JSON object", actual_type=type(entry).__name__)
            continue
        if set(entry) != set(CANONICAL_LEAF_FIELDS):
            _error(errors, "invalid_psb_candidate_metadata", f"scene.{path} must contain exactly value/source/status", field=path)
            continue
        if not isinstance(entry.get("value"), str):
            _error(errors, "invalid_psb_candidate_value", f"scene.{path}.value must be string", field=path)
            continue
        if _story_owned(story_scene, field):
            expected = {"value": "", "source": "", "status": "skipped"}
        else:
            expected = {"value": entry.get("value"), "source": "production_design", "status": "candidate"}
            if not entry.get("value", "").strip():
                _error(errors, "blank_psb_candidate_value", f"scene.{path}.value must be nonempty", field=path)
        if entry != expected:
            _error(errors, "invalid_psb_candidate_metadata", f"scene.{path} metadata does not match Stage 05B authority policy", field=path)
    return errors

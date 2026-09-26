from __future__ import annotations

import re
from typing import Any


def _schema_from_example(value: Any) -> dict[str, Any]:
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int) and not isinstance(value, bool):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if isinstance(value, list):
        item_schema = _schema_from_example(value[0]) if value else {}
        return {"type": "array", "items": item_schema}
    if isinstance(value, dict):
        if not value:
            # Dynamic state/ref maps exist in Director and Story Bible locks. Keep
            # their inner keys open while still constraining the object type.
            return {"type": "object"}
        properties = {str(key): _schema_from_example(item) for key, item in value.items()}
        return {
            "type": "object",
            "properties": properties,
            "required": list(properties),
            "additionalProperties": False,
        }
    if value is None:
        return {}
    return {}


def schema_from_output_template(template: Any) -> dict[str, Any] | None:
    if not isinstance(template, dict) or not template:
        return None
    schema = _schema_from_example(template)
    return schema if schema.get("type") == "object" else None


def _apply_stage_schema_constraints(stage: str, schema: dict[str, Any]) -> None:
    """Apply narrow transport constraints that example inference cannot express.

    This is intentionally not a business validator. It only closes structural holes
    in Structured Outputs while the Runtime validator remains the final authority.
    """
    if stage != "director_shot":
        return
    try:
        action_items = schema["properties"]["director"]["properties"]["performance_actions"]["items"]
        evidence = action_items["properties"]["source_evidence"]
    except (KeyError, TypeError):
        return
    # performance_actions itself may be empty. If an action exists, however, Director
    # contract requires at least one authority evidence item.
    if isinstance(evidence, dict):
        evidence["minItems"] = 1

    # Director v17 optional execution signals: Structured Outputs still knows the
    # full item shape from provider_output_template, but only identity/binding keys
    # are required. This prevents the model from filling every acting field merely
    # to satisfy a transport schema.
    try:
        dprops = schema["properties"]["director"]["properties"]
        logic_item = dprops["performance_logic"]["items"]
        execution_item = dprops["performance_execution"]["items"]
        delivery_item = dprops["dialogue_delivery"]["items"]
        if isinstance(logic_item, dict):
            logic_item["required"] = ["character_ref"]
        if isinstance(execution_item, dict):
            execution_item["required"] = ["character_ref"]
        if isinstance(delivery_item, dict):
            delivery_item["required"] = ["frozen_text_unit_id", "speaker_ref"]
    except (KeyError, TypeError):
        pass


def provider_json_schema(stage: str, template: Any) -> dict[str, Any] | None:
    schema = schema_from_output_template(template)
    if schema is None:
        return None
    _apply_stage_schema_constraints(stage, schema)
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", str(stage or "stage"))[:48] or "stage"
    return {
        "type": "json_schema",
        "json_schema": {
            "name": f"pf_{name}",
            # Some Ark-compatible models accept strict JSON Schema while others only
            # support json_object. ArkClient auto-falls back on capability errors.
            "strict": True,
            "schema": schema,
        },
    }

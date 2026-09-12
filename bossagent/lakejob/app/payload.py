from __future__ import annotations

import json
from typing import Any


def payload_obj(payload: Any) -> dict[str, Any]:
    if isinstance(payload, dict):
        return payload
    if isinstance(payload, str):
        try:
            return json.loads(payload)
        except json.JSONDecodeError:
            return {}
    return {}


def payload_text(payload: Any) -> str:
    return json.dumps(payload_obj(payload), ensure_ascii=False, default=str)

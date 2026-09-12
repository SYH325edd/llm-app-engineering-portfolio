from __future__ import annotations

import hmac
import os


LOCAL_CONFIRM_HEADER = "x-boss-agent-local-confirm"


def require_local_post_confirmation(value: str | None) -> None:
    expected = os.getenv("BOSS_AGENT_LOCAL_POST_TOKEN", "LOCAL_DRY_RUN_ONLY")
    if not value or not hmac.compare_digest(value, expected):
        raise PermissionError("local POST confirmation token missing or invalid")

"""Database tests for Message Center.

The test never sends messages and never calls BOSS automation.
"""

from __future__ import annotations

import json
import os
from typing import Any

import message_center
from jobradar_log import _one, db_conn, ensure_account, ensure_platform


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _json(data: Any) -> str:
    return json.dumps(data or {}, ensure_ascii=False, default=str)


def ensure_test_conversation() -> str:
    platform_id = ensure_platform()
    account_id = ensure_account(platform_id, "message-center-test")
    with db_conn() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            INSERT INTO conversations (
              platform_id, account_id, subject_type, counterparty_name,
              counterparty_role, status, metadata, last_message_preview, last_message_at
            )
            VALUES (%s,%s,'general','Message Center Test','unknown','active',%s::jsonb,'hello from test',now())
            RETURNING id
            """,
            (platform_id, account_id, _json({"source": "message_center_test"})),
        )
        conversation_id = str(_one(cur)["id"])
        cur.execute(
            """
            INSERT INTO messages (
              conversation_id, platform_id, account_id, sender_type, sender_name,
              content, direction, status, metadata
            )
            VALUES (%s,%s,%s,'system','Message Center Test','hello from test','internal','sent',%s::jsonb)
            """,
            (conversation_id, platform_id, account_id, _json({"source": "message_center_test"})),
        )
        return conversation_id


def main() -> int:
    if not os.getenv("LAKEJOB_DATABASE_URL") and not os.getenv("DATABASE_URL"):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return 0

    conversation_id = ensure_test_conversation()

    conversations = message_center.list_conversations({"keyword": "Message Center Test", "status": "all", "source": "all"})
    assert_true(isinstance(conversations, list), "list_conversations must return a list")
    assert_true(any(str(item["conversation_id"]) == conversation_id for item in conversations), "test conversation not listed")

    messages = message_center.list_messages(conversation_id)
    assert_true(isinstance(messages, list), "list_messages must return a list")
    assert_true(len(messages) >= 1, "test conversation messages missing")

    updated = message_center.update_conversation_status(conversation_id, "replied")
    assert_true(updated["old_status"] in message_center.ALLOWED_CONVERSATION_STATUSES, "old status invalid")
    assert_true(updated["new_status"] == "replied", "new status not returned")

    latest = message_center.get_latest_conversation_status(conversation_id)
    assert_true(latest == "replied", "latest status not read from logs")

    detail = message_center.get_conversation_detail(conversation_id)
    assert_true(detail is not None, "conversation detail missing")
    assert_true(detail["status"] == "replied", "detail status not updated")
    assert_true(len(detail["messages"]) >= 1, "detail messages missing")

    print(
        json.dumps(
            {
                "status": "PASSED",
                "conversation_id": conversation_id,
                "latest_status": latest,
                "message_count": len(messages),
                "log_id": updated["log_id"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    print("PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

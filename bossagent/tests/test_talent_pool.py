"""Offline/DB validation for Talent Pool."""

from __future__ import annotations

import json
import os
import time
from typing import Any

import talent_pool


def _json(data: Any) -> str:
    return json.dumps(data or {}, ensure_ascii=False)


def ensure_test_candidate() -> str:
    with talent_pool.db_conn() as conn:
        try:
            cur = conn.cursor()
            cur.execute(
                """
                INSERT INTO platforms (code, name, category, status)
                VALUES ('talent_pool_test', 'Talent Pool Test', 'job_board', 'active')
                ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
                RETURNING id
                """
            )
            platform_id = cur.fetchone()[0]
            cur.execute(
                """
                INSERT INTO accounts (platform_id, account_type, display_name, external_account_id, status)
                VALUES (%s, 'system', 'talent-pool-test', 'talent-pool-test', 'active')
                ON CONFLICT (platform_id, external_account_id) WHERE external_account_id IS NOT NULL
                DO UPDATE SET display_name = EXCLUDED.display_name
                RETURNING id
                """,
                (platform_id,),
            )
            account_id = cur.fetchone()[0]
            external_id = f"talent-pool-test-{int(time.time())}"
            cur.execute(
                """
                INSERT INTO candidates (
                  platform_id, account_id, external_candidate_id, name, city,
                  current_title, skills, resume_text, status, raw_data
                )
                VALUES (%s,%s,%s,'Talent Test Candidate','杭州','AI工程师',%s::jsonb,'Python FastAPI PostgreSQL','active',%s::jsonb)
                RETURNING id
                """,
                (platform_id, account_id, external_id, _json(["Python", "FastAPI"]), _json({"source": "test"})),
            )
            candidate_id = str(cur.fetchone()[0])
            conn.commit()
            return candidate_id
        except Exception:
            conn.rollback()
            raise


def assert_true(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def main() -> int:
    if not (os.getenv("LAKEJOB_DATABASE_URL") or os.getenv("DATABASE_URL")):
        print("SKIPPED: LAKEJOB_DATABASE_URL not configured")
        return 0
    try:
        candidate_id = ensure_test_candidate()
        status_result = talent_pool.update_candidate_status(candidate_id, "contacted")
        assert_true(status_result["old_status"] == "new", "initial status should be new")
        assert_true(talent_pool.get_candidate_status(candidate_id) == "contacted", "status update failed")

        notes_result = talent_pool.update_candidate_notes(candidate_id, "已初步联系，等待回复。")
        assert_true(bool(notes_result["log_id"]), "notes log missing")
        assert_true("等待回复" in talent_pool.get_candidate_notes(candidate_id), "notes update failed")

        counts = talent_pool.status_counts()
        assert_true(counts["contacted"] >= 1, "status count missing contacted")

        detail = talent_pool.get_candidate_detail(candidate_id)
        assert_true(detail is not None, "candidate detail missing")
        assert_true(detail["talent_status"] == "contacted", "detail status mismatch")
        assert_true(any((log.get("payload") or {}).get("talent_pool") for log in detail["logs"]), "talent logs missing")

        print(
            json.dumps(
                {
                    "status": "PASSED",
                    "candidate_id": candidate_id,
                    "talent_status": detail["talent_status"],
                    "notes": detail["notes"],
                    "contacted_count": counts["contacted"],
                },
                ensure_ascii=False,
                indent=2,
                default=str,
            )
        )
        print("PASSED")
        return 0
    except Exception as exc:
        print(f"FAILED: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

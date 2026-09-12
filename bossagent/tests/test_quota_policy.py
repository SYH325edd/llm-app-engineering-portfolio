"""Dependency-free transactional tests for the fail-closed quota policy."""

from __future__ import annotations

import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from uuid import uuid4

import quota_policy


class FakeQuotaStore:
    def __init__(self, *, daily_limit: int = 1, unavailable: str | None = None):
        self.unavailable = unavailable
        self.limits = {
            "daily_search_limit": daily_limit,
            "daily_message_draft_limit": daily_limit,
            "daily_real_apply_limit": daily_limit,
            "daily_real_message_limit": daily_limit,
            "per_run_limit": 1,
            "monthly_credit_limit": 100,
        }
        self.ledger: list[dict] = []
        self.audit_logs: list[tuple] = []
        self.logs: list[tuple] = []
        self.lock = threading.Lock()

    @contextmanager
    def connection(self):
        conn = FakeConnection(self)
        try:
            yield conn
        finally:
            conn.close()


class FakeConnection:
    def __init__(self, store: FakeQuotaStore):
        self.store = store
        self.locked = False

    def cursor(self):
        return FakeCursor(self)

    def close(self):
        if self.locked:
            self.store.lock.release()
            self.locked = False


class FakeCursor:
    def __init__(self, conn: FakeConnection):
        self.conn = conn
        self.description = []
        self.rows: list[tuple] = []

    def execute(self, sql: str, params: tuple = ()):
        normalized = " ".join(sql.lower().split())
        store = self.conn.store
        self.rows = []

        if "pg_advisory_xact_lock" in normalized:
            store.lock.acquire()
            self.conn.locked = True
            self.rows = [(None,)]
            return

        if "from quotas q" in normalized:
            if store.unavailable == "quotas":
                raise RuntimeError('relation "quotas" does not exist')
            names = list(store.limits)
            self.description = [(name,) for name in names]
            self.rows = [tuple(store.limits[name] for name in names)]
            return

        if "select id from quota_ledger" in normalized:
            key, action, user_id, organization_id = params
            match = next(
                (
                    row for row in store.ledger
                    if row["idempotency_key"] == key
                    and row["action"] == action
                    and row["user_id"] == user_id
                    and row["organization_id"] == organization_id
                ),
                None,
            )
            self.rows = [(match["id"],)] if match else []
            return

        if "from quota_ledger" in normalized:
            if store.unavailable == "ledger":
                raise RuntimeError('relation "quota_ledger" does not exist')
            action, user_id, organization_id = params
            scoped = [
                row for row in store.ledger
                if row["user_id"] == user_id and row["organization_id"] == organization_id
            ]
            daily = sum(row["quantity"] for row in scoped if row["action"] == action)
            monthly = sum(row["credits"] for row in scoped)
            self.rows = [(daily, monthly)]
            return

        if "insert into quota_ledger" in normalized:
            (
                user_id,
                organization_id,
                account_id,
                task_id,
                action_type,
                amount,
                action,
                quantity,
                credits,
                key,
                metadata,
            ) = params
            row = {
                "id": str(uuid4()),
                "user_id": user_id,
                "organization_id": organization_id,
                "account_id": account_id,
                "task_id": task_id,
                "action_type": action_type,
                "amount": amount,
                "action": action,
                "quantity": quantity,
                "credits": credits,
                "idempotency_key": key,
                "metadata": metadata,
            }
            store.ledger.append(row)
            self.rows = [(row["id"],)]
            return

        if "insert into audit_logs" in normalized:
            store.audit_logs.append(params)
            return

        if "insert into logs" in normalized:
            store.logs.append(params)
            return

        raise AssertionError(f"unexpected SQL: {normalized}")

    def fetchone(self):
        return self.rows.pop(0) if self.rows else None


@contextmanager
def patched_store(store: FakeQuotaStore):
    original = quota_policy.db_conn
    quota_policy.db_conn = store.connection
    try:
        yield
    finally:
        quota_policy.db_conn = original


def context() -> quota_policy.QuotaContext:
    return quota_policy.QuotaContext(
        user_id="11111111-1111-1111-1111-111111111111",
        organization_id="22222222-2222-2222-2222-222222222222",
        account_id="33333333-3333-3333-3333-333333333333",
    )


def test_missing_tables_block_and_log() -> None:
    for missing_table in ("quotas", "ledger"):
        store = FakeQuotaStore(unavailable=missing_table)
        with patched_store(store):
            result = quota_policy.consume_quota("search", context=context())
        assert result["allowed"] is False
        assert result["error"] == quota_policy.QUOTA_UNAVAILABLE_ERROR
        assert not store.ledger
        assert len(store.audit_logs) == 1
        assert len(store.logs) == 1


def test_empty_identity_blocks() -> None:
    store = FakeQuotaStore()
    with patched_store(store):
        result = quota_policy.consume_quota("message_draft", context=quota_policy.QuotaContext())
    assert result["allowed"] is False
    assert result["reason"] == "quota_identity_required"
    assert not store.ledger
    assert len(store.audit_logs) == 1
    assert len(store.logs) == 1


def test_concurrent_requests_do_not_exceed_limit() -> None:
    store = FakeQuotaStore(daily_limit=1)
    barrier = threading.Barrier(2)

    def consume_once(index: int):
        barrier.wait()
        return quota_policy.consume_quota(
            "search",
            context=context(),
            idempotency_key=f"search-{index}",
        )

    with patched_store(store), ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(consume_once, (1, 2)))
    assert sum(1 for result in results if result["allowed"]) == 1
    assert len(store.ledger) == 1


def test_normal_request_writes_ledger() -> None:
    store = FakeQuotaStore(daily_limit=2)
    with patched_store(store):
        result = quota_policy.consume_quota(
            "real_apply",
            context=context(),
            idempotency_key="apply-1",
            metadata={"source": "unit_test"},
        )
    assert result["allowed"] is True
    assert result["consumed"] is True
    assert result["ledger_id"]
    assert len(store.ledger) == 1
    assert store.ledger[0]["user_id"] == context().user_id
    assert store.ledger[0]["organization_id"] == context().organization_id


def main() -> int:
    for test in (
        test_missing_tables_block_and_log,
        test_empty_identity_blocks,
        test_concurrent_requests_do_not_exceed_limit,
        test_normal_request_writes_ledger,
    ):
        test()
        print(f"PASSED {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

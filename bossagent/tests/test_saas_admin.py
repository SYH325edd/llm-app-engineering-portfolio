"""Focused dependency-free checks for the SaaS Admin Skill."""

from pathlib import Path

import lakejob.safety.quota as quota_policy
import lakejob.app.console as web_console


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_admin_routes_registered() -> None:
    paths = {route.path for route in web_console.app.routes}
    required = {
        "/admin/users", "/admin/plans", "/admin/quotas",
        "/admin/audit-logs", "/admin/task-runs",
    }
    assert required <= paths, required - paths


def test_migration_contains_required_tables_and_roles() -> None:
    migrations_path = PROJECT_ROOT / "migrations"
    sql = (migrations_path / "20260610_001_saas_admin.sql").read_text(encoding="utf-8")
    for table in (
        "users", "organizations", "memberships", "plans", "subscriptions",
        "quotas", "quota_ledger", "audit_logs", "account_pauses",
    ):
        assert f"CREATE TABLE IF NOT EXISTS {table}" in sql
    for role in ("jobseeker", "recruiter", "org_admin", "platform_admin"):
        assert role in sql
    for plan in (
        "free_jobseeker", "pro_jobseeker", "free_recruiter",
        "pro_recruiter", "platform_admin",
    ):
        assert plan in sql
    for column in ("action_type", "amount", "task_id", "created_at"):
        assert column in sql
    for column in ("status", "reason", "metadata"):
        assert column in sql
    for legacy in ("accounts", "tasks", "task_runs", "logs", "jobs", "candidates", "messages", "match_scores"):
        assert f"DROP TABLE {legacy}" not in sql


def test_quota_policy_surface() -> None:
    assert set(quota_policy.ACTION_LIMIT_FIELDS) == {
        "search", "message_draft", "real_apply", "real_message"
    }
    assert set(quota_policy.DEFAULT_LIMITS) == {
        "daily_search_limit", "daily_message_draft_limit", "daily_real_apply_limit",
        "daily_real_message_limit", "per_run_limit", "monthly_credit_limit",
    }
    assert quota_policy.DEFAULT_LIMITS["daily_real_apply_limit"] == 0
    assert quota_policy.DEFAULT_LIMITS["daily_real_message_limit"] == 0


def test_automatic_send_defaults_disabled() -> None:
    scheduler = (PROJECT_ROOT / "config" / "scheduler.yaml").read_text(encoding="utf-8")
    assert "message_draft:\n  enabled: false" in scheduler
    source = (PROJECT_ROOT / "lakejob" / "application" / "recruiting" / "message.py").read_text(encoding="utf-8")
    assert "draft_only" in source


def main() -> int:
    for test in (
        test_admin_routes_registered,
        test_migration_contains_required_tables_and_roles,
        test_quota_policy_surface,
        test_automatic_send_defaults_disabled,
    ):
        test()
        print(f"PASSED {test.__name__}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

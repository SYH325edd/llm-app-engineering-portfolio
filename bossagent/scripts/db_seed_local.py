from __future__ import annotations

import argparse
import os

from scripts.db_migrate import connect


SEED_SQL = """
INSERT INTO users(email, display_name, role, metadata)
VALUES ('local@boss-agent.invalid', 'Local Developer', 'org_admin', '{"local_seed": true}')
ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name;

INSERT INTO organizations(name, slug, metadata)
VALUES ('Local Development', 'local-development', '{"local_seed": true}')
ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO plans(code, name, description, price_monthly_cents, is_default, metadata)
VALUES ('local-safe', 'Local Safe MVP', 'Draft-only local development plan', 0, true,
        '{"local_seed": true, "real_actions_default": false}')
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description;

INSERT INTO memberships(organization_id, user_id, role)
SELECT o.id, u.id, 'org_admin' FROM organizations o, users u
WHERE o.slug = 'local-development' AND u.email = 'local@boss-agent.invalid'
ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

INSERT INTO subscriptions(organization_id, plan_id, status, metadata)
SELECT o.id, p.id, 'active', '{"local_seed": true}' FROM organizations o, plans p
WHERE o.slug = 'local-development' AND p.code = 'local-safe'
  AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.organization_id = o.id AND s.status IN ('trialing', 'active'));

INSERT INTO quotas(plan_id, daily_search_limit, daily_message_draft_limit,
                   daily_real_apply_limit, daily_real_message_limit, per_run_limit, monthly_credit_limit)
SELECT p.id, 20, 20, 0, 0, 1, 100 FROM plans p WHERE p.code = 'local-safe'
ON CONFLICT (plan_id) WHERE plan_id IS NOT NULL DO UPDATE SET
  daily_search_limit = 20, daily_message_draft_limit = 20,
  daily_real_apply_limit = 0, daily_real_message_limit = 0, per_run_limit = 1;
"""


def seed(database_url: str) -> None:
    with connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(SEED_SQL)
        conn.commit()


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed idempotent local development data")
    parser.add_argument("--database-url", default=os.getenv("LAKEJOB_DATABASE_URL", ""))
    args = parser.parse_args()
    if not args.database_url:
        parser.error("--database-url or LAKEJOB_DATABASE_URL is required")
    seed(args.database_url)
    print("PASS: local safe seed is current")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

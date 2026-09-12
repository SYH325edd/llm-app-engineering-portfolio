BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'jobseeker',
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT users_role_chk CHECK (role IN ('jobseeker', 'recruiter', 'org_admin', 'platform_admin')),
    CONSTRAINT users_status_chk CHECK (status IN ('invited', 'active', 'suspended', 'archived'))
);

CREATE TABLE IF NOT EXISTS organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT organizations_status_chk CHECK (status IN ('active', 'suspended', 'archived'))
);

CREATE TABLE IF NOT EXISTS memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'jobseeker',
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT memberships_role_chk CHECK (role IN ('jobseeker', 'recruiter', 'org_admin', 'platform_admin')),
    CONSTRAINT memberships_status_chk CHECK (status IN ('invited', 'active', 'suspended')),
    CONSTRAINT memberships_org_user_uniq UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    price_monthly_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_monthly_cents >= 0),
    currency TEXT NOT NULL DEFAULT 'CNY',
    is_default BOOLEAN NOT NULL DEFAULT false,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT plans_status_chk CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX IF NOT EXISTS plans_one_default_idx ON plans(is_default) WHERE is_default;

CREATE TABLE IF NOT EXISTS subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE RESTRICT,
    status TEXT NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
    current_period_end TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()) + interval '1 month',
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT subscriptions_owner_chk CHECK ((organization_id IS NOT NULL) <> (user_id IS NOT NULL)),
    CONSTRAINT subscriptions_status_chk CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled', 'expired'))
);

CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_active_org_idx
    ON subscriptions(organization_id) WHERE organization_id IS NOT NULL AND status IN ('trialing', 'active');
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_active_user_idx
    ON subscriptions(user_id) WHERE user_id IS NOT NULL AND status IN ('trialing', 'active');

CREATE TABLE IF NOT EXISTS quotas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    plan_id UUID REFERENCES plans(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    daily_search_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_search_limit >= 0),
    daily_message_draft_limit INTEGER NOT NULL DEFAULT 20 CHECK (daily_message_draft_limit >= 0),
    daily_real_apply_limit INTEGER NOT NULL DEFAULT 0 CHECK (daily_real_apply_limit >= 0),
    daily_real_message_limit INTEGER NOT NULL DEFAULT 0 CHECK (daily_real_message_limit >= 0),
    per_run_limit INTEGER NOT NULL DEFAULT 1 CHECK (per_run_limit >= 0),
    monthly_credit_limit INTEGER NOT NULL DEFAULT 100 CHECK (monthly_credit_limit >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT quotas_scope_chk CHECK (num_nonnulls(plan_id, organization_id, user_id) = 1)
);

CREATE UNIQUE INDEX IF NOT EXISTS quotas_plan_idx ON quotas(plan_id) WHERE plan_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quotas_org_idx ON quotas(organization_id) WHERE organization_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS quotas_user_idx ON quotas(user_id) WHERE user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS quota_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    action_type TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 1 CHECK (amount > 0),
    action TEXT NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
    credits INTEGER NOT NULL DEFAULT 1 CHECK (credits >= 0),
    idempotency_key TEXT UNIQUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT quota_ledger_action_chk CHECK (
        action_type IN ('search', 'message_draft', 'real_apply', 'real_message')
        AND action IN ('search', 'message_draft', 'real_apply', 'real_message')
    )
);

-- Upgrade databases that ran an earlier draft of this migration. The legacy
-- columns remain populated so existing workers can be rolled forward safely.
ALTER TABLE quota_ledger ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;
ALTER TABLE quota_ledger ADD COLUMN IF NOT EXISTS action_type TEXT;
ALTER TABLE quota_ledger ADD COLUMN IF NOT EXISTS amount INTEGER;
ALTER TABLE quota_ledger ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
UPDATE quota_ledger
SET action_type = COALESCE(action_type, action),
    amount = COALESCE(amount, quantity, 1),
    created_at = COALESCE(created_at, occurred_at, now())
WHERE action_type IS NULL OR amount IS NULL OR created_at IS NULL;
ALTER TABLE quota_ledger ALTER COLUMN action_type SET NOT NULL;
ALTER TABLE quota_ledger ALTER COLUMN amount SET DEFAULT 1;
ALTER TABLE quota_ledger ALTER COLUMN amount SET NOT NULL;
ALTER TABLE quota_ledger ALTER COLUMN created_at SET DEFAULT now();
ALTER TABLE quota_ledger ALTER COLUMN created_at SET NOT NULL;

CREATE INDEX IF NOT EXISTS quota_ledger_scope_time_idx
    ON quota_ledger(organization_id, user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quota_ledger_action_time_idx ON quota_ledger(action_type, created_at DESC);
CREATE INDEX IF NOT EXISTS quota_ledger_task_idx ON quota_ledger(task_id);

CREATE TABLE IF NOT EXISTS audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    actor_role TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    status TEXT NOT NULL DEFAULT 'success',
    reason TEXT,
    outcome TEXT NOT NULL DEFAULT 'success',
    ip_address INET,
    user_agent TEXT,
    request_id TEXT,
    before_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    after_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT audit_logs_outcome_chk CHECK (
        status IN ('success', 'failure', 'blocked')
        AND outcome IN ('success', 'failure', 'blocked')
    )
);

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS reason TEXT;
UPDATE audit_logs SET status = COALESCE(status, outcome, 'success') WHERE status IS NULL;
ALTER TABLE audit_logs ALTER COLUMN status SET DEFAULT 'success';
ALTER TABLE audit_logs ALTER COLUMN status SET NOT NULL;

CREATE INDEX IF NOT EXISTS audit_logs_org_time_idx ON audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_actor_time_idx ON audit_logs(actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_action_time_idx ON audit_logs(action, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_logs_metadata_gin_idx ON audit_logs USING GIN(metadata);

CREATE TABLE IF NOT EXISTS account_pauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    reason TEXT,
    source TEXT NOT NULL DEFAULT 'system',
    screenshot_path TEXT NOT NULL DEFAULT '',
    paused_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resume_at TIMESTAMPTZ,
    resumed_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT account_pauses_window_chk CHECK (resume_at IS NULL OR resume_at > paused_at),
    CONSTRAINT account_pauses_resume_chk CHECK (resumed_at IS NULL OR resumed_at >= paused_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS account_pauses_active_account_idx
    ON account_pauses(account_id) WHERE resumed_at IS NULL;
CREATE INDEX IF NOT EXISTS account_pauses_org_idx ON account_pauses(organization_id);
CREATE INDEX IF NOT EXISTS account_pauses_user_idx ON account_pauses(user_id);
CREATE INDEX IF NOT EXISTS account_pauses_open_idx
    ON account_pauses(created_at DESC) WHERE resolved_at IS NULL;

INSERT INTO plans (code, name, description, is_default)
VALUES
    ('free_jobseeker', 'Free Jobseeker', 'Free plan for individual job seekers', false),
    ('pro_jobseeker', 'Pro Jobseeker', 'Paid plan for individual job seekers', false),
    ('free_recruiter', 'Free Recruiter', 'Free plan for recruiters and small teams', false),
    ('pro_recruiter', 'Pro Recruiter', 'Paid plan for recruiters and organizations', false),
    ('platform_admin', 'Platform Admin', 'Internal platform administration plan', false)
ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    updated_at = now();

-- Keep exactly one global fallback plan, including upgrades from the old
-- single-plan "starter" migration.
UPDATE plans SET is_default = false WHERE is_default AND code <> 'free_jobseeker';
UPDATE plans SET is_default = true, updated_at = now() WHERE code = 'free_jobseeker';

INSERT INTO quotas (
    plan_id, daily_search_limit, daily_message_draft_limit, daily_real_apply_limit,
    daily_real_message_limit, per_run_limit, monthly_credit_limit
)
SELECT p.id, v.daily_search_limit, v.daily_message_draft_limit, v.daily_real_apply_limit,
       v.daily_real_message_limit, v.per_run_limit, v.monthly_credit_limit
FROM plans p
JOIN (VALUES
    ('free_jobseeker', 20, 20, 0, 0, 1, 100),
    ('pro_jobseeker', 200, 200, 20, 50, 20, 2000),
    ('free_recruiter', 20, 20, 0, 0, 1, 100),
    ('pro_recruiter', 500, 500, 100, 200, 50, 5000),
    ('platform_admin', 1000000, 1000000, 1000000, 1000000, 1000000, 1000000)
) AS v(code, daily_search_limit, daily_message_draft_limit, daily_real_apply_limit,
       daily_real_message_limit, per_run_limit, monthly_credit_limit)
ON p.code = v.code
ON CONFLICT (plan_id) WHERE plan_id IS NOT NULL DO NOTHING;

COMMIT;

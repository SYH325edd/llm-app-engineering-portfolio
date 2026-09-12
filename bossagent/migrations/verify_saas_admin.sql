-- SaaS Admin migration verification. Every result should be an empty array
-- except plan_codes, which should contain all five expected plans.

WITH required(name) AS (
    VALUES
        ('users'), ('organizations'), ('memberships'), ('plans'),
        ('subscriptions'), ('quotas'), ('quota_ledger'), ('audit_logs'),
        ('account_pauses')
)
SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::text[]) AS missing_saas_tables
FROM required
WHERE to_regclass('public.' || name) IS NULL;

WITH required(name) AS (
    VALUES
        ('accounts'), ('tasks'), ('task_runs'), ('logs'), ('jobs'),
        ('candidates'), ('messages'), ('match_scores')
)
SELECT COALESCE(array_agg(name ORDER BY name), ARRAY[]::text[]) AS missing_legacy_tables
FROM required
WHERE to_regclass('public.' || name) IS NULL;

WITH required(name) AS (
    VALUES
        ('user_id'), ('organization_id'), ('action_type'), ('amount'),
        ('task_id'), ('created_at')
)
SELECT COALESCE(array_agg(r.name ORDER BY r.name), ARRAY[]::text[]) AS missing_quota_ledger_columns
FROM required r
WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'quota_ledger'
      AND c.column_name = r.name
);

WITH required(name) AS (
    VALUES
        ('actor_user_id'), ('organization_id'), ('action'), ('target_type'),
        ('target_id'), ('status'), ('reason'), ('metadata'), ('created_at')
)
SELECT COALESCE(array_agg(r.name ORDER BY r.name), ARRAY[]::text[]) AS missing_audit_log_columns
FROM required r
WHERE NOT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'audit_logs'
      AND c.column_name = r.name
);

SELECT array_agg(code ORDER BY code) AS plan_codes
FROM plans
WHERE code IN (
    'free_jobseeker', 'pro_jobseeker', 'free_recruiter',
    'pro_recruiter', 'platform_admin'
);

SELECT p.code, q.daily_search_limit, q.daily_message_draft_limit,
       q.daily_real_apply_limit, q.daily_real_message_limit,
       q.per_run_limit, q.monthly_credit_limit
FROM plans p
JOIN quotas q ON q.plan_id = p.id
WHERE p.code IN (
    'free_jobseeker', 'pro_jobseeker', 'free_recruiter',
    'pro_recruiter', 'platform_admin'
)
ORDER BY p.code;

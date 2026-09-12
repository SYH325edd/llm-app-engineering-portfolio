-- LakeJob Core V1 PostgreSQL Schema
-- Scope: domain model and database skeleton only.
-- No business logic, API, AI, search, chat automation, or frontend is implemented here.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- Common timestamp trigger
-- ============================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- Platforms and accounts
-- ============================================================

CREATE TABLE platforms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'job_board',
    base_url TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT platforms_status_chk CHECK (status IN ('active', 'disabled', 'deprecated', 'archived'))
);

CREATE TABLE accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    account_type TEXT NOT NULL,
    display_name TEXT NOT NULL,
    external_account_id TEXT,
    profile_ref TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT accounts_type_chk CHECK (account_type IN ('job_seeker', 'recruiter', 'admin', 'system', 'unknown')),
    CONSTRAINT accounts_status_chk CHECK (status IN ('active', 'inactive', 'locked', 'expired', 'disabled', 'archived'))
);

CREATE UNIQUE INDEX accounts_platform_external_uidx
    ON accounts(platform_id, external_account_id)
    WHERE external_account_id IS NOT NULL;

CREATE INDEX accounts_platform_idx ON accounts(platform_id);
CREATE INDEX accounts_status_idx ON accounts(status);

CREATE TABLE platform_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    session_type TEXT NOT NULL DEFAULT 'browser',
    profile_dir TEXT,
    storage_state_ref TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    last_checked_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT platform_sessions_type_chk CHECK (session_type IN ('browser', 'api', 'cookie', 'manual')),
    CONSTRAINT platform_sessions_status_chk CHECK (status IN ('active', 'expired', 'invalid', 'disabled', 'archived'))
);

CREATE INDEX platform_sessions_account_idx ON platform_sessions(account_id);
CREATE INDEX platform_sessions_platform_idx ON platform_sessions(platform_id);
CREATE INDEX platform_sessions_account_type_idx ON platform_sessions(account_id, session_type);

-- ============================================================
-- Jobs and candidates
-- ============================================================

CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    external_job_id TEXT,
    source_url TEXT,
    title TEXT NOT NULL,
    company_name TEXT,
    salary_min NUMERIC(12, 2),
    salary_max NUMERIC(12, 2),
    salary_text TEXT,
    currency TEXT NOT NULL DEFAULT 'CNY',
    city TEXT,
    location TEXT,
    experience_text TEXT,
    education_text TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT jobs_status_chk CHECK (status IN ('active', 'archived', 'closed', 'deleted')),
    CONSTRAINT jobs_salary_chk CHECK (
        salary_min IS NULL OR salary_max IS NULL OR salary_min <= salary_max
    )
);

CREATE UNIQUE INDEX jobs_platform_external_uidx
    ON jobs(platform_id, external_job_id)
    WHERE external_job_id IS NOT NULL;

CREATE INDEX jobs_platform_idx ON jobs(platform_id);
CREATE INDEX jobs_account_idx ON jobs(account_id);
CREATE INDEX jobs_status_idx ON jobs(status);
CREATE INDEX jobs_city_idx ON jobs(city);
CREATE INDEX jobs_company_idx ON jobs(company_name);
CREATE INDEX jobs_created_at_idx ON jobs(created_at);
CREATE INDEX jobs_raw_data_gin_idx ON jobs USING GIN(raw_data);

CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    external_candidate_id TEXT,
    source_url TEXT,
    name TEXT NOT NULL,
    headline TEXT,
    current_company TEXT,
    current_title TEXT,
    city TEXT,
    location TEXT,
    experience_text TEXT,
    education_text TEXT,
    skills JSONB NOT NULL DEFAULT '[]'::jsonb,
    resume_text TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT candidates_status_chk CHECK (status IN ('active', 'archived', 'unavailable', 'deleted'))
);

CREATE UNIQUE INDEX candidates_platform_external_uidx
    ON candidates(platform_id, external_candidate_id)
    WHERE external_candidate_id IS NOT NULL;

CREATE INDEX candidates_platform_idx ON candidates(platform_id);
CREATE INDEX candidates_account_idx ON candidates(account_id);
CREATE INDEX candidates_status_idx ON candidates(status);
CREATE INDEX candidates_city_idx ON candidates(city);
CREATE INDEX candidates_company_idx ON candidates(current_company);
CREATE INDEX candidates_created_at_idx ON candidates(created_at);
CREATE INDEX candidates_skills_gin_idx ON candidates USING GIN(skills);
CREATE INDEX candidates_raw_data_gin_idx ON candidates USING GIN(raw_data);

-- ============================================================
-- Applications, conversations, messages
-- ============================================================

CREATE TABLE applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
    direction TEXT NOT NULL,
    external_application_id TEXT,
    stage TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    submitted_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT applications_direction_chk CHECK (direction IN ('jobradar', 'recruitradar', 'core')),
    CONSTRAINT applications_status_chk CHECK (
        status IN ('draft', 'pending', 'submitted', 'responded', 'rejected', 'withdrawn', 'archived')
    )
);

CREATE UNIQUE INDEX applications_platform_external_uidx
    ON applications(platform_id, external_application_id)
    WHERE external_application_id IS NOT NULL;

CREATE INDEX applications_platform_idx ON applications(platform_id);
CREATE INDEX applications_account_idx ON applications(account_id);
CREATE INDEX applications_job_idx ON applications(job_id);
CREATE INDEX applications_candidate_idx ON applications(candidate_id);
CREATE INDEX applications_status_idx ON applications(status);
CREATE INDEX applications_job_candidate_direction_idx ON applications(job_id, candidate_id, direction);
CREATE INDEX applications_metadata_gin_idx ON applications USING GIN(metadata);

CREATE TABLE conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    candidate_id UUID REFERENCES candidates(id) ON DELETE SET NULL,
    external_conversation_id TEXT,
    subject_type TEXT NOT NULL DEFAULT 'general',
    subject_id UUID,
    counterparty_name TEXT,
    counterparty_role TEXT NOT NULL DEFAULT 'unknown',
    last_message_at TIMESTAMPTZ,
    last_message_preview TEXT,
    unread_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT conversations_subject_type_chk CHECK (
        subject_type IN ('job', 'candidate', 'application', 'general')
    ),
    CONSTRAINT conversations_counterparty_role_chk CHECK (
        counterparty_role IN ('hr', 'candidate', 'recruiter', 'system', 'unknown')
    ),
    CONSTRAINT conversations_status_chk CHECK (status IN ('active', 'paused', 'closed', 'archived')),
    CONSTRAINT conversations_unread_count_chk CHECK (unread_count >= 0)
);

CREATE UNIQUE INDEX conversations_platform_external_uidx
    ON conversations(platform_id, external_conversation_id)
    WHERE external_conversation_id IS NOT NULL;

CREATE INDEX conversations_platform_idx ON conversations(platform_id);
CREATE INDEX conversations_account_idx ON conversations(account_id);
CREATE INDEX conversations_application_idx ON conversations(application_id);
CREATE INDEX conversations_job_idx ON conversations(job_id);
CREATE INDEX conversations_candidate_idx ON conversations(candidate_id);
CREATE INDEX conversations_status_idx ON conversations(status);
CREATE INDEX conversations_last_message_idx ON conversations(last_message_at);
CREATE INDEX conversations_subject_idx ON conversations(subject_type, subject_id);
CREATE INDEX conversations_metadata_gin_idx ON conversations USING GIN(metadata);

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    external_message_id TEXT,
    sender_type TEXT NOT NULL DEFAULT 'unknown',
    sender_name TEXT,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    direction TEXT NOT NULL,
    sent_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'received',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT messages_sender_type_chk CHECK (sender_type IN ('self', 'counterparty', 'system', 'ai', 'unknown')),
    CONSTRAINT messages_content_type_chk CHECK (content_type IN ('text', 'image', 'file', 'system', 'unknown')),
    CONSTRAINT messages_direction_chk CHECK (direction IN ('inbound', 'outbound', 'internal')),
    CONSTRAINT messages_status_chk CHECK (status IN ('draft', 'sent', 'received', 'failed', 'deleted'))
);

CREATE UNIQUE INDEX messages_platform_external_uidx
    ON messages(platform_id, external_message_id)
    WHERE external_message_id IS NOT NULL;

CREATE INDEX messages_conversation_idx ON messages(conversation_id);
CREATE INDEX messages_platform_idx ON messages(platform_id);
CREATE INDEX messages_account_idx ON messages(account_id);
CREATE INDEX messages_sent_at_idx ON messages(sent_at);
CREATE INDEX messages_status_idx ON messages(status);
CREATE INDEX messages_metadata_gin_idx ON messages USING GIN(metadata);

-- ============================================================
-- Strategies, matching, tasks
-- ============================================================

CREATE TABLE strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    platform_id UUID REFERENCES platforms(id) ON DELETE SET NULL,
    strategy_type TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    config JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'draft',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT strategies_type_chk CHECK (
        strategy_type IN ('search', 'chat', 'match', 'schedule', 'rate_limit', 'custom')
    ),
    CONSTRAINT strategies_status_chk CHECK (status IN ('active', 'draft', 'disabled', 'archived'))
);

CREATE INDEX strategies_account_idx ON strategies(account_id);
CREATE INDEX strategies_platform_idx ON strategies(platform_id);
CREATE INDEX strategies_type_idx ON strategies(strategy_type);
CREATE INDEX strategies_status_idx ON strategies(status);
CREATE INDEX strategies_config_gin_idx ON strategies USING GIN(config);

CREATE TABLE match_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    application_id UUID REFERENCES applications(id) ON DELETE SET NULL,
    strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
    score NUMERIC(6, 3) NOT NULL,
    score_type TEXT NOT NULL DEFAULT 'manual',
    summary TEXT,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    computed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT match_scores_score_chk CHECK (score >= 0),
    CONSTRAINT match_scores_type_chk CHECK (score_type IN ('manual', 'rule', 'ai', 'hybrid')),
    CONSTRAINT match_scores_status_chk CHECK (status IN ('active', 'stale', 'archived'))
);

CREATE INDEX match_scores_job_idx ON match_scores(job_id);
CREATE INDEX match_scores_candidate_idx ON match_scores(candidate_id);
CREATE INDEX match_scores_application_idx ON match_scores(application_id);
CREATE INDEX match_scores_strategy_idx ON match_scores(strategy_id);
CREATE INDEX match_scores_status_idx ON match_scores(status);
CREATE INDEX match_scores_job_candidate_strategy_idx ON match_scores(job_id, candidate_id, strategy_id);
CREATE INDEX match_scores_details_gin_idx ON match_scores USING GIN(details);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID REFERENCES platforms(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    strategy_id UUID REFERENCES strategies(id) ON DELETE SET NULL,
    task_type TEXT NOT NULL,
    name TEXT NOT NULL,
    schedule_type TEXT NOT NULL DEFAULT 'manual',
    schedule_expr TEXT,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'scheduled',
    last_run_at TIMESTAMPTZ,
    next_run_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tasks_type_chk CHECK (
        task_type IN ('search_jobs', 'search_candidates', 'sync_messages', 'auto_chat', 'match', 'cleanup', 'custom')
    ),
    CONSTRAINT tasks_schedule_type_chk CHECK (schedule_type IN ('manual', 'interval', 'cron', 'event')),
    CONSTRAINT tasks_status_chk CHECK (
        status IN ('scheduled', 'running', 'paused', 'failed', 'completed', 'cancelled')
    )
);

CREATE INDEX tasks_platform_idx ON tasks(platform_id);
CREATE INDEX tasks_account_idx ON tasks(account_id);
CREATE INDEX tasks_strategy_idx ON tasks(strategy_id);
CREATE INDEX tasks_type_idx ON tasks(task_type);
CREATE INDEX tasks_status_idx ON tasks(status);
CREATE INDEX tasks_next_run_at_idx ON tasks(next_run_at);
CREATE INDEX tasks_payload_gin_idx ON tasks USING GIN(payload);

CREATE TABLE task_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'running',
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    result JSONB NOT NULL DEFAULT '{}'::jsonb,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT task_runs_status_chk CHECK (
        status IN ('running', 'failed', 'completed', 'cancelled')
    )
);

CREATE INDEX task_runs_task_idx ON task_runs(task_id);
CREATE INDEX task_runs_status_idx ON task_runs(status);
CREATE INDEX task_runs_started_at_idx ON task_runs(started_at);
CREATE INDEX task_runs_result_gin_idx ON task_runs USING GIN(result);

-- ============================================================
-- Tags and pools
-- ============================================================

CREATE TABLE tags (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    color TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT tags_status_chk CHECK (status IN ('active', 'archived'))
);

CREATE INDEX tags_status_idx ON tags(status);
CREATE INDEX tags_metadata_gin_idx ON tags USING GIN(metadata);

CREATE TABLE taggings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT taggings_entity_type_chk CHECK (
        entity_type IN ('job', 'candidate', 'application', 'conversation', 'message', 'task', 'strategy', 'account')
    ),
    CONSTRAINT taggings_status_chk CHECK (status IN ('active', 'archived'))
);

CREATE UNIQUE INDEX taggings_unique_idx ON taggings(tag_id, entity_type, entity_id);
CREATE INDEX taggings_tag_idx ON taggings(tag_id);
CREATE INDEX taggings_entity_idx ON taggings(entity_type, entity_id);
CREATE INDEX taggings_status_idx ON taggings(status);

CREATE TABLE pools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    pool_type TEXT NOT NULL,
    product TEXT NOT NULL DEFAULT 'core',
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pools_type_chk CHECK (pool_type IN ('job', 'candidate')),
    CONSTRAINT pools_product_chk CHECK (product IN ('core', 'jobradar', 'recruitradar')),
    CONSTRAINT pools_status_chk CHECK (status IN ('active', 'archived'))
);

CREATE INDEX pools_account_idx ON pools(account_id);
CREATE INDEX pools_type_idx ON pools(pool_type);
CREATE INDEX pools_product_idx ON pools(product);
CREATE INDEX pools_status_idx ON pools(status);
CREATE UNIQUE INDEX pools_account_type_name_uidx ON pools(account_id, pool_type, name)
    WHERE account_id IS NOT NULL;
CREATE INDEX pools_metadata_gin_idx ON pools USING GIN(metadata);

CREATE TABLE pool_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pool_id UUID NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL,
    job_id UUID REFERENCES jobs(id) ON DELETE CASCADE,
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active',
    note TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pool_items_type_chk CHECK (item_type IN ('job', 'candidate')),
    CONSTRAINT pool_items_status_chk CHECK (status IN ('active', 'archived', 'removed')),
    CONSTRAINT pool_items_target_chk CHECK (
        (item_type = 'job' AND job_id IS NOT NULL AND candidate_id IS NULL)
        OR
        (item_type = 'candidate' AND candidate_id IS NOT NULL AND job_id IS NULL)
    )
);

CREATE INDEX pool_items_pool_idx ON pool_items(pool_id);
CREATE INDEX pool_items_job_idx ON pool_items(job_id);
CREATE INDEX pool_items_candidate_idx ON pool_items(candidate_id);
CREATE INDEX pool_items_status_idx ON pool_items(status);
CREATE UNIQUE INDEX pool_items_unique_job_idx ON pool_items(pool_id, job_id)
    WHERE job_id IS NOT NULL;
CREATE UNIQUE INDEX pool_items_unique_candidate_idx ON pool_items(pool_id, candidate_id)
    WHERE candidate_id IS NOT NULL;
CREATE INDEX pool_items_metadata_gin_idx ON pool_items USING GIN(metadata);

-- ============================================================
-- Logs
-- ============================================================

CREATE TABLE logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform_id UUID REFERENCES platforms(id) ON DELETE SET NULL,
    account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    log_type TEXT NOT NULL,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT logs_type_chk CHECK (log_type IN ('audit', 'system', 'task', 'platform', 'error', 'security')),
    CONSTRAINT logs_level_chk CHECK (level IN ('debug', 'info', 'warning', 'error', 'critical')),
    CONSTRAINT logs_status_chk CHECK (status IN ('active', 'archived'))
);

CREATE INDEX logs_platform_idx ON logs(platform_id);
CREATE INDEX logs_account_idx ON logs(account_id);
CREATE INDEX logs_task_idx ON logs(task_id);
CREATE INDEX logs_conversation_idx ON logs(conversation_id);
CREATE INDEX logs_type_idx ON logs(log_type);
CREATE INDEX logs_level_idx ON logs(level);
CREATE INDEX logs_created_at_idx ON logs(created_at);
CREATE INDEX logs_entity_idx ON logs(entity_type, entity_id);
CREATE INDEX logs_payload_gin_idx ON logs USING GIN(payload);

-- ============================================================
-- updated_at triggers
-- ============================================================

CREATE TRIGGER platforms_set_updated_at
    BEFORE UPDATE ON platforms
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER accounts_set_updated_at
    BEFORE UPDATE ON accounts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER platform_sessions_set_updated_at
    BEFORE UPDATE ON platform_sessions
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER jobs_set_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER candidates_set_updated_at
    BEFORE UPDATE ON candidates
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER applications_set_updated_at
    BEFORE UPDATE ON applications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER conversations_set_updated_at
    BEFORE UPDATE ON conversations
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER messages_set_updated_at
    BEFORE UPDATE ON messages
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER strategies_set_updated_at
    BEFORE UPDATE ON strategies
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER match_scores_set_updated_at
    BEFORE UPDATE ON match_scores
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tasks_set_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER task_runs_set_updated_at
    BEFORE UPDATE ON task_runs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER tags_set_updated_at
    BEFORE UPDATE ON tags
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER taggings_set_updated_at
    BEFORE UPDATE ON taggings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pools_set_updated_at
    BEFORE UPDATE ON pools
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER pool_items_set_updated_at
    BEFORE UPDATE ON pool_items
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER logs_set_updated_at
    BEFORE UPDATE ON logs
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

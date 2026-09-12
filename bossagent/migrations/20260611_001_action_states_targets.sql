BEGIN;

ALTER TABLE applications DROP CONSTRAINT IF EXISTS applications_status_chk;
ALTER TABLE applications ADD CONSTRAINT applications_status_chk CHECK (
    status IN ('draft', 'pending_confirmation', 'applying', 'applied', 'failed',
               'blocked_by_safety', 'blocked_by_quota', 'cancelled',
               'pending', 'submitted', 'responded', 'rejected', 'withdrawn', 'archived')
);

ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_status_chk;
ALTER TABLE messages ADD CONSTRAINT messages_status_chk CHECK (
    status IN ('draft', 'pending_confirmation', 'queued', 'blocked_by_safety',
               'blocked_by_quota', 'sending', 'sent', 'received', 'failed',
               'cancelled', 'deleted')
);

CREATE TABLE IF NOT EXISTS platform_targets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('job', 'candidate', 'conversation')),
    entity_id UUID,
    source_url TEXT,
    platform_external_id TEXT,
    vision_locator JSONB,
    details_confirmed_at TIMESTAMPTZ,
    confirmation_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
    can_real_apply BOOLEAN NOT NULL DEFAULT false,
    can_real_message BOOLEAN NOT NULL DEFAULT false,
    reason_if_not_actionable TEXT NOT NULL DEFAULT 'details_not_confirmed',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS platform_targets_entity_idx ON platform_targets(entity_type, entity_id);

ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE task_runs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ;

COMMIT;

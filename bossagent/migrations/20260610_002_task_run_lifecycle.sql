BEGIN;

ALTER TABLE task_runs
    ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS task_type TEXT,
    ADD COLUMN IF NOT EXISTS result_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quota_consumed INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS error_code TEXT;

UPDATE task_runs tr
SET task_type = t.task_type
FROM tasks t
WHERE tr.task_id = t.id AND tr.task_type IS NULL;

ALTER TABLE task_runs
    ALTER COLUMN task_type SET NOT NULL;

ALTER TABLE task_runs DROP CONSTRAINT IF EXISTS task_runs_status_chk;
ALTER TABLE task_runs
    ADD CONSTRAINT task_runs_status_chk CHECK (
        status IN (
            'running', 'completed', 'failed', 'paused', 'quota_blocked',
            'safety_blocked', 'cancelled'
        )
    );

CREATE INDEX IF NOT EXISTS task_runs_user_time_idx ON task_runs(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS task_runs_org_time_idx ON task_runs(organization_id, started_at DESC);
CREATE INDEX IF NOT EXISTS task_runs_type_time_idx ON task_runs(task_type, started_at DESC);

COMMIT;

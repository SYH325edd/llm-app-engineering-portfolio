BEGIN;

CREATE TABLE IF NOT EXISTS account_pauses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'system',
    screenshot_path TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at TIMESTAMPTZ
);

ALTER TABLE account_pauses ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE account_pauses ADD COLUMN IF NOT EXISTS screenshot_path TEXT;
ALTER TABLE account_pauses ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
UPDATE account_pauses
SET source = COALESCE(source, 'system'),
    screenshot_path = COALESCE(screenshot_path, '')
WHERE source IS NULL OR screenshot_path IS NULL;
ALTER TABLE account_pauses ALTER COLUMN source SET DEFAULT 'system';
ALTER TABLE account_pauses ALTER COLUMN source SET NOT NULL;
ALTER TABLE account_pauses ALTER COLUMN screenshot_path SET DEFAULT '';
ALTER TABLE account_pauses ALTER COLUMN screenshot_path SET NOT NULL;

CREATE INDEX IF NOT EXISTS account_pauses_account_idx ON account_pauses(account_id);
CREATE INDEX IF NOT EXISTS account_pauses_open_idx ON account_pauses(created_at DESC) WHERE resolved_at IS NULL;

COMMIT;

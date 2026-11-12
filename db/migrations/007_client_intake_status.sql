-- Client intake (SPEC 5.1a): only 'active' clients receive prompts; Totty presses Go to activate.
-- Existing clients are backfilled as active so nothing already running stops; new clients start at 'inquiry'.
ALTER TABLE client ADD COLUMN intake_status text NOT NULL DEFAULT 'active'
    CHECK (intake_status IN ('inquiry', 'paperwork_sent', 'paperwork_received', 'consult_scheduled', 'ready', 'active'));
ALTER TABLE client ALTER COLUMN intake_status SET DEFAULT 'inquiry';
ALTER TABLE client ADD COLUMN activated_at timestamptz;
UPDATE client SET activated_at = created_at WHERE intake_status = 'active';

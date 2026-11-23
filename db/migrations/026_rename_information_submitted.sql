-- Rename intake status paperwork_received -> information_submitted.
ALTER TABLE client DROP CONSTRAINT IF EXISTS client_intake_status_check;
UPDATE client SET intake_status = 'information_submitted' WHERE intake_status = 'paperwork_received';
ALTER TABLE client ADD CONSTRAINT client_intake_status_check
  CHECK (intake_status IN ('inquiry', 'information_submitted', 'baseline', 'active'));

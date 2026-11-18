-- Client status flow: reached out (inquiry) -> information submitted (paperwork_received) -> baseline -> active.
-- Baseline = prompts are running (first week) until the first check-in appointment; active = after that.
ALTER TABLE client DROP CONSTRAINT IF EXISTS client_intake_status_check;
UPDATE client SET intake_status = CASE intake_status
  WHEN 'paperwork_sent' THEN 'inquiry'
  WHEN 'consult_scheduled' THEN 'paperwork_received'
  WHEN 'ready' THEN 'baseline'
  ELSE intake_status END;
ALTER TABLE client ADD CONSTRAINT client_intake_status_check
  CHECK (intake_status IN ('inquiry', 'paperwork_received', 'baseline', 'active'));
-- Parents' information page (/info/<token>): an unguessable per-client link; Submit moves the client forward.
ALTER TABLE client ADD COLUMN info_token text NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
ALTER TABLE client ADD CONSTRAINT client_info_token_key UNIQUE (info_token);
ALTER TABLE client ADD COLUMN info_submitted_at timestamptz;
ALTER TABLE client ADD COLUMN baseline_started_at timestamptz;

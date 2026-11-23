-- Appointments are entered by hand (SPEC 5.7b): status is scheduled / held / missed / cancelled, source is manual / portal,
-- and a held meeting carries an outcome note. The Google Calendar sync is gone, so its source value goes too.
ALTER TABLE appointment ADD COLUMN outcome_note text;
ALTER TABLE appointment ADD COLUMN held_at timestamptz;
ALTER TABLE appointment DROP CONSTRAINT appointment_status_check;
UPDATE appointment SET status = 'held', held_at = COALESCE(starts_at, updated_at) WHERE status = 'completed';
ALTER TABLE appointment ADD CONSTRAINT appointment_status_check CHECK (status IN ('scheduled', 'held', 'missed', 'cancelled'));
UPDATE appointment SET source = 'manual' WHERE source NOT IN ('manual', 'portal');
ALTER TABLE appointment ALTER COLUMN source SET DEFAULT 'manual';
ALTER TABLE appointment ADD CONSTRAINT appointment_source_check CHECK (source IN ('manual', 'portal'));

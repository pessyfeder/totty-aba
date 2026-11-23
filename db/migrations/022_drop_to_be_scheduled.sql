-- Appointments now always have a date, so the "to be scheduled" status (and the optional starts_at) goes away.
DELETE FROM appointment WHERE status = 'to_be_scheduled' OR starts_at IS NULL;
ALTER TABLE appointment ALTER COLUMN starts_at SET NOT NULL;
ALTER TABLE appointment DROP CONSTRAINT appointment_status_check;
ALTER TABLE appointment ADD CONSTRAINT appointment_status_check
    CHECK (status IN ('scheduled', 'missed', 'completed', 'cancelled'));

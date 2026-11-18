-- Appointment tracking on the client page: to be scheduled / scheduled / missed / completed (plus cancelled from the calendar sync).
-- A "to be scheduled" appointment has no time yet, so starts_at becomes optional.
ALTER TABLE appointment ALTER COLUMN starts_at DROP NOT NULL;
ALTER TABLE appointment DROP CONSTRAINT appointment_status_check;
ALTER TABLE appointment ADD CONSTRAINT appointment_status_check
    CHECK (status IN ('to_be_scheduled', 'scheduled', 'missed', 'completed', 'cancelled'));

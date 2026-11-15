-- Appointments (SPEC 5.7b): read-only sync from Google Calendar. The app never writes to the calendar.
-- client_id is NULL while no contact email matches the booker; the next sync links it once one does.
CREATE TABLE appointment (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinician_id  uuid NOT NULL REFERENCES clinician(id) ON DELETE CASCADE,
    client_id     uuid REFERENCES client(id) ON DELETE SET NULL,
    external_id   text NOT NULL,
    type          text NOT NULL DEFAULT 'ongoing meeting',
    starts_at     timestamptz NOT NULL,
    ends_at       timestamptz,
    status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled')),
    source        text NOT NULL DEFAULT 'calendar_sync',
    title         text,
    attendee_emails text[] NOT NULL DEFAULT '{}',
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (clinician_id, external_id)
);
CREATE INDEX appointment_upcoming_idx ON appointment (clinician_id, starts_at);
CREATE INDEX appointment_client_idx ON appointment (client_id, starts_at DESC);

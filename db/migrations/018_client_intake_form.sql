-- Online new-client intake form (SPEC 5.1a): one general public form. Each submission is stored here, then copied into a
-- client's profile (automatically when one client has the child's name, otherwise when Yisroel picks or creates the client).
ALTER TABLE client ADD COLUMN intake_form jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE intake_submission (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_first_name  text NOT NULL,
    child_last_name   text NOT NULL,
    form              jsonb NOT NULL,
    submitted_at      timestamptz NOT NULL DEFAULT now(),
    client_id         uuid REFERENCES client(id) ON DELETE SET NULL,
    imported_at       timestamptz
);
CREATE INDEX intake_submission_pending_idx ON intake_submission (submitted_at) WHERE client_id IS NULL;

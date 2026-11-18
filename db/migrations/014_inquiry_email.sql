-- First reply to a new inquiry (SPEC 5.1a): drafted when a client is at "reached out", carrying the link to the client
-- information form (Settings). Sent only after Totty approves it. One per client; same life cycle as consult_email.
CREATE TABLE inquiry_email (
    client_id    uuid PRIMARY KEY REFERENCES client(id) ON DELETE CASCADE,
    status       text NOT NULL DEFAULT 'pending_approval'
                 CHECK (status IN ('pending_approval', 'approved', 'sending', 'sent', 'cancelled', 'failed')),
    to_email     text,
    provider_id  text,
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    approved_at  timestamptz,
    sent_at      timestamptz
);
CREATE INDEX inquiry_email_status_idx ON inquiry_email (status);

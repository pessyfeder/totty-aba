-- Initial consultation email (SPEC 5.7b): created as a draft when intake paperwork is received, sent only after
-- Totty approves it. One per client. The text is built from live data at review/send time; only the outcome is kept.
CREATE TABLE consult_email (
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
CREATE INDEX consult_email_status_idx ON consult_email (status);

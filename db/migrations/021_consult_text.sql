-- Initial consultation text: drafted when the client reaches "information submitted" (paperwork_received), sent only
-- after Totty approves it, alongside the consultation email (011). One per client. The text is built from live data
-- at review/send time; only the outcome is kept. 'cancelled' is shown as "Declined".
CREATE TABLE consult_text (
    client_id    uuid PRIMARY KEY REFERENCES client(id) ON DELETE CASCADE,
    status       text NOT NULL DEFAULT 'pending_approval'
                 CHECK (status IN ('pending_approval', 'approved', 'sending', 'sent', 'cancelled', 'failed')),
    to_phone     text,
    provider_id  text,
    attempts     integer NOT NULL DEFAULT 0,
    last_error   text,
    next_attempt_at timestamptz,  -- after a failed send, no retry before this time
    created_at   timestamptz NOT NULL DEFAULT now(),
    approved_at  timestamptz,
    sent_at      timestamptz
);
CREATE INDEX consult_text_status_idx ON consult_text (status);

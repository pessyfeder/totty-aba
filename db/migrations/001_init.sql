-- BTB - Behavior Treating Behavior: initial schema (SPEC.md section 6).
-- PostgreSQL 13+ (gen_random_uuid is built in).

CREATE TABLE clinician (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    email          text NOT NULL UNIQUE,
    password_hash  text NOT NULL,
    timezone       text NOT NULL,                 -- IANA, e.g. America/New_York
    location_name  text,
    latitude       numeric(9,6),                  -- Totty's own location, for the app lock (5.3)
    longitude      numeric(9,6),
    in_israel      boolean NOT NULL DEFAULT false,
    settings_json  jsonb NOT NULL DEFAULT '{
        "nightfall_minutes_after_sunset": 72,
        "candle_lighting_minutes_before_sunset": 18,
        "deferred_prompt_policy": "send_latest_only",
        "quiet_hours": {"start": "08:00", "end": "21:00"},
        "reminder_after_hours": 3,
        "late_reply_window_hours": 24,
        "report_link_expiry_days": 14,
        "rating_followup_comment": false
    }'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE client (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinician_id          uuid NOT NULL REFERENCES clinician(id),
    first_name            text NOT NULL,
    last_name             text NOT NULL,
    gender                text,
    dob                   date,                   -- age is derived from dob, not stored
    admission_date        date NOT NULL,
    notes                 text,
    -- Per-client location drives the Shabbos / Yom Tov window (5.3).
    location_name         text,
    latitude              numeric(9,6),
    longitude             numeric(9,6),
    timezone              text NOT NULL,
    in_israel             boolean NOT NULL DEFAULT false,   -- diaspora vs Israel Yom Tov observance
    candle_lighting_minutes integer,              -- NULL = use clinician default (18)
    status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at            timestamptz NOT NULL DEFAULT now(),
    updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX client_clinician_idx ON client (clinician_id, status);
CREATE INDEX client_name_idx ON client (lower(last_name), lower(first_name));

CREATE TABLE incentive (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id  uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    name       text NOT NULL,
    note       text
);
CREATE INDEX incentive_client_idx ON incentive (client_id);

CREATE TABLE contact (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id           uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    name                text NOT NULL,
    relationship        text,
    phone               text,                     -- E.164
    email               text,
    preferred_channel   text NOT NULL DEFAULT 'sms' CHECK (preferred_channel IN ('sms', 'call')),
    language            text NOT NULL DEFAULT 'en',
    status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
    consent_given_at    timestamptz,              -- written parent consent to text/call (8)
    consent_note        text,
    CONSTRAINT contact_phone_e164 CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$')
);
CREATE INDEX contact_client_idx ON contact (client_id);
-- Inbound webhook lookup: which contact owns this number.
CREATE INDEX contact_phone_idx ON contact (phone);

CREATE TABLE goal (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id       uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    contact_id      uuid NOT NULL REFERENCES contact(id),
    title           text NOT NULL,
    description     text,
    response_type   text NOT NULL CHECK (response_type IN ('yes_no', 'rating')),
    channel         text NOT NULL CHECK (channel IN ('sms', 'call')),
    -- e.g. {"days": [0,1,2,3,4,5,6], "time": "18:30"}; days 0=Sunday. Client-local time.
    schedule_json   jsonb NOT NULL,
    date_added      date NOT NULL DEFAULT current_date,
    start_date      date NOT NULL,
    end_date        date,
    status          text NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'achieved', 'discontinued')),
    -- e.g. {"type": "percent_yes", "threshold": 80, "weeks": 2} or {"type": "avg_rating", "threshold": 4}
    target_json     jsonb,
    created_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT goal_dates_ok CHECK (end_date IS NULL OR end_date >= start_date)
);
CREATE INDEX goal_client_idx ON goal (client_id, status);
CREATE INDEX goal_contact_idx ON goal (contact_id);

CREATE TABLE prompt (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id          uuid NOT NULL REFERENCES goal(id) ON DELETE CASCADE,
    scheduled_for    timestamptz NOT NULL,
    prompt_date      date NOT NULL,               -- client-local date the answer belongs to
    short_code       integer,                     -- "Goal 2" disambiguation (5.4)
    sent_at          timestamptz,
    reminder_sent_at timestamptz,
    channel          text NOT NULL CHECK (channel IN ('sms', 'call')),
    status           text NOT NULL DEFAULT 'scheduled'
                     CHECK (status IN ('scheduled', 'deferred', 'sending', 'sent',
                                       'answered', 'no_response', 'skipped', 'failed')),
    attempts         integer NOT NULL DEFAULT 0,
    deferred_reason  text CHECK (deferred_reason IS NULL OR deferred_reason IN ('shabbos', 'yom_tov', 'quiet_hours')),
    -- "No prompt is sent twice": one prompt per goal per scheduled instant.
    CONSTRAINT prompt_once_per_slot UNIQUE (goal_id, scheduled_for)
);
-- Scheduler: pick due prompts every minute.
CREATE INDEX prompt_due_idx ON prompt (scheduled_for) WHERE status IN ('scheduled', 'deferred');
CREATE INDEX prompt_goal_date_idx ON prompt (goal_id, prompt_date);

CREATE TABLE response (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prompt_id     uuid NOT NULL REFERENCES prompt(id) ON DELETE CASCADE,
    received_at   timestamptz NOT NULL DEFAULT now(),
    value_bool    boolean,
    value_int     smallint CHECK (value_int IS NULL OR value_int BETWEEN 0 AND 5),
    comment       text,
    raw_text      text,
    source        text NOT NULL CHECK (source IN ('sms', 'call', 'manual')),
    parse_status  text NOT NULL DEFAULT 'parsed' CHECK (parse_status IN ('parsed', 'unparsed', 'reviewed')),
    audit_note    text,                           -- required for manual entries/edits (5.5)
    CONSTRAINT response_manual_needs_note CHECK (source <> 'manual' OR audit_note IS NOT NULL),
    CONSTRAINT response_parsed_has_value CHECK (parse_status = 'unparsed' OR value_bool IS NOT NULL OR value_int IS NOT NULL)
);
CREATE INDEX response_prompt_idx ON response (prompt_id);
-- Dashboard "unparsed replies" queue.
CREATE INDEX response_unparsed_idx ON response (received_at) WHERE parse_status = 'unparsed';

CREATE TABLE annotation (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id   uuid NOT NULL REFERENCES goal(id) ON DELETE CASCADE,
    date      date NOT NULL,
    text      text NOT NULL
);
CREATE INDEX annotation_goal_idx ON annotation (goal_id, date);

CREATE TABLE report (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id     uuid NOT NULL REFERENCES client(id) ON DELETE CASCADE,
    period_type   text NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'custom')),
    period_start  date NOT NULL,
    period_end    date NOT NULL,
    status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'sent')),
    content_json  jsonb,                          -- editable preview content
    pdf_path      text,
    sent_at       timestamptz,
    note          text,
    -- Secure link sent by SMS (5.6): store only a hash of the token.
    link_token_hash text UNIQUE,
    link_expires_at timestamptz,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT report_period_ok CHECK (period_end >= period_start)
);
CREATE INDEX report_client_idx ON report (client_id, period_end DESC);

CREATE TABLE message_log (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    direction     text NOT NULL CHECK (direction IN ('outbound', 'inbound')),
    to_from       text NOT NULL,
    body          text,
    provider_id   text,                           -- Twilio SID
    status        text NOT NULL,                  -- queued, sent, delivered, failed, received, refused
    refusal_reason text,                          -- logged when the Shabbos guard blocks a send (9.8)
    prompt_id     uuid REFERENCES prompt(id) ON DELETE SET NULL,
    report_id     uuid REFERENCES report(id) ON DELETE SET NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_log_created_idx ON message_log (created_at);
CREATE UNIQUE INDEX message_log_provider_idx ON message_log (provider_id) WHERE provider_id IS NOT NULL;

-- Append-only access/change log for PHI (8).
CREATE TABLE audit_log (
    id            bigserial PRIMARY KEY,
    clinician_id  uuid REFERENCES clinician(id),
    action        text NOT NULL,
    entity        text NOT NULL,
    entity_id     uuid,
    detail        jsonb,
    created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log (entity, entity_id);

-- Duration replaces the 0-5 rating (SPEC 5.4): a reply is Y/N or a number of minutes, and carries no comment.
ALTER TABLE goal DROP CONSTRAINT goal_response_type_check;
UPDATE goal SET response_type = 'duration' WHERE response_type = 'rating';
ALTER TABLE goal ADD CONSTRAINT goal_response_type_check CHECK (response_type IN ('yes_no', 'duration'));
UPDATE goal SET target_json = jsonb_set(target_json, '{type}', '"avg_minutes"') WHERE target_json->>'type' = 'avg_rating';

ALTER TABLE response DROP CONSTRAINT response_value_int_check;
ALTER TABLE response RENAME COLUMN value_int TO value_minutes;
ALTER TABLE response ADD CONSTRAINT response_value_minutes_check CHECK (value_minutes IS NULL OR value_minutes BETWEEN 0 AND 1440);
ALTER TABLE response DROP COLUMN comment;

ALTER TABLE clinician ALTER COLUMN settings_json SET DEFAULT '{
    "nightfall_minutes_after_sunset": 72,
    "candle_lighting_minutes_before_sunset": 18,
    "deferred_prompt_policy": "send_latest_only",
    "quiet_hours": {"start": "08:00", "end": "21:00"},
    "followup_after_minutes": 30,
    "max_followups": 3,
    "late_reply_window_hours": 24,
    "report_link_expiry_days": 14
}'::jsonb;
UPDATE clinician SET settings_json = settings_json - 'rating_followup_comment';

-- Manual entries no longer need a free-text note (the audit log still records who changed what).
ALTER TABLE response DROP CONSTRAINT response_manual_needs_note;
ALTER TABLE response DROP COLUMN audit_note;

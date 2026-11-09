-- Follow-ups replace the single 3-hour reminder: after `followup_after_minutes` (default 30) with no
-- reply, send another text, up to `max_followups` (default 3), each that long after the previous one.
ALTER TABLE prompt ADD COLUMN followups_sent integer NOT NULL DEFAULT 0 CHECK (followups_sent >= 0);
ALTER TABLE prompt ADD COLUMN last_followup_at timestamptz;
UPDATE prompt SET followups_sent = 1, last_followup_at = reminder_sent_at WHERE reminder_sent_at IS NOT NULL;

ALTER TABLE clinician ALTER COLUMN settings_json SET DEFAULT '{
    "nightfall_minutes_after_sunset": 72,
    "candle_lighting_minutes_before_sunset": 18,
    "deferred_prompt_policy": "send_latest_only",
    "quiet_hours": {"start": "08:00", "end": "21:00"},
    "followup_after_minutes": 30,
    "max_followups": 3,
    "late_reply_window_hours": 24,
    "report_link_expiry_days": 14,
    "rating_followup_comment": false
}'::jsonb;
UPDATE clinician SET settings_json = (settings_json - 'reminder_after_hours')
    || '{"followup_after_minutes": 30, "max_followups": 3}'::jsonb;

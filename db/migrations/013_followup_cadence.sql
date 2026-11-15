-- Fewer texts to parents: one follow-up after 2 hours, then a catch-up the next morning (when quiet hours end),
-- instead of up to 3 follow-ups 30 minutes apart. Only clinicians still on the old defaults are changed.
ALTER TABLE clinician ALTER COLUMN settings_json SET DEFAULT '{
    "nightfall_minutes_after_sunset": 72,
    "candle_lighting_minutes_before_sunset": 18,
    "deferred_prompt_policy": "send_latest_only",
    "quiet_hours": {"start": "08:00", "end": "21:00"},
    "followup_after_minutes": 120,
    "max_followups": 2,
    "followup_catchup_morning": true,
    "late_reply_window_hours": 24,
    "report_link_expiry_days": 14
}'::jsonb;
UPDATE clinician SET settings_json = settings_json
    || '{"followup_after_minutes": 120, "max_followups": 2}'::jsonb
 WHERE settings_json->>'followup_after_minutes' = '30' AND settings_json->>'max_followups' = '3';
UPDATE clinician SET settings_json = settings_json || '{"followup_catchup_morning": true}'::jsonb
 WHERE NOT settings_json ? 'followup_catchup_morning';

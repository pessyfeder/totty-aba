-- Development seed data only. Fake people, fake numbers.
INSERT INTO clinician (id, name, email, password_hash, timezone, location_name, latitude, longitude)
VALUES ('00000000-0000-0000-0000-000000000001', 'Totty (dev)', 'totty@example.test',
        'REPLACE_WITH_REAL_HASH', 'America/New_York', 'Brooklyn, NY', 40.6782, -73.9442);

INSERT INTO client (id, clinician_id, first_name, last_name, gender, dob, admission_date,
                    location_name, latitude, longitude, timezone)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000001',
        'Dovid', 'Cohen', 'male', '2020-03-14', '2026-09-01',
        'Lakewood, NJ', 40.0979, -74.2176, 'America/New_York');

INSERT INTO reinforcement (client_id, name, note)
VALUES ('00000000-0000-0000-0000-0000000000c1', 'bubbles', NULL),
       ('00000000-0000-0000-0000-0000000000c1', 'iPad time', '5 minute max');

INSERT INTO contact (id, client_id, name, relationship, phone, preferred_channel, consent_given_at)
VALUES ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1',
        'Mrs. Cohen', 'mother', '+15555550100', 'sms', now());

INSERT INTO goal (client_id, contact_id, title, description, response_type, channel,
                  schedule_json, start_date, target_json)
VALUES ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
        'Uses a spoon', 'Uses a spoon independently at dinner', 'yes_no', 'sms',
        '{"days": [0,1,2,3,4,5,6], "time": "18:30"}', '2026-09-08',
        '{"type": "percent_yes", "threshold": 80, "weeks": 2}'),
       ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000d1',
        'Bedtime routine', 'Follows bedtime routine with minimal prompting', 'rating', 'sms',
        '{"days": [0,1,2,3,4], "time": "20:00"}', '2026-09-08',
        '{"type": "avg_rating", "threshold": 4}');

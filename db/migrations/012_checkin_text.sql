-- Bi-weekly check-in text (SPEC 5.7a). first_message_at: when the contact first received an app message;
-- checkin_last_sent_at: when the last check-in text went out (the 14-day clock).
ALTER TABLE contact ADD COLUMN first_message_at timestamptz;
ALTER TABLE contact ADD COLUMN checkin_last_sent_at timestamptz;

UPDATE contact c SET first_message_at = s.first_sent
  FROM (SELECT g.contact_id, min(p.sent_at) AS first_sent
          FROM prompt p JOIN goal g ON g.id = p.goal_id
         WHERE p.sent_at IS NOT NULL GROUP BY g.contact_id) s
 WHERE s.contact_id = c.id;

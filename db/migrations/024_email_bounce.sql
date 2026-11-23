-- Email bounce flag (SPEC 5.4b B): a hard bounce marks the contact's address as undeliverable until Totty fixes it.
-- Cleared automatically when the contact's email is changed.
ALTER TABLE contact ADD COLUMN email_bounced_at timestamptz;
ALTER TABLE contact ADD COLUMN email_bounce_reason text;

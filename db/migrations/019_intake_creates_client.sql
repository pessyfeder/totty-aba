-- The online intake form creates the client directly (SPEC 5.1a): no waiting list of submissions, no uploaded
-- documents. The signed consent is recorded on the client (who signed, and when).
ALTER TABLE client ADD COLUMN consent_signed_at timestamptz;
ALTER TABLE client ADD COLUMN consent_signed_by text;

DROP TABLE intake_submission;
DROP TABLE client_document;

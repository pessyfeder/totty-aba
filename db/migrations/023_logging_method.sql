-- How a contact logs goal data (SPEC 5.4b): text message (default), email, or paper log.
-- logging_method_changed_at anchors the first paper check-in email (7 days after baseline starts or after the switch, if later).
ALTER TABLE contact ADD COLUMN logging_method text NOT NULL DEFAULT 'sms' CHECK (logging_method IN ('sms', 'email', 'paper'));
ALTER TABLE contact ADD COLUMN logging_method_changed_at timestamptz;

CREATE FUNCTION contact_logging_method_stamp() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.logging_method IS DISTINCT FROM OLD.logging_method THEN
    NEW.logging_method_changed_at := now();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER contact_logging_method_stamp BEFORE INSERT OR UPDATE ON contact
  FOR EACH ROW EXECUTE FUNCTION contact_logging_method_stamp();

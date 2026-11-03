-- The question parents are asked, in Totty's words (SPEC 5.4 example:
-- "Did Dovid use a spoon at dinner today?"). NULL falls back to a generic prompt built from the title.
ALTER TABLE goal ADD COLUMN question_text text;

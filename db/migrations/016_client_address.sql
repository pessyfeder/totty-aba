-- Full client address: street + number, city, state (NY or NJ).
ALTER TABLE client ADD COLUMN street_address text;
ALTER TABLE client ADD COLUMN city text;
ALTER TABLE client ADD COLUMN state text CHECK (state IN ('NY', 'NJ'));

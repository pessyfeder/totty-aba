-- Reports are bi-weekly (14 days, Sunday-Saturday x2) instead of weekly.
ALTER TABLE report DROP CONSTRAINT report_period_type_check;
UPDATE report SET period_type = 'custom' WHERE period_type = 'weekly';
ALTER TABLE report ADD CONSTRAINT report_period_type_check CHECK (period_type IN ('biweekly', 'monthly', 'custom'));

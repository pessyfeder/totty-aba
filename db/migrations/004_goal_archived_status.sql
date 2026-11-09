-- Goals can be archived (history kept, no more prompts).
ALTER TABLE goal DROP CONSTRAINT goal_status_check;
ALTER TABLE goal ADD CONSTRAINT goal_status_check
    CHECK (status IN ('active', 'paused', 'achieved', 'discontinued', 'archived'));

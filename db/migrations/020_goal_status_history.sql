-- Every goal status change is recorded with when it was made (the goal's own created_at says when it was added).
CREATE TABLE goal_status_change (
    id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    goal_id               uuid NOT NULL REFERENCES goal(id) ON DELETE CASCADE,
    from_status           text NOT NULL,
    to_status             text NOT NULL,
    change_made_datetime  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX goal_status_change_goal_idx ON goal_status_change (goal_id, change_made_datetime);

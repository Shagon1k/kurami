ALTER TABLE project_poll_state
  ADD COLUMN last_attempt_at TEXT;

ALTER TABLE project_poll_state
  ADD COLUMN last_attempt_state TEXT
    CHECK (last_attempt_state IN ('succeeded', 'failed'));

ALTER TABLE project_poll_state
  ADD COLUMN last_error TEXT;

UPDATE project_poll_state
SET last_attempt_at = last_captured_at,
    last_attempt_state = 'succeeded'
WHERE last_attempt_state IS NULL;

ALTER TABLE runs ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'dry_run'
  CHECK (execution_mode IN ('dry_run', 'live'));

ALTER TABLE runs ADD COLUMN previous_run_id TEXT
  REFERENCES runs(run_id) ON DELETE RESTRICT;

ALTER TABLE project_events ADD COLUMN processing_note TEXT;

CREATE INDEX runs_previous_run_idx
  ON runs(previous_run_id)
  WHERE previous_run_id IS NOT NULL;

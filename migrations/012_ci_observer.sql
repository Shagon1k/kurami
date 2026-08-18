CREATE TABLE run_ci_snapshots (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  repository TEXT NOT NULL,
  pull_request_number INTEGER,
  pull_request_url TEXT,
  pull_request_title TEXT,
  head_sha TEXT,
  aggregate_state TEXT NOT NULL CHECK (aggregate_state IN (
    'pending',
    'passed',
    'failed',
    'missing',
    'unknown'
  )),
  checks_json TEXT NOT NULL CHECK (json_valid(checks_json)),
  content_digest TEXT NOT NULL,
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  completed_at TEXT,
  last_error TEXT,
  CHECK (pull_request_number IS NULL OR pull_request_number > 0),
  CHECK (head_sha IS NULL OR length(head_sha) BETWEEN 7 AND 64),
  CHECK (
    (aggregate_state IN ('passed', 'failed', 'missing') AND completed_at IS NOT NULL)
    OR
    (aggregate_state IN ('pending', 'unknown') AND completed_at IS NULL)
  )
) STRICT;

CREATE INDEX run_ci_snapshots_state_idx
  ON run_ci_snapshots(aggregate_state, last_observed_at);

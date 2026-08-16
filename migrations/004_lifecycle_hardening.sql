ALTER TABLE runs ADD COLUMN stop_reason TEXT
  CHECK (stop_reason IS NULL OR stop_reason IN ('cancelled', 'completed'));

CREATE TABLE run_attention (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  attention_kind TEXT,
  consecutive_observations INTEGER NOT NULL DEFAULT 0
    CHECK (consecutive_observations >= 0),
  notified_kind TEXT,
  first_observed_at TEXT,
  last_observed_at TEXT,
  notified_at TEXT
) STRICT;

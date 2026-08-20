CREATE TABLE project_triage_state (
  project TEXT PRIMARY KEY,
  factual_hash TEXT NOT NULL CHECK (length(factual_hash) = 64),
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
  stats_json TEXT NOT NULL CHECK (json_valid(stats_json)),
  change_sequence INTEGER NOT NULL CHECK (change_sequence > 0),
  first_observed_at TEXT NOT NULL,
  last_changed_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  source_project_captured_at TEXT
) STRICT;

CREATE TABLE project_triage_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  change_sequence INTEGER NOT NULL CHECK (change_sequence > 0),
  factual_hash TEXT NOT NULL CHECK (length(factual_hash) = 64),
  facts_json TEXT NOT NULL CHECK (json_valid(facts_json)),
  stats_json TEXT NOT NULL CHECK (json_valid(stats_json)),
  captured_at TEXT NOT NULL,
  source_project_captured_at TEXT,
  UNIQUE (project, change_sequence)
) STRICT;

CREATE INDEX project_triage_snapshots_project_idx
  ON project_triage_snapshots(project, change_sequence DESC);

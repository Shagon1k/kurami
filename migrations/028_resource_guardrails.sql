CREATE TABLE resource_quarantines (
  quarantine_id TEXT PRIMARY KEY,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('worktree', 'tmux')),
  resource_key TEXT NOT NULL,
  project TEXT,
  run_id TEXT REFERENCES runs(run_id) ON DELETE RESTRICT,
  quarantine_state TEXT NOT NULL CHECK (quarantine_state IN (
    'observed', 'quarantined', 'resolved'
  )),
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  first_observed_at TEXT NOT NULL,
  last_observed_at TEXT NOT NULL,
  quarantined_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (resource_type, resource_key)
) STRICT;

CREATE INDEX resource_quarantines_active_idx
  ON resource_quarantines(quarantine_state, last_observed_at)
  WHERE quarantine_state <> 'resolved';

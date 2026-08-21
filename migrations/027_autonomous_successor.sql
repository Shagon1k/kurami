CREATE TABLE run_autonomous_successions (
  succession_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE
    REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  succession_number INTEGER NOT NULL CHECK (succession_number > 0),
  succession_state TEXT NOT NULL CHECK (succession_state IN (
    'starting', 'running', 'parked', 'failed'
  )),
  predecessor_thread_id TEXT NOT NULL,
  successor_thread_id TEXT,
  worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  source_head_sha TEXT NOT NULL CHECK (length(source_head_sha) BETWEEN 7 AND 64),
  tmux_session_name TEXT UNIQUE,
  handoff_context_json TEXT NOT NULL CHECK (json_valid(handoff_context_json)),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (run_id, succession_number)
) STRICT;

CREATE UNIQUE INDEX run_autonomous_successions_one_active_idx
  ON run_autonomous_successions(run_id)
  WHERE succession_state IN ('starting', 'running');

CREATE INDEX run_autonomous_successions_state_idx
  ON run_autonomous_successions(succession_state, updated_at);

CREATE TABLE project_events (
  event_id TEXT PRIMARY KEY,
  observed_at TEXT NOT NULL,
  project TEXT NOT NULL,
  item_id TEXT NOT NULL,
  content_id TEXT,
  content_type TEXT NOT NULL,
  repository TEXT,
  issue_number INTEGER,
  title TEXT,
  url TEXT,
  from_status TEXT,
  to_status TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  processing_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (processing_state IN ('pending', 'processed', 'ignored', 'failed')),
  processed_at TEXT,
  processing_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (issue_number IS NULL OR issue_number > 0)
) STRICT;

CREATE INDEX project_events_pending_idx
  ON project_events(processing_state, observed_at);

CREATE INDEX project_events_item_idx
  ON project_events(project, item_id, observed_at);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  trigger_event_id TEXT NOT NULL UNIQUE
    REFERENCES project_events(event_id) ON DELETE RESTRICT,
  project TEXT NOT NULL,
  item_id TEXT NOT NULL,
  content_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  issue_number INTEGER NOT NULL CHECK (issue_number > 0),
  interaction_policy TEXT NOT NULL
    CHECK (interaction_policy IN ('autonomous', 'human_control')),
  state TEXT NOT NULL
    CHECK (state IN (
      'admission_pending',
      'rejected',
      'starting',
      'running',
      'handoff_pending',
      'waiting_human',
      'remote_owned',
      'parked_review',
      'failed',
      'stopping',
      'cancelled',
      'needs_attention',
      'archived'
    )),
  owner_state TEXT NOT NULL DEFAULT 'none'
    CHECK (owner_state IN ('none', 'cli', 'remote')),
  rejection_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT
) STRICT;

CREATE UNIQUE INDEX runs_one_live_item_idx
  ON runs(project, item_id)
  WHERE state NOT IN ('rejected', 'cancelled', 'archived');

CREATE INDEX runs_state_idx ON runs(state, project, created_at);

CREATE TABLE run_resources (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  resource_state TEXT NOT NULL DEFAULT 'planned'
    CHECK (resource_state IN (
      'planned',
      'provisioning',
      'provisioned',
      'partial',
      'releasing',
      'released',
      'not_required'
    )),
  base_sha TEXT,
  worktree_path TEXT,
  branch_name TEXT,
  codex_thread_id TEXT,
  previous_codex_thread_id TEXT,
  tmux_session_name TEXT,
  preview_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE UNIQUE INDEX run_resources_worktree_idx
  ON run_resources(worktree_path)
  WHERE worktree_path IS NOT NULL;

CREATE UNIQUE INDEX run_resources_branch_idx
  ON run_resources(branch_name)
  WHERE branch_name IS NOT NULL;

CREATE UNIQUE INDEX run_resources_tmux_idx
  ON run_resources(tmux_session_name)
  WHERE tmux_session_name IS NOT NULL;

CREATE TABLE run_state_history (
  sequence INTEGER PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  from_state TEXT,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  source_event_id TEXT REFERENCES project_events(event_id) ON DELETE RESTRICT,
  details_json TEXT CHECK (details_json IS NULL OR json_valid(details_json)),
  occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX run_state_history_run_idx
  ON run_state_history(run_id, sequence);

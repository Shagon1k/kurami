-- Close/reopen is an observation, never a fabricated board transition.
ALTER TABLE project_items ADD COLUMN issue_state TEXT;
ALTER TABLE project_events ADD COLUMN event_kind TEXT NOT NULL DEFAULT 'project_status'
  CHECK (event_kind IN ('project_status', 'issue_state'));
CREATE TABLE github_lifecycle_feedback (
  delivery_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  comment_id INTEGER,
  delivered_digest TEXT,
  create_pending INTEGER NOT NULL DEFAULT 0 CHECK (create_pending IN (0, 1)),
  delivery_error TEXT
) STRICT;
CREATE TABLE github_lifecycle_snapshots (
  delivery_key TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json))
) STRICT;

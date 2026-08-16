CREATE TABLE project_items (
  project TEXT NOT NULL,
  item_id TEXT NOT NULL,
  content_id TEXT,
  content_type TEXT,
  repository TEXT,
  issue_number INTEGER,
  title TEXT,
  url TEXT,
  status TEXT,
  present INTEGER NOT NULL DEFAULT 1 CHECK (present IN (0, 1)),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (project, item_id),
  CHECK (issue_number IS NULL OR issue_number > 0)
) STRICT;

CREATE INDEX project_items_status_idx
  ON project_items(project, present, status);

CREATE TABLE project_poll_state (
  project TEXT PRIMARY KEY,
  initialized_at TEXT NOT NULL,
  last_captured_at TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count >= 0),
  last_duration_ms INTEGER CHECK (last_duration_ms IS NULL OR last_duration_ms >= 0),
  rate_limit_remaining INTEGER,
  rate_limit_reset_at TEXT
) STRICT;

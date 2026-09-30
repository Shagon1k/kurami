CREATE TABLE project_status_requests (
  request_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  item_id TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_key TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  request_state TEXT NOT NULL CHECK (request_state IN (
    'checking', 'writing', 'awaiting_sync', 'synced', 'conflict', 'failed', 'uncertain'
  )),
  github_project_id TEXT,
  github_field_id TEXT,
  github_option_id TEXT,
  github_item_updated_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (project,item_id) REFERENCES project_items(project,item_id) ON DELETE RESTRICT
) STRICT;

CREATE UNIQUE INDEX project_status_requests_one_active_idx
  ON project_status_requests(project,item_id)
  WHERE request_state IN ('checking','writing','awaiting_sync','uncertain');
CREATE INDEX project_status_requests_item_idx ON project_status_requests(project,item_id,created_at);

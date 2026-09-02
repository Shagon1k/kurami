CREATE TABLE addon_snapshots (
  addon_id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
  state TEXT NOT NULL CHECK (state IN ('ready', 'empty', 'partial', 'stale', 'failed')),
  payload_json TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

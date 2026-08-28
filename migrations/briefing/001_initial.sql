CREATE TABLE editions (
  id TEXT PRIMARY KEY,
  edition_type TEXT NOT NULL CHECK (edition_type IN ('daily', 'cinema')),
  local_date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'complete', 'partial', 'aborted')),
  payload_json TEXT NOT NULL,
  html_path TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  preview_enabled INTEGER NOT NULL DEFAULT 1 CHECK (preview_enabled IN (0, 1)),
  is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
  prepared_at TEXT NOT NULL,
  published_at TEXT,
  retention_until TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (edition_type, local_date)
) STRICT;

CREATE UNIQUE INDEX editions_one_current_per_type
  ON editions (edition_type)
  WHERE is_current = 1;

CREATE TABLE edition_items (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('story', 'mail')),
  story_fingerprint TEXT,
  topic_ids_json TEXT NOT NULL DEFAULT '[]',
  read_at TEXT,
  reaction TEXT CHECK (reaction IS NULL OR reaction IN ('like', 'dislike')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (edition_id, item_id)
) STRICT;

CREATE TABLE source_batches (
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  min_item_id TEXT,
  max_item_id TEXT,
  item_ids_json TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL CHECK (state IN ('prepared', 'committed', 'failed', 'skipped')),
  committed_at TEXT,
  error_code TEXT,
  PRIMARY KEY (edition_id, source_key)
) STRICT;

CREATE TABLE source_checkpoints (
  source_key TEXT PRIMARY KEY,
  source_provider TEXT NOT NULL,
  last_successful_item_id TEXT,
  last_successful_at TEXT,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE topic_registry (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('active', 'proposed', 'merged')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE reaction_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_fingerprint TEXT NOT NULL,
  topic_ids_json TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction IN ('like', 'dislike', 'clear')),
  recorded_at TEXT NOT NULL
) STRICT;

CREATE INDEX reaction_events_story_time
  ON reaction_events (story_fingerprint, event_id DESC);

CREATE TABLE action_receipts (
  action_id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  item_ids_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'complete', 'partial', 'failed')),
  provider_receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

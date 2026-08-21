CREATE TABLE resource_guard_events (
  event_id TEXT PRIMARY KEY,
  quarantine_id TEXT NOT NULL
    REFERENCES resource_quarantines(quarantine_id) ON DELETE RESTRICT,
  lifecycle_started_at TEXT NOT NULL,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'observed', 'quarantined', 'review_due', 'resolved'
  )),
  resource_type TEXT NOT NULL CHECK (resource_type IN ('worktree', 'tmux')),
  resource_key TEXT NOT NULL,
  project TEXT,
  run_id TEXT REFERENCES runs(run_id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  event_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (quarantine_id, lifecycle_started_at, event_kind)
) STRICT;

CREATE INDEX resource_guard_events_created_idx
  ON resource_guard_events(created_at, event_id);

CREATE TABLE resource_guard_discord_batches (
  batch_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  nonce TEXT NOT NULL UNIQUE,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN (
    'pending', 'sending', 'delivered', 'failed'
  )),
  event_count INTEGER NOT NULL CHECK (event_count BETWEEN 1 AND 6),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
) STRICT;

CREATE INDEX resource_guard_discord_batches_delivery_idx
  ON resource_guard_discord_batches(delivery_state, updated_at);

CREATE TABLE resource_guard_discord_batch_events (
  batch_id TEXT NOT NULL
    REFERENCES resource_guard_discord_batches(batch_id) ON DELETE RESTRICT,
  event_id TEXT NOT NULL UNIQUE
    REFERENCES resource_guard_events(event_id) ON DELETE RESTRICT,
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 5),
  PRIMARY KEY (batch_id, event_id),
  UNIQUE (batch_id, ordinal)
) STRICT;

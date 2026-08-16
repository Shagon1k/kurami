ALTER TABLE run_control_events RENAME TO run_control_events_v6;

CREATE TABLE run_control_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'review_ready',
    'human_control_ready',
    'preview_ready',
    'preview_failed',
    'attention_required'
  )),
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN (
    'pending',
    'sending',
    'delivered',
    'failed',
    'cancelled'
  )),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  telegram_message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
) STRICT;

INSERT INTO run_control_events (
  event_id, run_id, event_kind, delivery_state, payload_json,
  attempt_count, telegram_message_id, last_error,
  created_at, updated_at, delivered_at
)
SELECT event_id, run_id, event_kind, delivery_state, payload_json,
       attempt_count, telegram_message_id, last_error,
       created_at, updated_at, delivered_at
FROM run_control_events_v6;

DROP TABLE run_control_events_v6;

CREATE INDEX run_control_events_delivery_idx
  ON run_control_events(delivery_state, created_at);

CREATE INDEX run_control_events_run_kind_idx
  ON run_control_events(run_id, event_kind, created_at);

CREATE TABLE run_progress_cards (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  stage TEXT NOT NULL,
  detail TEXT NOT NULL,
  content_digest TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN (
    'pending',
    'sending',
    'delivered',
    'failed',
    'cancelled'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  telegram_message_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT,
  keyboard_removed_at TEXT
) STRICT;

CREATE INDEX run_progress_cards_delivery_idx
  ON run_progress_cards(delivery_state, updated_at);

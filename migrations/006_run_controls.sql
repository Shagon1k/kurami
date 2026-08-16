CREATE TABLE run_control_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  event_kind TEXT NOT NULL CHECK (event_kind IN (
    'review_ready',
    'human_control_ready',
    'preview_ready',
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

CREATE INDEX run_control_events_delivery_idx
  ON run_control_events(delivery_state, created_at);

CREATE INDEX run_control_events_run_kind_idx
  ON run_control_events(run_id, event_kind, created_at);

CREATE TABLE run_control_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'take_control',
    'preview_start',
    'preview_stop',
    'stop'
  )),
  request_state TEXT NOT NULL DEFAULT 'pending' CHECK (request_state IN (
    'pending',
    'processing',
    'applied',
    'rejected',
    'failed'
  )),
  requested_via TEXT NOT NULL CHECK (requested_via IN ('telegram', 'cli')),
  idempotency_key TEXT NOT NULL UNIQUE,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
) STRICT;

CREATE UNIQUE INDEX run_control_requests_one_pending_action_idx
  ON run_control_requests(run_id, action)
  WHERE request_state IN ('pending', 'processing');

CREATE INDEX run_control_requests_pending_idx
  ON run_control_requests(request_state, created_at);

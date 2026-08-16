ALTER TABLE run_control_requests RENAME TO run_control_requests_v7;

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
  requested_via TEXT NOT NULL CHECK (requested_via IN (
    'telegram',
    'discord',
    'cli'
  )),
  idempotency_key TEXT NOT NULL UNIQUE,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
) STRICT;

INSERT INTO run_control_requests (
  request_id,
  run_id,
  action,
  request_state,
  requested_via,
  idempotency_key,
  result_json,
  created_at,
  updated_at,
  completed_at
)
SELECT request_id,
       run_id,
       action,
       request_state,
       requested_via,
       idempotency_key,
       result_json,
       created_at,
       updated_at,
       completed_at
FROM run_control_requests_v7;

DROP TABLE run_control_requests_v7;

CREATE UNIQUE INDEX run_control_requests_one_pending_action_idx
  ON run_control_requests(run_id, action)
  WHERE request_state IN ('pending', 'processing');

CREATE INDEX run_control_requests_pending_idx
  ON run_control_requests(request_state, created_at);

CREATE TABLE discord_transport_settings (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  activated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

INSERT INTO discord_transport_settings (singleton) VALUES (1);

CREATE TABLE run_discord_surfaces (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE RESTRICT,
  guild_id TEXT NOT NULL,
  parent_channel_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN (
    'pending',
    'provisioning',
    'active',
    'archived',
    'failed'
  )),
  live_card_message_id TEXT,
  thread_id TEXT UNIQUE,
  content_digest TEXT,
  pull_request_url TEXT,
  pull_request_title TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  archived_at TEXT,
  CHECK (
    state NOT IN ('active', 'archived')
    OR (live_card_message_id IS NOT NULL AND thread_id IS NOT NULL)
  )
) STRICT;

CREATE INDEX run_discord_surfaces_state_idx
  ON run_discord_surfaces(state, updated_at);

CREATE TABLE run_discord_event_deliveries (
  event_id TEXT PRIMARY KEY
    REFERENCES run_control_events(event_id) ON DELETE RESTRICT,
  delivery_state TEXT NOT NULL DEFAULT 'pending' CHECK (delivery_state IN (
    'pending',
    'sending',
    'delivered',
    'failed',
    'cancelled'
  )),
  message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  delivered_at TEXT
) STRICT;

CREATE INDEX run_discord_event_deliveries_state_idx
  ON run_discord_event_deliveries(delivery_state, updated_at);

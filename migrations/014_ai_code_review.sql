ALTER TABLE run_ci_repair_attempts RENAME TO run_ci_repair_attempts_v13;
ALTER TABLE run_control_requests RENAME TO run_control_requests_v13;

CREATE TABLE run_control_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'take_control',
    'preview_start',
    'preview_stop',
    'stop',
    'discard_local',
    'discard_published',
    'ci_repair',
    'ai_review'
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
FROM run_control_requests_v13;

CREATE TABLE run_ci_repair_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE
    REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
  source_head_sha TEXT NOT NULL CHECK (length(source_head_sha) BETWEEN 7 AND 64),
  source_ci_state TEXT NOT NULL CHECK (source_ci_state IN ('failed', 'missing')),
  source_checks_json TEXT NOT NULL CHECK (json_valid(source_checks_json)),
  attempt_state TEXT NOT NULL CHECK (attempt_state IN (
    'running',
    'waiting_ci',
    'succeeded',
    'failed',
    'needs_attention'
  )),
  codex_thread_id TEXT,
  result_head_sha TEXT CHECK (
    result_head_sha IS NULL OR length(result_head_sha) BETWEEN 7 AND 64
  ),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (run_id, attempt_number)
) STRICT;

INSERT INTO run_ci_repair_attempts (
  attempt_id, run_id, request_id, attempt_number, source_head_sha,
  source_ci_state, source_checks_json, attempt_state, codex_thread_id,
  result_head_sha, failure_reason, created_at, updated_at, completed_at
)
SELECT attempt_id, run_id, request_id, attempt_number, source_head_sha,
       source_ci_state, source_checks_json, attempt_state, codex_thread_id,
       result_head_sha, failure_reason, created_at, updated_at, completed_at
FROM run_ci_repair_attempts_v13;

DROP TABLE run_ci_repair_attempts_v13;
DROP TABLE run_control_requests_v13;

CREATE UNIQUE INDEX run_control_requests_one_pending_action_idx
  ON run_control_requests(run_id, action)
  WHERE request_state IN ('pending', 'processing');

CREATE INDEX run_control_requests_pending_idx
  ON run_control_requests(request_state, created_at);

CREATE INDEX run_ci_repair_attempts_state_idx
  ON run_ci_repair_attempts(attempt_state, updated_at);

CREATE TABLE run_ai_reviews (
  review_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE
    REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  review_number INTEGER NOT NULL CHECK (review_number > 0),
  review_state TEXT NOT NULL CHECK (review_state IN (
    'running',
    'ready',
    'superseded',
    'failed'
  )),
  repository TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
  pull_request_url TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  base_sha TEXT NOT NULL CHECK (length(base_sha) BETWEEN 7 AND 64),
  head_sha TEXT NOT NULL CHECK (length(head_sha) BETWEEN 7 AND 64),
  tmux_session_name TEXT NOT NULL UNIQUE,
  codex_thread_id TEXT,
  github_review_id TEXT,
  github_review_url TEXT,
  critical_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_count >= 0),
  important_count INTEGER NOT NULL DEFAULT 0 CHECK (important_count >= 0),
  suggestion_count INTEGER NOT NULL DEFAULT 0 CHECK (suggestion_count >= 0),
  findings_json TEXT CHECK (findings_json IS NULL OR json_valid(findings_json)),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (run_id, review_number)
) STRICT;

CREATE UNIQUE INDEX run_ai_reviews_one_running_idx
  ON run_ai_reviews(run_id)
  WHERE review_state = 'running';

CREATE INDEX run_ai_reviews_status_idx
  ON run_ai_reviews(review_state, updated_at);

CREATE INDEX run_ai_reviews_head_idx
  ON run_ai_reviews(run_id, head_sha, review_number DESC);

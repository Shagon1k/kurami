-- Preserve control history and dependent review evidence while adding Projects provenance.

ALTER TABLE run_review_fix_operations RENAME TO run_review_fix_operations_v32;

ALTER TABLE run_review_fix_threads RENAME TO run_review_fix_threads_v32;

ALTER TABLE run_review_fix_rounds RENAME TO run_review_fix_rounds_v32;

ALTER TABLE run_autonomous_successions RENAME TO run_autonomous_successions_v32;

ALTER TABLE run_ai_reviews RENAME TO run_ai_reviews_v32;

ALTER TABLE run_ci_repair_attempts RENAME TO run_ci_repair_attempts_v32;

ALTER TABLE run_control_requests RENAME TO run_control_requests_v32;

CREATE TABLE run_control_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'take_control', 'preview_start', 'preview_stop', 'stop',
    'discard_local', 'discard_published', 'ci_repair', 'ai_review',
    'review_fix', 'recover_managed_task'
  )),
  request_state TEXT NOT NULL DEFAULT 'pending' CHECK (request_state IN (
    'pending', 'processing', 'applied', 'rejected', 'failed'
  )),
  requested_via TEXT NOT NULL CHECK (requested_via IN ('telegram', 'discord', 'cli', 'projects')),
  idempotency_key TEXT NOT NULL UNIQUE,
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
) STRICT;

INSERT INTO run_control_requests SELECT * FROM run_control_requests_v32;

CREATE TABLE run_ci_repair_attempts (
  attempt_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 2),
  source_head_sha TEXT NOT NULL CHECK (length(source_head_sha) BETWEEN 7 AND 64),
  source_ci_state TEXT NOT NULL CHECK (source_ci_state IN ('failed', 'missing')),
  source_checks_json TEXT NOT NULL CHECK (json_valid(source_checks_json)),
  attempt_state TEXT NOT NULL CHECK (attempt_state IN ('running', 'waiting_ci', 'succeeded', 'failed', 'needs_attention')),
  codex_thread_id TEXT,
  result_head_sha TEXT CHECK (result_head_sha IS NULL OR length(result_head_sha) BETWEEN 7 AND 64),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (run_id, attempt_number)
) STRICT;

INSERT INTO run_ci_repair_attempts SELECT * FROM run_ci_repair_attempts_v32;

CREATE TABLE run_ai_reviews (
  review_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  review_number INTEGER NOT NULL CHECK (review_number > 0),
  review_state TEXT NOT NULL CHECK (review_state IN ('running', 'ready', 'superseded', 'failed')),
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

INSERT INTO run_ai_reviews SELECT * FROM run_ai_reviews_v32;

CREATE TABLE run_autonomous_successions (
  succession_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  succession_number INTEGER NOT NULL CHECK (succession_number > 0),
  succession_state TEXT NOT NULL CHECK (succession_state IN (
    'starting', 'running', 'parked', 'failed'
  )),
  predecessor_thread_id TEXT NOT NULL,
  successor_thread_id TEXT,
  worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  source_head_sha TEXT NOT NULL CHECK (length(source_head_sha) BETWEEN 7 AND 64),
  tmux_session_name TEXT UNIQUE,
  handoff_context_json TEXT NOT NULL CHECK (json_valid(handoff_context_json)),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE (run_id, succession_number)
) STRICT;

INSERT INTO run_autonomous_successions SELECT * FROM run_autonomous_successions_v32;

CREATE TABLE run_review_fix_rounds (
  round_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL UNIQUE REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  round_state TEXT NOT NULL CHECK (round_state IN (
    'running', 'waiting_ci', 'resolving', 'succeeded', 'needs_attention'
  )),
  repository TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL CHECK (pull_request_number > 0),
  pull_request_url TEXT NOT NULL,
  source_head_sha TEXT NOT NULL CHECK (length(source_head_sha) BETWEEN 7 AND 64),
  snapshot_json TEXT NOT NULL CHECK (json_valid(snapshot_json)),
  codex_thread_id TEXT,
  result_head_sha TEXT CHECK (result_head_sha IS NULL OR length(result_head_sha) BETWEEN 7 AND 64),
  resolution_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (resolution_attempt_count BETWEEN 0 AND 3),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  waiting_ci_started_at TEXT,
  UNIQUE (run_id, round_number)
) STRICT;

INSERT INTO run_review_fix_rounds SELECT * FROM run_review_fix_rounds_v32;

CREATE TABLE run_review_fix_threads (
  round_id TEXT NOT NULL REFERENCES run_review_fix_rounds(round_id) ON DELETE RESTRICT,
  thread_id TEXT NOT NULL,
  root_comment_id INTEGER NOT NULL CHECK (root_comment_id > 0),
  source_kind TEXT NOT NULL CHECK (source_kind IN ('ai', 'owner')),
  path TEXT NOT NULL,
  line INTEGER,
  thread_state TEXT NOT NULL DEFAULT 'pending' CHECK (thread_state IN (
    'pending', 'replied', 'resolved', 'failed'
  )),
  reply_comment_id INTEGER,
  failure_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (round_id, thread_id)
) STRICT;

INSERT INTO run_review_fix_threads SELECT * FROM run_review_fix_threads_v32;

CREATE TABLE run_review_fix_operations (
  round_id TEXT NOT NULL REFERENCES run_review_fix_rounds(round_id) ON DELETE RESTRICT,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN (
    'cleanup', 'managed_recovery'
  )),
  operation_state TEXT NOT NULL CHECK (operation_state IN (
    'claimed', 'side_effect_succeeded', 'completed'
  )),
  request_id TEXT REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  task_codex_thread_id TEXT NOT NULL,
  previous_codex_thread_id TEXT NOT NULL,
  tmux_session_name TEXT,
  result_head_sha TEXT CHECK (
    result_head_sha IS NULL OR length(result_head_sha) BETWEEN 7 AND 64
  ),
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  PRIMARY KEY (round_id, operation_kind),
  CHECK (
    (operation_kind = 'cleanup' AND request_id IS NULL AND tmux_session_name IS NULL)
    OR
    (operation_kind = 'managed_recovery' AND request_id IS NOT NULL AND tmux_session_name IS NOT NULL)
  )
) STRICT;

INSERT INTO run_review_fix_operations SELECT * FROM run_review_fix_operations_v32;

DROP TABLE run_review_fix_operations_v32;

DROP TABLE run_review_fix_threads_v32;

DROP TABLE run_review_fix_rounds_v32;

DROP TABLE run_autonomous_successions_v32;

DROP TABLE run_ai_reviews_v32;

DROP TABLE run_ci_repair_attempts_v32;

DROP TABLE run_control_requests_v32;

CREATE UNIQUE INDEX run_control_requests_one_pending_action_idx
  ON run_control_requests(run_id, action)
  WHERE request_state IN ('pending', 'processing');

CREATE INDEX run_control_requests_pending_idx
  ON run_control_requests(request_state, created_at);

CREATE INDEX run_ci_repair_attempts_state_idx
  ON run_ci_repair_attempts(attempt_state, updated_at);

CREATE UNIQUE INDEX run_ai_reviews_one_running_idx
  ON run_ai_reviews(run_id) WHERE review_state = 'running';

CREATE INDEX run_ai_reviews_status_idx
  ON run_ai_reviews(review_state, updated_at);

CREATE INDEX run_ai_reviews_head_idx
  ON run_ai_reviews(run_id, head_sha, review_number DESC);

CREATE UNIQUE INDEX run_autonomous_successions_one_active_idx
  ON run_autonomous_successions(run_id)
  WHERE succession_state IN ('starting', 'running');

CREATE INDEX run_autonomous_successions_state_idx
  ON run_autonomous_successions(succession_state, updated_at);

CREATE UNIQUE INDEX run_review_fix_one_active_idx
  ON run_review_fix_rounds(run_id)
  WHERE round_state IN ('running', 'waiting_ci', 'resolving');

CREATE INDEX run_review_fix_state_idx
  ON run_review_fix_rounds(round_state, updated_at);

CREATE INDEX run_review_fix_operations_state_idx
  ON run_review_fix_operations(operation_state, updated_at);

CREATE TABLE run_control_project_context (
  request_id TEXT PRIMARY KEY REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  expected_head_sha TEXT NOT NULL CHECK (length(expected_head_sha) BETWEEN 7 AND 64),
  expected_pull_request_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

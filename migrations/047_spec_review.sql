-- Add the independent Spec reviewer; preserve existing requests, reviews, fixes and retry receipts.

ALTER TABLE run_review_fix_threads RENAME TO run_review_fix_threads_v46;
ALTER TABLE run_review_fix_operations RENAME TO run_review_fix_operations_v46;
ALTER TABLE run_interrupted_review_fix_recoveries RENAME TO run_interrupted_review_fix_recoveries_v46;
ALTER TABLE run_review_fix_rounds RENAME TO run_review_fix_rounds_v46;
ALTER TABLE run_control_project_context RENAME TO run_control_project_context_v46;
ALTER TABLE run_ci_repair_attempts RENAME TO run_ci_repair_attempts_v46;
ALTER TABLE run_autonomous_successions RENAME TO run_autonomous_successions_v46;
ALTER TABLE run_ai_reviews RENAME TO run_ai_reviews_v46;
ALTER TABLE project_action_requests RENAME TO project_action_requests_v46;
ALTER TABLE run_control_requests RENAME TO run_control_requests_v46;

CREATE TABLE run_control_requests (
  request_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN (
    'take_control', 'preview_start', 'preview_stop', 'stop',
    'discard_local', 'discard_published', 'ci_repair', 'ai_review',
    'review_fix', 'recover_managed_task', 'recover_interrupted_review_fix', 'retry'
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
, review_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (review_profile IN ('general', 'clarity', 'spec')), review_fix_all INTEGER NOT NULL DEFAULT 0
  CHECK (review_fix_all IN (0, 1) AND (review_fix_all = 0 OR action = 'review_fix')), review_fix_recovery_json TEXT CHECK(review_fix_recovery_json IS NULL OR json_valid(review_fix_recovery_json)), retry_context_json TEXT CHECK(retry_context_json IS NULL OR json_valid(retry_context_json))) STRICT;
INSERT INTO run_control_requests (request_id, run_id, action, request_state, requested_via, idempotency_key, result_json, created_at, updated_at, completed_at, review_profile, review_fix_all, review_fix_recovery_json, retry_context_json) SELECT request_id, run_id, action, request_state, requested_via, idempotency_key, result_json, created_at, updated_at, completed_at, review_profile, review_fix_all, review_fix_recovery_json, retry_context_json FROM run_control_requests_v46;

CREATE TABLE project_action_requests (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('take_control','preview_start','preview_stop','preview_reviewed','stop','discard_local','discard_published','ci_repair','review_fix','recover_managed_task','recover_interrupted_review_fix', 'retry')),
  fingerprint TEXT NOT NULL,
  confirmed INTEGER NOT NULL CHECK (confirmed IN (0,1)),
  request_id TEXT REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  preview_lease_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
INSERT INTO project_action_requests (idempotency_key, run_id, actor_subject, action, fingerprint, confirmed, request_id, preview_lease_id, created_at) SELECT idempotency_key, run_id, actor_subject, action, fingerprint, confirmed, request_id, preview_lease_id, created_at FROM project_action_requests_v46;

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
  completed_at TEXT, codex_turn_id TEXT, codex_turn_status TEXT
  CHECK(codex_turn_status IN ('completed','failed','interrupted')), codex_failure_code TEXT, review_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (review_profile IN ('general', 'clarity', 'spec')), skill_version TEXT, skill_sha256 TEXT, skill_text TEXT,
  UNIQUE (run_id, review_number)
) STRICT;
INSERT INTO run_ai_reviews (review_id, run_id, request_id, review_number, review_state, repository, pull_request_number, pull_request_url, base_ref, base_sha, head_sha, tmux_session_name, codex_thread_id, github_review_id, github_review_url, critical_count, important_count, suggestion_count, findings_json, failure_reason, created_at, updated_at, completed_at, codex_turn_id, codex_turn_status, codex_failure_code, review_profile, skill_version, skill_sha256, skill_text) SELECT review_id, run_id, request_id, review_number, review_state, repository, pull_request_number, pull_request_url, base_ref, base_sha, head_sha, tmux_session_name, codex_thread_id, github_review_id, github_review_url, critical_count, important_count, suggestion_count, findings_json, failure_reason, created_at, updated_at, completed_at, codex_turn_id, codex_turn_status, codex_failure_code, review_profile, skill_version, skill_sha256, skill_text FROM run_ai_reviews_v46;

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
INSERT INTO run_autonomous_successions (succession_id, run_id, request_id, succession_number, succession_state, predecessor_thread_id, successor_thread_id, worktree_path, branch_name, source_head_sha, tmux_session_name, handoff_context_json, failure_reason, created_at, updated_at, completed_at) SELECT succession_id, run_id, request_id, succession_number, succession_state, predecessor_thread_id, successor_thread_id, worktree_path, branch_name, source_head_sha, tmux_session_name, handoff_context_json, failure_reason, created_at, updated_at, completed_at FROM run_autonomous_successions_v46;

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
INSERT INTO run_ci_repair_attempts (attempt_id, run_id, request_id, attempt_number, source_head_sha, source_ci_state, source_checks_json, attempt_state, codex_thread_id, result_head_sha, failure_reason, created_at, updated_at, completed_at) SELECT attempt_id, run_id, request_id, attempt_number, source_head_sha, source_ci_state, source_checks_json, attempt_state, codex_thread_id, result_head_sha, failure_reason, created_at, updated_at, completed_at FROM run_ci_repair_attempts_v46;

CREATE TABLE run_control_project_context (
  request_id TEXT PRIMARY KEY REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  expected_head_sha TEXT NOT NULL CHECK (length(expected_head_sha) BETWEEN 7 AND 64),
  expected_pull_request_url TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
INSERT INTO run_control_project_context (request_id, actor_subject, expected_head_sha, expected_pull_request_url, created_at) SELECT request_id, actor_subject, expected_head_sha, expected_pull_request_url, created_at FROM run_control_project_context_v46;

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
  waiting_ci_started_at TEXT, review_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (review_profile IN ('general', 'clarity', 'spec')), review_fix_all INTEGER NOT NULL DEFAULT 0
  CHECK (review_fix_all IN (0, 1)), summary_findings_json TEXT CHECK(summary_findings_json IS NULL OR json_valid(summary_findings_json)),
  UNIQUE (run_id, round_number)
) STRICT;
INSERT INTO run_review_fix_rounds (round_id, run_id, request_id, round_number, round_state, repository, pull_request_number, pull_request_url, source_head_sha, snapshot_json, codex_thread_id, result_head_sha, resolution_attempt_count, failure_reason, created_at, updated_at, completed_at, waiting_ci_started_at, review_profile, review_fix_all, summary_findings_json) SELECT round_id, run_id, request_id, round_number, round_state, repository, pull_request_number, pull_request_url, source_head_sha, snapshot_json, codex_thread_id, result_head_sha, resolution_attempt_count, failure_reason, created_at, updated_at, completed_at, waiting_ci_started_at, review_profile, review_fix_all, summary_findings_json FROM run_review_fix_rounds_v46;

CREATE TABLE run_interrupted_review_fix_recoveries (
  request_id TEXT PRIMARY KEY REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  round_id TEXT NOT NULL REFERENCES run_review_fix_rounds(round_id) ON DELETE RESTRICT,
  predecessor_task_id TEXT NOT NULL UNIQUE REFERENCES run_codex_tasks(task_id) ON DELETE RESTRICT,
  dirty_digest TEXT NOT NULL CHECK(length(dirty_digest)=64),
  dirty_snapshot_json TEXT NOT NULL CHECK(json_valid(dirty_snapshot_json)),
  session_name TEXT NOT NULL UNIQUE,
  dispatch_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
INSERT INTO run_interrupted_review_fix_recoveries (request_id, round_id, predecessor_task_id, dirty_digest, dirty_snapshot_json, session_name, dispatch_started_at, created_at) SELECT request_id, round_id, predecessor_task_id, dirty_digest, dirty_snapshot_json, session_name, dispatch_started_at, created_at FROM run_interrupted_review_fix_recoveries_v46;

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
INSERT INTO run_review_fix_operations (round_id, operation_kind, operation_state, request_id, task_codex_thread_id, previous_codex_thread_id, tmux_session_name, result_head_sha, failure_reason, created_at, updated_at, completed_at) SELECT round_id, operation_kind, operation_state, request_id, task_codex_thread_id, previous_codex_thread_id, tmux_session_name, result_head_sha, failure_reason, created_at, updated_at, completed_at FROM run_review_fix_operations_v46;

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
INSERT INTO run_review_fix_threads (round_id, thread_id, root_comment_id, source_kind, path, line, thread_state, reply_comment_id, failure_reason, updated_at) SELECT round_id, thread_id, root_comment_id, source_kind, path, line, thread_state, reply_comment_id, failure_reason, updated_at FROM run_review_fix_threads_v46;

DROP TABLE run_review_fix_threads_v46;

DROP TABLE run_review_fix_operations_v46;

DROP TABLE run_interrupted_review_fix_recoveries_v46;

DROP TABLE run_review_fix_rounds_v46;

DROP TABLE run_control_project_context_v46;

DROP TABLE run_ci_repair_attempts_v46;

DROP TABLE run_autonomous_successions_v46;

DROP TABLE run_ai_reviews_v46;

DROP TABLE project_action_requests_v46;

DROP TABLE run_control_requests_v46;

CREATE INDEX run_control_requests_pending_idx
  ON run_control_requests(request_state, created_at);

CREATE UNIQUE INDEX run_control_requests_one_pending_action_idx
  ON run_control_requests(run_id, action)
  WHERE request_state IN ('pending', 'processing') AND action <> 'ai_review';

CREATE UNIQUE INDEX run_control_requests_one_pending_review_profile_idx
  ON run_control_requests(run_id, review_profile)
  WHERE request_state IN ('pending', 'processing') AND action = 'ai_review';

CREATE INDEX project_action_requests_run_idx ON project_action_requests(run_id,created_at);

CREATE INDEX run_ai_reviews_status_idx
  ON run_ai_reviews(review_state, updated_at);

CREATE INDEX run_ai_reviews_head_idx
  ON run_ai_reviews(run_id, head_sha, review_number DESC);

CREATE INDEX run_ai_reviews_profile_head_idx
  ON run_ai_reviews(run_id, review_profile, head_sha, review_number DESC);

CREATE UNIQUE INDEX run_ai_reviews_one_running_idx
  ON run_ai_reviews(run_id, review_profile)
  WHERE review_state = 'running';

CREATE UNIQUE INDEX run_autonomous_successions_one_active_idx
  ON run_autonomous_successions(run_id)
  WHERE succession_state IN ('starting', 'running');

CREATE INDEX run_autonomous_successions_state_idx
  ON run_autonomous_successions(succession_state, updated_at);

CREATE INDEX run_ci_repair_attempts_state_idx
  ON run_ci_repair_attempts(attempt_state, updated_at);

CREATE UNIQUE INDEX run_review_fix_one_active_idx
  ON run_review_fix_rounds(run_id)
  WHERE round_state IN ('running', 'waiting_ci', 'resolving');

CREATE INDEX run_review_fix_state_idx
  ON run_review_fix_rounds(round_state, updated_at);

CREATE INDEX run_review_fix_operations_state_idx
  ON run_review_fix_operations(operation_state, updated_at);

CREATE UNIQUE INDEX run_retry_once_per_turn_idx ON run_control_requests(run_id,json_extract(retry_context_json,'$.provider'),json_extract(retry_context_json,'$.threadId'),json_extract(retry_context_json,'$.turnId')) WHERE action='retry' AND (request_state IN ('pending','processing','applied') OR json_extract(retry_context_json,'$.dispatchStartedAt') IS NOT NULL);

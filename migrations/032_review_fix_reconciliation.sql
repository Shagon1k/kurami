ALTER TABLE run_review_fix_rounds
ADD COLUMN waiting_ci_started_at TEXT;

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

CREATE INDEX run_review_fix_operations_state_idx
  ON run_review_fix_operations(operation_state, updated_at);

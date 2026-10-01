-- Immutable execution identities; outcome verification remains in CI/PR tables.
ALTER TABLE run_ai_reviews ADD COLUMN codex_turn_id TEXT;
ALTER TABLE run_ai_reviews ADD COLUMN codex_turn_status TEXT
  CHECK(codex_turn_status IN ('completed','failed','interrupted'));
ALTER TABLE run_ai_reviews ADD COLUMN codex_failure_code TEXT;
CREATE TABLE run_codex_tasks (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('ci_repair','review_fix')),
  context_id TEXT NOT NULL,
  session_name TEXT NOT NULL,
  worktree_path TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  thread_id TEXT UNIQUE,
  turn_id TEXT,
  phase TEXT NOT NULL DEFAULT 'claimed' CHECK(phase IN
    ('claimed','thread_bound','starting_turn','running','terminal','disconnected')),
  turn_status TEXT CHECK(turn_status IN ('completed','failed','interrupted')),
  failure_code TEXT,
  stop_requested TEXT CHECK(stop_requested IN ('cancel','timeout','release')),
  stopped_at TEXT,
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(turn_id IS NULL OR thread_id IS NOT NULL),
  CHECK(turn_status IS NULL OR turn_id IS NOT NULL)
) STRICT;
CREATE UNIQUE INDEX run_codex_tasks_one_writer ON run_codex_tasks(run_id)
  WHERE released_at IS NULL;
CREATE UNIQUE INDEX run_codex_tasks_one_supervisor ON run_codex_tasks(session_name)
  WHERE released_at IS NULL;
CREATE TABLE run_codex_task_events (
  task_id TEXT NOT NULL REFERENCES run_codex_tasks(task_id) ON DELETE RESTRICT,
  event_key TEXT NOT NULL,
  method TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  turn_id TEXT NOT NULL,
  status TEXT NOT NULL,
  failure_code TEXT,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY(task_id,event_key)
) STRICT;

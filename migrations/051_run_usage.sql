-- Collector-owned metadata and totals only; no prompts, responses or raw log lines.
CREATE TABLE usage_sessions (
  thread_id TEXT PRIMARY KEY,
  checkpoint_json TEXT CHECK(checkpoint_json IS NULL OR json_valid(checkpoint_json)),
  snapshot_json TEXT CHECK(snapshot_json IS NULL OR json_valid(snapshot_json)),
  source_state TEXT NOT NULL DEFAULT 'pending' CHECK(source_state IN ('pending','partial','complete','unavailable')),
  checked_at TEXT,
  next_check_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0
) STRICT;
CREATE INDEX usage_sessions_due_idx ON usage_sessions(next_check_at,thread_id);

CREATE TABLE run_usage_sessions (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  thread_id TEXT NOT NULL REFERENCES usage_sessions(thread_id) ON DELETE RESTRICT,
  stage TEXT NOT NULL CHECK(stage IN ('implementation','review','fix_review','fix_ci','unknown')),
  PRIMARY KEY(run_id,thread_id)
) STRICT;
CREATE INDEX run_usage_sessions_thread_idx ON run_usage_sessions(thread_id);

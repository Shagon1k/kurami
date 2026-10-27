-- Only rounds launched by this controller version publish new blockers. The
-- one named legacy incident is explicitly admitted by the reconciler.
ALTER TABLE run_review_fix_rounds ADD COLUMN owner_decision_eligible INTEGER NOT NULL DEFAULT 0 CHECK(owner_decision_eligible IN (0,1));
CREATE TABLE run_owner_decision_blockers (
  blocker_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  round_id TEXT NOT NULL REFERENCES run_review_fix_rounds(round_id),
  task_id TEXT NOT NULL REFERENCES run_codex_tasks(task_id),
  turn_id TEXT NOT NULL,
  source_head_sha TEXT NOT NULL,
  context_json TEXT NOT NULL CHECK(json_valid(context_json)),
  context_digest TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT,
  thread_id TEXT,
  root_comment_id INTEGER,
  thread_url TEXT,
  create_pending INTEGER NOT NULL DEFAULT 0 CHECK(create_pending IN (0,1)),
  delivery_error TEXT,
  decision_error TEXT,
  UNIQUE(round_id,task_id,turn_id)
) STRICT;
CREATE TABLE run_owner_decisions (
  request_id TEXT PRIMARY KEY REFERENCES run_control_requests(request_id),
  blocker_id TEXT NOT NULL REFERENCES run_owner_decision_blockers(blocker_id),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  snapshot_digest TEXT NOT NULL,
  new_round_id TEXT NOT NULL UNIQUE,
  claimed_at TEXT,
  dispatch_started_at TEXT,
  aborted_at TEXT
) STRICT;

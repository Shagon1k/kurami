CREATE TABLE project_pr_requests (
  request_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  item_id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(run_id),
  actor_subject TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  client_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('ready','merge')),
  merge_method TEXT CHECK(merge_method IN ('squash','rebase','merge')),
  repository TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_id TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  request_state TEXT NOT NULL CHECK(request_state IN ('checking','writing','pending','applied','failed','conflict','uncertain')),
  github_request_uuid TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(project,item_id) REFERENCES project_items(project,item_id)
);
CREATE INDEX project_pr_requests_latest ON project_pr_requests(project,item_id,created_at);
CREATE UNIQUE INDEX project_pr_requests_active ON project_pr_requests(repository,pr_number)
  WHERE request_state IN ('checking','writing','pending','uncertain');

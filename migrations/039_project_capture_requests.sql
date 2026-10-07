-- Quick capture ("+"): the owner's free text waits here until Kurami files it as an issue in the chosen
-- project, filled from the repository's issue form (or as written, when the model is unavailable).
CREATE TABLE project_capture_requests (
  capture_key TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  actor_subject TEXT NOT NULL,
  request_text TEXT NOT NULL,
  shared_text TEXT,
  source_url TEXT,
  request_state TEXT NOT NULL CHECK(request_state IN ('queued','writing','created','failed')),
  template TEXT,
  filled_by TEXT CHECK(filled_by IN ('kurami','plain')),
  issue_number INTEGER,
  issue_url TEXT,
  on_board INTEGER,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX project_capture_requests_state ON project_capture_requests(request_state, created_at);

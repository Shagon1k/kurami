CREATE TABLE project_metadata_daily_admissions (
  project TEXT NOT NULL,
  admission_date TEXT NOT NULL CHECK (
    length(admission_date) = 10
    AND admission_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
  ),
  batch_id TEXT NOT NULL REFERENCES project_metadata_proposal_batches(batch_id),
  admission_kind TEXT NOT NULL CHECK (
    admission_kind IN ('create', 'resume', 'recover')
  ),
  created_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  PRIMARY KEY (project, admission_date)
) STRICT;

CREATE INDEX project_metadata_daily_admissions_batch_idx
  ON project_metadata_daily_admissions(batch_id);

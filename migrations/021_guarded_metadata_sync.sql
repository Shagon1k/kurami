ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'idle' CHECK (
    sync_state IN ('idle', 'queued', 'syncing', 'succeeded', 'partial', 'failed')
  );

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN sync_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (
    sync_attempt_count >= 0
  );

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN sync_started_at TEXT;

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN sync_completed_at TEXT;

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN sync_last_error TEXT;

UPDATE project_metadata_proposal_batches
SET sync_state = 'queued'
WHERE batch_state = 'accepted';

CREATE INDEX project_metadata_sync_queue_idx
  ON project_metadata_proposal_batches(sync_state, accepted_at)
  WHERE batch_state = 'accepted';

CREATE TABLE project_metadata_field_ownership (
  project TEXT NOT NULL,
  item_id TEXT NOT NULL,
  field_name TEXT NOT NULL CHECK (field_name IN ('priority', 'effort')),
  repository TEXT NOT NULL,
  issue_number INTEGER NOT NULL CHECK (issue_number > 0),
  batch_id TEXT NOT NULL REFERENCES project_metadata_proposal_batches(batch_id),
  proposal_id TEXT NOT NULL REFERENCES project_metadata_proposals(proposal_id),
  applied_value TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project, item_id, field_name)
) STRICT;

CREATE INDEX project_metadata_ownership_batch_idx
  ON project_metadata_field_ownership(batch_id, proposal_id);

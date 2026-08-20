ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN accepted_by TEXT;

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN accepted_at TEXT;

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN discussion_thread_id TEXT;

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN discussion_started_at TEXT;

ALTER TABLE project_metadata_proposal_batches
  ADD COLUMN discussion_archived_at TEXT;

DROP INDEX project_metadata_one_active_batch_idx;

CREATE UNIQUE INDEX project_metadata_one_active_batch_idx
  ON project_metadata_proposal_batches(project)
  WHERE batch_state IN (
    'planned', 'running', 'ready', 'discussing', 'accepted'
  );

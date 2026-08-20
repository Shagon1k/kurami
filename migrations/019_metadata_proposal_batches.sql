CREATE TABLE project_metadata_assessment_cursors (
  project TEXT PRIMARY KEY,
  factual_hash TEXT NOT NULL CHECK (length(factual_hash) = 64),
  change_sequence INTEGER NOT NULL CHECK (change_sequence > 0),
  assessed_at TEXT NOT NULL,
  last_batch_id TEXT
) STRICT;

CREATE TABLE project_metadata_proposal_batches (
  batch_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  batch_number INTEGER NOT NULL CHECK (batch_number > 0),
  batch_kind TEXT NOT NULL CHECK (batch_kind IN ('bootstrap', 'changed')),
  batch_state TEXT NOT NULL CHECK (
    batch_state IN (
      'planned', 'running', 'ready', 'discussing', 'accepted',
      'partially_applied', 'applied', 'skipped', 'superseded', 'failed'
    )
  ),
  factual_hash TEXT NOT NULL CHECK (length(factual_hash) = 64),
  change_sequence INTEGER NOT NULL CHECK (change_sequence > 0),
  source_items_json TEXT NOT NULL CHECK (json_valid(source_items_json)),
  source_digest TEXT NOT NULL CHECK (length(source_digest) = 64),
  candidate_count INTEGER NOT NULL CHECK (candidate_count > 0),
  proposal_count INTEGER NOT NULL DEFAULT 0 CHECK (proposal_count >= 0),
  ai_thread_id TEXT,
  ai_turn_id TEXT,
  summary TEXT,
  failure_reason TEXT,
  superseded_by_batch_id TEXT,
  created_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  updated_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  completed_at TEXT,
  UNIQUE (project, batch_number),
  FOREIGN KEY (superseded_by_batch_id)
    REFERENCES project_metadata_proposal_batches(batch_id)
) STRICT;

CREATE UNIQUE INDEX project_metadata_one_active_batch_idx
  ON project_metadata_proposal_batches(project)
  WHERE batch_state IN ('planned', 'running', 'ready', 'discussing');

CREATE INDEX project_metadata_batches_snapshot_idx
  ON project_metadata_proposal_batches(project, change_sequence DESC);

CREATE TABLE project_metadata_proposals (
  proposal_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES project_metadata_proposal_batches(batch_id),
  item_id TEXT NOT NULL,
  repository TEXT NOT NULL,
  issue_number INTEGER NOT NULL CHECK (issue_number > 0),
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  field_name TEXT NOT NULL CHECK (field_name IN ('priority', 'effort')),
  baseline_value TEXT,
  proposed_value TEXT NOT NULL,
  confidence TEXT NOT NULL CHECK (confidence IN ('high', 'medium')),
  reason TEXT NOT NULL,
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json)),
  proposal_state TEXT NOT NULL DEFAULT 'pending' CHECK (
    proposal_state IN (
      'pending', 'accepted', 'skipped', 'conflicted',
      'applied', 'failed', 'reverted'
    )
  ),
  accepted_by TEXT,
  accepted_at TEXT,
  previous_value TEXT,
  applied_value TEXT,
  applied_at TEXT,
  reverted_at TEXT,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  updated_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  UNIQUE (batch_id, item_id, field_name),
  CHECK (field_name <> 'priority' OR proposed_value IN ('P1', 'P2', 'P3')),
  CHECK (field_name <> 'effort' OR proposed_value IN ('XS', 'S', 'M', 'L', 'XL'))
) STRICT;

CREATE INDEX project_metadata_proposals_batch_idx
  ON project_metadata_proposals(batch_id, proposal_state, issue_number);

CREATE TABLE project_metadata_proposal_events (
  event_id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES project_metadata_proposal_batches(batch_id),
  proposal_id TEXT REFERENCES project_metadata_proposals(proposal_id),
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  details_json TEXT NOT NULL CHECK (json_valid(details_json)),
  occurred_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
) STRICT;

CREATE INDEX project_metadata_proposal_events_batch_idx
  ON project_metadata_proposal_events(batch_id, occurred_at);

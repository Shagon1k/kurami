-- Preserve every lease, index and invariant while adding Projects review provenance.

DROP INDEX preview_leases_active_compose_project_idx;

DROP INDEX preview_leases_active_expiry_idx;

DROP INDEX preview_leases_one_active_run_idx;

DROP INDEX preview_leases_one_active_slot_idx;

DROP INDEX preview_leases_reviewed_idx;

DROP INDEX preview_leases_run_history_idx;

DROP INDEX preview_leases_runtime_adapter_idx;

DROP TRIGGER preview_leases_reviewed_triplet_insert;

DROP TRIGGER preview_leases_reviewed_triplet_update;

DROP TRIGGER preview_leases_static_metadata_insert;

DROP TRIGGER preview_leases_static_metadata_update;

ALTER TABLE preview_leases RENAME TO preview_leases_v34;

CREATE TABLE preview_leases (
  lease_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  slot_number INTEGER NOT NULL REFERENCES preview_slots(slot_number) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK (state IN (
    'leased',
    'provisioning',
    'running',
    'releasing',
    'released',
    'failed'
  )),
  compose_project_name TEXT NOT NULL,
  leased_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  released_at TEXT,
  release_reason TEXT, expires_at TEXT, extension_count INTEGER NOT NULL DEFAULT 0
  CHECK (extension_count >= 0), reviewed_at TEXT, reviewed_by TEXT, reviewed_via TEXT
  CHECK (reviewed_via IS NULL OR reviewed_via IN ('discord', 'cli', 'projects')), verified_head_sha TEXT, runtime_adapter TEXT NOT NULL DEFAULT 'compose'
  CHECK (runtime_adapter IN ('compose', 'static')), artifact_root TEXT, artifact_digest TEXT, artifact_file_count INTEGER
  CHECK (artifact_file_count IS NULL OR artifact_file_count >= 1), artifact_total_bytes INTEGER
  CHECK (artifact_total_bytes IS NULL OR artifact_total_bytes >= 0),
  CHECK (
    (state = 'released' AND released_at IS NOT NULL)
    OR
    (state <> 'released' AND released_at IS NULL)
  )
) STRICT;

INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name,leased_at,updated_at,released_at,release_reason,expires_at,extension_count,reviewed_at,reviewed_by,reviewed_via,verified_head_sha,runtime_adapter,artifact_root,artifact_digest,artifact_file_count,artifact_total_bytes) SELECT lease_id,run_id,slot_number,state,compose_project_name,leased_at,updated_at,released_at,release_reason,expires_at,extension_count,reviewed_at,reviewed_by,reviewed_via,verified_head_sha,runtime_adapter,artifact_root,artifact_digest,artifact_file_count,artifact_total_bytes FROM preview_leases_v34;

DROP TABLE preview_leases_v34;

CREATE UNIQUE INDEX preview_leases_active_compose_project_idx
  ON preview_leases(compose_project_name)
  WHERE state <> 'released';

CREATE INDEX preview_leases_active_expiry_idx
  ON preview_leases(expires_at)
  WHERE state <> 'released';

CREATE UNIQUE INDEX preview_leases_one_active_run_idx
  ON preview_leases(run_id)
  WHERE state <> 'released';

CREATE UNIQUE INDEX preview_leases_one_active_slot_idx
  ON preview_leases(slot_number)
  WHERE state <> 'released';

CREATE INDEX preview_leases_reviewed_idx
  ON preview_leases(reviewed_at)
  WHERE reviewed_at IS NOT NULL;

CREATE INDEX preview_leases_run_history_idx
  ON preview_leases(run_id, leased_at);

CREATE INDEX preview_leases_runtime_adapter_idx
  ON preview_leases(runtime_adapter, state)
  WHERE state <> 'released';

CREATE TRIGGER preview_leases_reviewed_triplet_insert
BEFORE INSERT ON preview_leases
WHEN NOT (
  (NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_via IS NULL)
  OR
  (NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_via IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'preview review provenance must be complete');
END;

CREATE TRIGGER preview_leases_reviewed_triplet_update
BEFORE UPDATE OF reviewed_at, reviewed_by, reviewed_via ON preview_leases
WHEN NOT (
  (NEW.reviewed_at IS NULL AND NEW.reviewed_by IS NULL AND NEW.reviewed_via IS NULL)
  OR
  (NEW.reviewed_at IS NOT NULL AND NEW.reviewed_by IS NOT NULL AND NEW.reviewed_via IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'preview review provenance must be complete');
END;

CREATE TRIGGER preview_leases_static_metadata_insert
BEFORE INSERT ON preview_leases
WHEN NOT (
  (
    NEW.runtime_adapter = 'compose'
    AND NEW.artifact_root IS NULL
    AND NEW.artifact_digest IS NULL
    AND NEW.artifact_file_count IS NULL
    AND NEW.artifact_total_bytes IS NULL
  )
  OR
  (
    NEW.runtime_adapter = 'static'
    AND (
      (
        NEW.artifact_root IS NULL
        AND NEW.artifact_digest IS NULL
        AND NEW.artifact_file_count IS NULL
        AND NEW.artifact_total_bytes IS NULL
        AND NEW.state <> 'running'
      )
      OR
      (
        NEW.artifact_root IS NOT NULL
        AND NEW.artifact_digest IS NOT NULL
        AND NEW.artifact_file_count IS NOT NULL
        AND NEW.artifact_total_bytes IS NOT NULL
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'preview adapter metadata is inconsistent');
END;

CREATE TRIGGER preview_leases_static_metadata_update
BEFORE UPDATE OF state, runtime_adapter, artifact_root, artifact_digest,
                 artifact_file_count, artifact_total_bytes ON preview_leases
WHEN NOT (
  (
    NEW.runtime_adapter = 'compose'
    AND NEW.artifact_root IS NULL
    AND NEW.artifact_digest IS NULL
    AND NEW.artifact_file_count IS NULL
    AND NEW.artifact_total_bytes IS NULL
  )
  OR
  (
    NEW.runtime_adapter = 'static'
    AND (
      (
        NEW.artifact_root IS NULL
        AND NEW.artifact_digest IS NULL
        AND NEW.artifact_file_count IS NULL
        AND NEW.artifact_total_bytes IS NULL
        AND NEW.state <> 'running'
      )
      OR
      (
        NEW.artifact_root IS NOT NULL
        AND NEW.artifact_digest IS NOT NULL
        AND NEW.artifact_file_count IS NOT NULL
        AND NEW.artifact_total_bytes IS NOT NULL
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'preview adapter metadata is inconsistent');
END;

CREATE TABLE project_action_requests (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE RESTRICT,
  actor_subject TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('take_control','preview_start','preview_stop','preview_reviewed','stop','discard_local','discard_published','ci_repair','review_fix','recover_managed_task')),
  fingerprint TEXT NOT NULL,
  confirmed INTEGER NOT NULL CHECK (confirmed IN (0,1)),
  request_id TEXT REFERENCES run_control_requests(request_id) ON DELETE RESTRICT,
  preview_lease_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;
CREATE INDEX project_action_requests_run_idx ON project_action_requests(run_id,created_at);

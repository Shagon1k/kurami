ALTER TABLE preview_leases ADD COLUMN runtime_adapter TEXT NOT NULL DEFAULT 'compose'
  CHECK (runtime_adapter IN ('compose', 'static'));
ALTER TABLE preview_leases ADD COLUMN artifact_root TEXT;
ALTER TABLE preview_leases ADD COLUMN artifact_digest TEXT;
ALTER TABLE preview_leases ADD COLUMN artifact_file_count INTEGER
  CHECK (artifact_file_count IS NULL OR artifact_file_count >= 1);
ALTER TABLE preview_leases ADD COLUMN artifact_total_bytes INTEGER
  CHECK (artifact_total_bytes IS NULL OR artifact_total_bytes >= 0);

CREATE INDEX preview_leases_runtime_adapter_idx
  ON preview_leases(runtime_adapter, state)
  WHERE state <> 'released';

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

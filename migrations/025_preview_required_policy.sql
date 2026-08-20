ALTER TABLE runs ADD COLUMN preview_required INTEGER NOT NULL DEFAULT 0
  CHECK (preview_required IN (0, 1));
ALTER TABLE runs ADD COLUMN preview_required_label TEXT;
ALTER TABLE runs ADD COLUMN completion_requested_at TEXT;
ALTER TABLE runs ADD COLUMN completion_source_event_id TEXT
  REFERENCES project_events(event_id) ON DELETE RESTRICT;
ALTER TABLE runs ADD COLUMN preview_requirement_satisfied_at TEXT;
ALTER TABLE runs ADD COLUMN preview_requirement_lease_id TEXT;

ALTER TABLE preview_leases ADD COLUMN verified_head_sha TEXT;

CREATE INDEX runs_preview_completion_pending_idx
  ON runs(preview_required, completion_requested_at)
  WHERE preview_required = 1
    AND completion_requested_at IS NOT NULL
    AND preview_requirement_satisfied_at IS NULL;

CREATE TRIGGER runs_preview_policy_insert
BEFORE INSERT ON runs
WHEN NOT (
  (NEW.preview_required = 0 AND NEW.preview_required_label IS NULL)
  OR
  (NEW.preview_required = 1 AND length(trim(NEW.preview_required_label)) > 0)
)
BEGIN
  SELECT RAISE(ABORT, 'preview policy provenance must be complete');
END;

CREATE TRIGGER runs_preview_policy_update
BEFORE UPDATE OF preview_required, preview_required_label ON runs
WHEN NOT (
  (NEW.preview_required = 0 AND NEW.preview_required_label IS NULL)
  OR
  (NEW.preview_required = 1 AND length(trim(NEW.preview_required_label)) > 0)
)
BEGIN
  SELECT RAISE(ABORT, 'preview policy provenance must be complete');
END;

CREATE TRIGGER runs_preview_completion_insert
BEFORE INSERT ON runs
WHEN NOT (
  (NEW.completion_requested_at IS NULL AND NEW.completion_source_event_id IS NULL)
  OR
  (NEW.completion_requested_at IS NOT NULL AND NEW.completion_source_event_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'preview completion provenance must be complete');
END;

CREATE TRIGGER runs_preview_completion_update
BEFORE UPDATE OF completion_requested_at, completion_source_event_id ON runs
WHEN NOT (
  (NEW.completion_requested_at IS NULL AND NEW.completion_source_event_id IS NULL)
  OR
  (NEW.completion_requested_at IS NOT NULL AND NEW.completion_source_event_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'preview completion provenance must be complete');
END;

CREATE TRIGGER runs_preview_satisfaction_insert
BEFORE INSERT ON runs
WHEN NOT (
  (NEW.preview_requirement_satisfied_at IS NULL AND NEW.preview_requirement_lease_id IS NULL)
  OR
  (NEW.preview_requirement_satisfied_at IS NOT NULL AND NEW.preview_requirement_lease_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'preview satisfaction provenance must be complete');
END;

CREATE TRIGGER runs_preview_satisfaction_update
BEFORE UPDATE OF preview_requirement_satisfied_at, preview_requirement_lease_id ON runs
WHEN NOT (
  (NEW.preview_requirement_satisfied_at IS NULL AND NEW.preview_requirement_lease_id IS NULL)
  OR
  (NEW.preview_requirement_satisfied_at IS NOT NULL AND NEW.preview_requirement_lease_id IS NOT NULL)
)
BEGIN
  SELECT RAISE(ABORT, 'preview satisfaction provenance must be complete');
END;

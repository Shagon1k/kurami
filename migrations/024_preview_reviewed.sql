ALTER TABLE preview_leases ADD COLUMN reviewed_at TEXT;
ALTER TABLE preview_leases ADD COLUMN reviewed_by TEXT;
ALTER TABLE preview_leases ADD COLUMN reviewed_via TEXT
  CHECK (reviewed_via IS NULL OR reviewed_via IN ('discord', 'cli'));

CREATE INDEX preview_leases_reviewed_idx
  ON preview_leases(reviewed_at)
  WHERE reviewed_at IS NOT NULL;

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

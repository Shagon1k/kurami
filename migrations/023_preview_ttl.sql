ALTER TABLE preview_leases ADD COLUMN expires_at TEXT;
ALTER TABLE preview_leases ADD COLUMN extension_count INTEGER NOT NULL DEFAULT 0
  CHECK (extension_count >= 0);

-- Existing previews receive a fresh grace period on rollout. This prevents the
-- migration itself from unexpectedly revoking a live owner-facing preview.
UPDATE preview_leases
SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+24 hours')
WHERE state <> 'released' AND expires_at IS NULL;

CREATE INDEX preview_leases_active_expiry_idx
  ON preview_leases(expires_at)
  WHERE state <> 'released';

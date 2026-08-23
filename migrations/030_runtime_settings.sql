CREATE TABLE orchestrator_setting_revisions (
  revision INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL CHECK (action IN ('apply', 'reset', 'rollback')),
  settings_json TEXT NOT NULL CHECK (json_valid(settings_json)),
  previous_settings_json TEXT NOT NULL CHECK (json_valid(previous_settings_json)),
  settings_sha256 TEXT NOT NULL CHECK (length(settings_sha256) = 64),
  previous_settings_sha256 TEXT NOT NULL CHECK (length(previous_settings_sha256) = 64),
  previous_revision INTEGER
    REFERENCES orchestrator_setting_revisions(revision) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL CHECK (
    length(actor_id) BETWEEN 1 AND 40
    AND actor_id NOT GLOB '*[^0-9]*'
  ),
  applied_via TEXT NOT NULL CHECK (applied_via IN ('discord', 'cli')),
  applied_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
) STRICT;

CREATE INDEX orchestrator_setting_revisions_applied_idx
  ON orchestrator_setting_revisions(applied_at DESC, revision DESC);

CREATE TABLE briefing_run_attempts (
  attempt_id TEXT PRIMARY KEY,
  edition_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('scheduled', 'manual', 'recovery', 'dry-run')),
  state TEXT NOT NULL CHECK (state IN (
    'created', 'live-collected', 'telegram-captured', 'capture-validated',
    'editorialized', 'prepared', 'media-ready', 'commit-planned',
    'telegram-committed', 'published', 'notified', 'failed', 'skipped'
  )),
  run_directory TEXT NOT NULL UNIQUE,
  input_digest TEXT,
  output_digest TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;

CREATE UNIQUE INDEX briefing_run_attempts_scheduled_edition
ON briefing_run_attempts(edition_id)
WHERE mode = 'scheduled';

CREATE TABLE briefing_run_stage_receipts (
  attempt_id TEXT NOT NULL REFERENCES briefing_run_attempts(attempt_id) ON DELETE CASCADE,
  stage TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('complete', 'failed', 'skipped')),
  input_digest TEXT,
  output_digest TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (attempt_id, stage)
) STRICT;

CREATE TABLE topic_story_occurrences (
  topic_id TEXT NOT NULL REFERENCES topic_registry(id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  story_fingerprint TEXT NOT NULL,
  source_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, edition_id, story_fingerprint, source_key)
) STRICT;

CREATE INDEX topic_story_occurrences_topic
ON topic_story_occurrences(topic_id, observed_at);

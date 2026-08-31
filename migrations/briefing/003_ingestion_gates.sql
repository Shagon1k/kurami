CREATE TABLE telegram_validation_receipts (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON DELETE CASCADE,
  raw_digest TEXT NOT NULL,
  normalized_digest TEXT NOT NULL,
  report_json TEXT NOT NULL,
  commit_plan_json TEXT,
  commit_plan_digest TEXT,
  validated_at TEXT NOT NULL,
  planned_at TEXT
) STRICT;

CREATE TABLE release_notification_receipts (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  destination TEXT NOT NULL,
  provider_message_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('prepared', 'complete', 'failed')),
  provider_receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

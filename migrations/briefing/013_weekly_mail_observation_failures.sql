-- Keep optional Weekly mail failures visible without storing message IDs or mail content.
CREATE TABLE weekly_mail_observation_failures (
  action_id TEXT PRIMARY KEY REFERENCES action_receipts(action_id) ON DELETE CASCADE,
  edition_id TEXT NOT NULL REFERENCES editions(id) ON DELETE CASCADE,
  error_code TEXT NOT NULL,
  failed_at TEXT NOT NULL
) STRICT;

-- Compact counters only; no message IDs, subjects, event titles or story copy.
CREATE TABLE weekly_daily_observations (
  local_date TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

-- Publication receipts are aggregated separately so clearing a Daily page
-- cannot erase already observed mail hygiene. One opaque action ID per receipt.
CREATE TABLE weekly_mail_actions (
  action_id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK(item_count >= 0)
) STRICT;

CREATE TABLE stocks_refresh_days (
  utc_date TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('running','complete','partial','failed')),
  requests INTEGER NOT NULL DEFAULT 0 CHECK(requests>=0 AND requests<=18),
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error_code TEXT
) STRICT;

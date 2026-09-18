CREATE TABLE stocks_discovery_days (
  utc_date TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK(state IN ('running','complete','empty','partial','failed')),
  eod_calls INTEGER NOT NULL DEFAULT 0 CHECK(eod_calls BETWEEN 0 AND 4),
  av_calls INTEGER NOT NULL DEFAULT 0 CHECK(av_calls BETWEEN 0 AND 1),
  started_at TEXT NOT NULL,
  error_code TEXT
) STRICT;
CREATE TABLE stocks_discovery_seen (
  symbol TEXT PRIMARY KEY,
  session_date TEXT NOT NULL,
  day_change REAL NOT NULL
) STRICT;

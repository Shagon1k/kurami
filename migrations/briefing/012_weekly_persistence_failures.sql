-- Optional Weekly failures must not hide inside a successful Daily publication.
-- Store only a bounded diagnostic code, never provider or personal content.
CREATE TABLE weekly_persistence_failures (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON DELETE CASCADE,
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'refresh')),
  error_code TEXT NOT NULL,
  failed_at TEXT NOT NULL
) STRICT;

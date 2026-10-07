-- When the owner reached the end of a Daily edition ("Всё. Ты в курсе."). Hub shows today's mark.
CREATE TABLE edition_reads (
  edition_id TEXT PRIMARY KEY REFERENCES editions(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL
) STRICT;

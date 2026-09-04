CREATE TABLE briefing_run_cards (
  edition_id TEXT PRIMARY KEY,
  attempt_id TEXT,
  provider TEXT NOT NULL,
  destination TEXT NOT NULL,
  provider_message_id TEXT,
  card_state TEXT NOT NULL CHECK (card_state IN ('running', 'success', 'failure')),
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('prepared', 'complete', 'failed')),
  content_digest TEXT NOT NULL,
  provider_receipt_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE INDEX briefing_run_cards_updated
ON briefing_run_cards(updated_at);

-- Mail that learns from the owner: how often a sender's mail was archived from Daily, and the rules the owner
-- accepted (a sender's mail always shown as GENERAL, IMPORTANT or ACTION) or declined. Only the sender's
-- address is kept, never subjects or bodies.
CREATE TABLE mail_sender_signals (
  sender TEXT PRIMARY KEY CHECK (length(sender) BETWEEN 3 AND 320),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived >= 0),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE mail_sender_rules (
  sender TEXT PRIMARY KEY CHECK (length(sender) BETWEEN 3 AND 320),
  class TEXT CHECK (class IS NULL OR class IN ('ACTION', 'IMPORTANT', 'GENERAL')),
  decided_at TEXT NOT NULL
) STRICT;

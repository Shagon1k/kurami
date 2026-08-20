CREATE TABLE project_triage_rankings (
  project TEXT PRIMARY KEY,
  factual_hash TEXT NOT NULL CHECK (length(factual_hash) = 64),
  policy_version TEXT NOT NULL,
  ranking_json TEXT NOT NULL CHECK (json_valid(ranking_json)),
  selected_item_id TEXT,
  selected_issue_number INTEGER CHECK (
    selected_issue_number IS NULL OR selected_issue_number > 0
  ),
  selected_title TEXT,
  selected_url TEXT,
  explanation TEXT NOT NULL,
  content_digest TEXT NOT NULL CHECK (length(content_digest) = 64),
  suggested_since TEXT NOT NULL,
  ranked_at TEXT NOT NULL,
  CHECK (
    (selected_item_id IS NULL AND selected_issue_number IS NULL
      AND selected_title IS NULL AND selected_url IS NULL)
    OR
    (selected_item_id IS NOT NULL AND selected_issue_number IS NOT NULL
      AND selected_title IS NOT NULL AND selected_url IS NOT NULL)
  )
) STRICT;

CREATE TABLE project_discord_digest_surfaces (
  project TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  content_digest TEXT,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (
    state IN ('pending', 'active', 'failed')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ),
  updated_at TEXT NOT NULL DEFAULT (
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
) STRICT;

CREATE INDEX project_triage_rankings_factual_idx
  ON project_triage_rankings(factual_hash, policy_version);

CREATE INDEX project_discord_digest_surfaces_state_idx
  ON project_discord_digest_surfaces(state, updated_at);

ALTER TABLE run_discord_surfaces
  ADD COLUMN control_message_id TEXT;

ALTER TABLE run_discord_surfaces
  ADD COLUMN owner_user_id TEXT;

ALTER TABLE run_discord_surfaces
  ADD COLUMN owner_joined_at TEXT;

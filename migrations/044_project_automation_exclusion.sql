-- Keep the latest board observation available to owner views, including label-only changes.
ALTER TABLE project_items ADD COLUMN automation_excluded INTEGER NOT NULL DEFAULT 0
  CHECK (automation_excluded IN (0, 1));

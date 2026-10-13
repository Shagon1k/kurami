-- Preserve targeted requests and rounds; new owner controls can fix all profiles together.
ALTER TABLE run_control_requests ADD COLUMN review_fix_all INTEGER NOT NULL DEFAULT 0
  CHECK (review_fix_all IN (0, 1) AND (review_fix_all = 0 OR action = 'review_fix'));
ALTER TABLE run_review_fix_rounds ADD COLUMN review_fix_all INTEGER NOT NULL DEFAULT 0
  CHECK (review_fix_all IN (0, 1));

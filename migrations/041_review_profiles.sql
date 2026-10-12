-- Existing reviews and controls remain General; Clarity is optional and manual.
ALTER TABLE run_control_requests ADD COLUMN review_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (review_profile IN ('general', 'clarity'));
ALTER TABLE run_ai_reviews ADD COLUMN review_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (review_profile IN ('general', 'clarity'));
ALTER TABLE run_ai_reviews ADD COLUMN skill_version TEXT;
ALTER TABLE run_ai_reviews ADD COLUMN skill_sha256 TEXT;
ALTER TABLE run_ai_reviews ADD COLUMN skill_text TEXT;
ALTER TABLE run_review_fix_rounds ADD COLUMN review_profile TEXT NOT NULL DEFAULT 'general'
  CHECK (review_profile IN ('general', 'clarity'));
CREATE INDEX run_ai_reviews_profile_head_idx
  ON run_ai_reviews(run_id, review_profile, head_sha, review_number DESC);

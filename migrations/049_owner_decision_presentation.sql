ALTER TABLE run_codex_tasks ADD COLUMN owner_decision_summary_json TEXT CHECK(owner_decision_summary_json IS NULL OR json_valid(owner_decision_summary_json));
ALTER TABLE run_owner_decision_blockers ADD COLUMN author_type TEXT NOT NULL DEFAULT 'Bot' CHECK(author_type IN ('Bot','User'));
-- Only roots already durably recorded before this change retain owner authorship.
UPDATE run_owner_decision_blockers SET author_type='User'
WHERE author_id IS NOT NULL AND thread_id IS NOT NULL AND root_comment_id IS NOT NULL;

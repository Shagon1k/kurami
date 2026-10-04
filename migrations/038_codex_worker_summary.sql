-- Bounded final assistant report; task/run/context/thread/turn provenance stays on this row.
ALTER TABLE run_codex_tasks ADD COLUMN final_summary TEXT CHECK(final_summary IS NULL OR length(final_summary)<=800);

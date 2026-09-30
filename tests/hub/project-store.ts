import { DatabaseSync } from "node:sqlite";

export function createProjectStore(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE project_items(project TEXT,item_id TEXT,status TEXT,present INTEGER);
    CREATE TABLE runs(run_id TEXT,project TEXT,issue_number INTEGER,repository TEXT,item_id TEXT,state TEXT,updated_at TEXT);
    CREATE TABLE run_ci_snapshots(run_id TEXT,head_sha TEXT,aggregate_state TEXT,pull_request_url TEXT,pull_request_title TEXT,completed_at TEXT,first_observed_at TEXT,last_observed_at TEXT);
    CREATE TABLE run_ci_repair_attempts(run_id TEXT,source_head_sha TEXT,attempt_state TEXT,attempt_number INTEGER,result_head_sha TEXT);
    CREATE TABLE run_review_fix_rounds(run_id TEXT,round_state TEXT,round_number INTEGER);
    CREATE TABLE run_ai_reviews(review_id TEXT,run_id TEXT,head_sha TEXT,review_state TEXT,review_number INTEGER,critical_count INTEGER,important_count INTEGER,suggestion_count INTEGER,updated_at TEXT,pull_request_url TEXT,pull_request_number INTEGER);
    CREATE TABLE run_control_requests(run_id TEXT,action TEXT,request_state TEXT);
    CREATE TABLE run_progress_cards(run_id TEXT,stage TEXT);
    CREATE TABLE project_poll_state(project TEXT,last_captured_at TEXT,last_attempt_state TEXT);
    CREATE TABLE run_state_history(sequence INTEGER,run_id TEXT,occurred_at TEXT,to_state TEXT);
  `);
}

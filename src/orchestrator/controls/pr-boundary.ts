import type {DatabaseSync} from "node:sqlite";

export function hasActivePrRequest(db:DatabaseSync,runId:string):boolean {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_pr_requests'").get())return false;
  return Boolean(db.prepare("SELECT 1 FROM project_pr_requests WHERE run_id=? AND request_state IN ('checking','writing','pending','uncertain') LIMIT 1").get(runId));
}

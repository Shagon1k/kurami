import { type ReviewProfile } from "../projects/reviews/profiles.ts";
import type { DatabaseSync } from "node:sqlite";

export type AiReviewStableState = {
  state: string; owner_state: string; resource_state: string; tmux_session_name: string | null;
  worktree_path: string | null; branch_name: string | null; active_repair_count: number; active_review_count: number;
};

/** The stable-worktree rule used by the existing controls and Projects. */
export function aiReviewStable(state: AiReviewStableState): boolean {
  return state.state === "parked_review" && state.owner_state === "none" && state.resource_state === "provisioned" &&
    state.tmux_session_name === null && Boolean(state.worktree_path) && Boolean(state.branch_name) &&
    state.active_repair_count === 0 && state.active_review_count === 0;
}

export type AiReviewInspection = {
  eligible: boolean; reason: string; head: string | null; prUrl: string | null;
  project: string; itemId: string; repository: string;
};
export function inspectAiReview(database: DatabaseSync, runId: string, profile: ReviewProfile = "general"): AiReviewInspection | null {
  const row = database.prepare(`SELECT r.project,r.item_id,r.repository,r.state,r.owner_state,r.execution_mode,r.stop_reason,
    rr.resource_state,rr.tmux_session_name,rr.worktree_path,rr.branch_name,rr.previous_codex_thread_id,
    ci.head_sha,ci.pull_request_url,
    EXISTS(SELECT 1 FROM runs n WHERE n.project=r.project AND n.item_id=r.item_id AND n.rowid>r.rowid) AS superseded,
    EXISTS(SELECT 1 FROM project_items p WHERE p.project=r.project AND p.item_id=r.item_id AND p.present=1) AS present,
    (SELECT COUNT(*) FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id AND a.attempt_state IN ('running','waiting_ci')) AS active_repair_count,
    (SELECT COUNT(*) FROM run_ai_reviews a WHERE a.run_id=r.run_id AND a.review_profile=? AND a.review_state='running') AS active_review_count,
    (SELECT COUNT(*) FROM run_review_fix_rounds a WHERE a.run_id=r.run_id AND a.round_state IN ('running','waiting_ci','resolving')) AS active_fix_count,
    (SELECT COUNT(*) FROM run_control_requests q WHERE q.run_id=r.run_id AND q.request_state IN ('pending','processing') AND (q.action<>'ai_review' OR q.review_profile=?)) AS pending_count,
    EXISTS(SELECT 1 FROM run_ai_reviews a WHERE a.run_id=r.run_id AND a.head_sha=ci.head_sha AND a.review_profile=? AND a.review_state='ready') AS ready
    FROM runs r JOIN run_resources rr USING(run_id) LEFT JOIN run_ci_snapshots ci USING(run_id) WHERE r.run_id=?`).get(profile, profile, profile, runId) as
    (AiReviewStableState & { project: string; item_id: string; repository: string; execution_mode: string; stop_reason: string | null;
      previous_codex_thread_id: string | null; head_sha: string | null; pull_request_url: string | null;
      superseded: number; present: number; active_fix_count: number; pending_count: number; ready: number }) | undefined;
  if (!row) return null;
  const reason = row.superseded || !row.present ? "superseded" : row.pending_count || row.active_review_count ? "pending" :
    !aiReviewStable(row) || row.execution_mode !== "live" || row.stop_reason || row.previous_codex_thread_id || row.active_fix_count ? "unstable" :
    !row.head_sha || !/^[a-f0-9]{7,64}$/.test(row.head_sha) || !row.pull_request_url ? "no_head" : row.ready ? "ready" : "eligible";
  return { eligible: reason === "eligible", reason, head: row.head_sha, prUrl: row.pull_request_url, project: row.project, itemId: row.item_id, repository: row.repository };
}

/** Site requests must still refer to the displayed PR and commit when the worker starts. */
export function reviewContextMatches(database: DatabaseSync, requestId: string, head: string, prUrl: string): boolean {
  const request = database.prepare("SELECT requested_via FROM run_control_requests WHERE request_id=?").get(requestId) as { requested_via: string } | undefined;
  if (!request) return false;
  if (request.requested_via !== "projects") return true;
  const context = database.prepare("SELECT expected_head_sha,expected_pull_request_url FROM run_control_project_context WHERE request_id=?").get(requestId) as
    { expected_head_sha: string; expected_pull_request_url: string } | undefined;
  return Boolean(context && context.expected_head_sha === head && context.expected_pull_request_url === prUrl);
}

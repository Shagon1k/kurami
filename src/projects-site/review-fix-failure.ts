import type { ReviewProfile } from "../orchestrator/projects/reviews/profiles.ts";
import type { DatabaseSync } from "node:sqlite";

/** Display-only startup outcome for the newest request and the displayed PR/head. */
export function reviewFixStartupFailure(database: DatabaseSync, runId: string, head: string | null, pr: string | null, profile: ReviewProfile = "general"): string | null {
  if (!head || !pr || !database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_control_project_context'").get()) return null;
  const request = database.prepare(`SELECT q.request_state,q.result_json,c.expected_head_sha,c.expected_pull_request_url
    FROM run_control_requests q LEFT JOIN run_control_project_context c USING(request_id)
    JOIN runs r ON r.run_id=q.run_id AND r.state IN ('parked_review','needs_attention') AND r.stop_reason IS NULL
    WHERE q.run_id=? AND q.action='review_fix' AND q.review_profile=? ORDER BY q.rowid DESC LIMIT 1`).get(runId,profile);
  if (!request || !["failed", "rejected"].includes(String(request.request_state)) ||
      request.expected_head_sha !== head || request.expected_pull_request_url !== pr) return null;
  let result: { action?: unknown; reason?: unknown };
  try { result = JSON.parse(String(request.result_json)); } catch { return null; }
  if (result?.action !== "review_fix_start_failed" || typeof result.reason !== "string") return null;
  // Never publish subprocess stderr, paths, shell commands or credential-bearing URLs.
  // Only fixed classifications of the known admission failures reach the page.
  if (/live writer uses preserved worktree/u.test(result.reason))
    return "Review fixes did not start: a process still owns the managed working copy. Cleanup must finish before retrying.";
  if (/clean managed worktree|worktree is dirty/iu.test(result.reason))
    return "Review fixes did not start: the managed working copy has uncommitted changes.";
  if (/SHA mismatch|different PR or commit|head changed|source.*changed/iu.test(result.reason))
    return "Review fixes did not start: the PR or source commit changed. Refresh before retrying.";
  return "Review fixes did not start: startup was refused. Inspect the current run diagnostic before retrying.";
}

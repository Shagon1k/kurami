import type { DatabaseSync } from "node:sqlite";
import type { ReviewProfile } from "./profiles.ts";

export type ReviewEvidence = {
  state: string; head: string | null; critical: number; important: number; suggestions: number;
  url: string | null; failure: string | null; requestState: string | null;
  fix?: { state: string; round: number | null };
};

/** Results and fix progress are scoped to the selected reviewer; admission remains shared. */
export function readReviewEvidence(database: DatabaseSync, runId: string, profile: ReviewProfile,
  currentHead: string | null): ReviewEvidence {
  const latest = database.prepare(`SELECT review_state,head_sha,critical_count,important_count,
    suggestion_count,github_review_url,failure_reason FROM run_ai_reviews
    WHERE run_id=? AND review_profile=? ORDER BY review_number DESC LIMIT 1`).get(runId, profile);
  const request = database.prepare(`SELECT request_state FROM run_control_requests
    WHERE run_id=? AND action='ai_review' AND review_profile=? ORDER BY rowid DESC LIMIT 1`).get(runId, profile);
  const requestState = request ? String(request.request_state) : null;
  const pending = ["pending", "processing"].includes(requestState ?? "");
  const head = latest?.head_sha ? String(latest.head_sha) : null;
  const state = pending ? latest?.review_state === "running" ? "running" : "queued"
    : ["failed", "rejected"].includes(requestState ?? "") ? "request_failed"
    : head && currentHead && head !== currentHead ? "outdated"
    : latest?.review_state === "ready" && !currentHead ? "unverified"
    : String(latest?.review_state ?? "none");
  const fix = database.prepare(`SELECT round_state,round_number FROM run_review_fix_rounds
    WHERE run_id=? AND (review_profile=? OR review_fix_all=1) ORDER BY round_number DESC LIMIT 1`).get(runId, profile);
  const fixQueued = database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=?
    AND action='review_fix' AND (review_profile=? OR review_fix_all=1) AND request_state IN ('pending','processing')`).get(runId, profile);
  return {
    state, head, requestState, critical: Number(latest?.critical_count ?? 0),
    important: Number(latest?.important_count ?? 0), suggestions: Number(latest?.suggestion_count ?? 0),
    url: latest?.github_review_url ? String(latest.github_review_url) : null,
    failure: latest?.failure_reason ? String(latest.failure_reason) : null,
    fix: fixQueued && !["running", "waiting_ci", "resolving"].includes(String(fix?.round_state))
      ? { state: "queued", round: null } : fix ? { state: String(fix.round_state), round: Number(fix.round_number) } : undefined,
  };
}

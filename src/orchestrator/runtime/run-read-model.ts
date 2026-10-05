import {LATEST_ATTENTION_SQL,LATEST_SUCCESSOR_STATE_SQL,LATEST_SUCCESSOR_THREAD_SQL,ACTIVE_SUCCESSOR_EXISTS_SQL} from "./run-projections.ts";
/** The controller's persisted run projection. Keep aliases aligned with RunRow. */
export type RunRow = {
  run_id: string;
  project: string;
  issue_number: number;
  interaction_policy: "autonomous" | "human_control";
  execution_mode: string;
  run_state: string;
  stop_reason: "cancelled" | "completed" | null;
  owner_state: string;
  resource_state: string;
  worktree_path: string | null;
  branch_name: string | null;
  tmux_session_name: string | null;
  codex_thread_id: string | null;
  previous_codex_thread_id: string | null;
  preview_id: string | null;
  preview_lease_id: string | null;
  preview_lease_state: string | null;
  preview_expires_at: string | null;
  preview_reviewed_at: string | null;
  preview_verified_head_sha: string | null;
  preview_required: number;
  preview_required_label: string | null;
  completion_requested_at: string | null;
  completion_source_event_id: string | null;
  preview_requirement_satisfied_at: string | null;
  preview_requirement_lease_id: string | null;
  preview_requirement_verified_head_sha: string | null;
  project_item_status: string | null;
  has_newer_run: number;
  backlog_satisfied: number;
  completion_parked: number;
  takeover_pending: number;
  ci_pull_request_number: number | null;
  ci_pull_request_url: string | null;
  ci_head_sha: string | null;
  ci_aggregate_state: string | null;
  repair_attempt_count: number;
  repair_active_count: number;
  latest_repair_state: string | null;
  latest_repair_number: number | null;
  latest_repair_failure_reason: string | null;
  review_active_count: number;
  latest_review_state: string | null;
  latest_review_head_sha: string | null;
  review_fix_active_count: number;
  autonomous_successor_active: number;
  latest_autonomous_successor_state: string | null;
  latest_autonomous_successor_predecessor_thread_id: string | null;
  latest_review_fix_state: string | null;
  latest_review_fix_number: number | null;
  latest_review_fix_round_id: string | null;
  latest_review_fix_codex_thread_id: string | null;
  latest_review_fix_failure_reason: string | null;
  latest_attention_reason: string | null;
  project_poll_last_captured_at: string | null;
  project_poll_last_attempt_state: string | null;
};

export function previewNeedsExtension(
  run: RunRow,
  warningHours: number,
  now = Date.now(),
): boolean {
  if (run.preview_lease_state !== "running" || !run.preview_expires_at) return false;
  const expiresAt = Date.parse(run.preview_expires_at);
  return (
    Number.isFinite(expiresAt) &&
    expiresAt > now &&
    expiresAt - now <= warningHours * 60 * 60 * 1_000
  );
}

export function baseRunSelect(): string {
  return `
    SELECT r.run_id, r.project, r.issue_number, r.interaction_policy,
           r.execution_mode,
           r.state AS run_state, r.stop_reason, r.owner_state,
           rr.resource_state, rr.worktree_path, rr.branch_name,
           rr.tmux_session_name, rr.codex_thread_id,
           rr.previous_codex_thread_id,
           rr.preview_id, pl.lease_id AS preview_lease_id,
           pl.state AS preview_lease_state,
           pl.expires_at AS preview_expires_at,
           pl.reviewed_at AS preview_reviewed_at,
           pl.verified_head_sha AS preview_verified_head_sha,
           r.preview_required, r.preview_required_label,
           r.completion_requested_at, r.completion_source_event_id,
           r.preview_requirement_satisfied_at,
           r.preview_requirement_lease_id,
           evidence.verified_head_sha AS preview_requirement_verified_head_sha,
           pi.status AS project_item_status,
           EXISTS (
             SELECT 1 FROM runs newer
             WHERE newer.project = r.project
               AND newer.item_id = r.item_id
               AND newer.rowid > r.rowid
           ) AS has_newer_run,
           EXISTS (
             SELECT 1 FROM run_state_history backlog_history
             WHERE backlog_history.run_id = r.run_id
               AND backlog_history.reason IN (
                 'cancelled_item_returned_to_backlog',
                 'cancelled_item_already_backlog'
             )
           ) AS backlog_satisfied,
           EXISTS (
             SELECT 1 FROM run_state_history completion_history
             WHERE completion_history.run_id = r.run_id
               AND completion_history.reason IN ('codex_cli_park_completed','codex_protocol_park_completed')
           ) AS completion_parked,
           EXISTS (
             SELECT 1 FROM run_control_requests takeover_request
             WHERE takeover_request.run_id = r.run_id
               AND takeover_request.action = 'take_control'
               AND takeover_request.request_state IN ('pending', 'processing')
           ) AS takeover_pending,
           ci.pull_request_number AS ci_pull_request_number,
           ci.pull_request_url AS ci_pull_request_url,
           ci.head_sha AS ci_head_sha,
           ci.aggregate_state AS ci_aggregate_state,
           (SELECT COUNT(*) FROM run_ci_repair_attempts repair_count
            WHERE repair_count.run_id = r.run_id) AS repair_attempt_count,
           (SELECT COUNT(*) FROM run_ci_repair_attempts repair_active
            WHERE repair_active.run_id = r.run_id
              AND repair_active.attempt_state IN ('running', 'waiting_ci'))
             AS repair_active_count,
           (SELECT attempt_state FROM run_ci_repair_attempts repair_latest
            WHERE repair_latest.run_id = r.run_id
            ORDER BY repair_latest.attempt_number DESC LIMIT 1)
             AS latest_repair_state,
           (SELECT attempt_number FROM run_ci_repair_attempts repair_latest
            WHERE repair_latest.run_id = r.run_id
            ORDER BY repair_latest.attempt_number DESC LIMIT 1)
             AS latest_repair_number
           ,(SELECT failure_reason FROM run_ci_repair_attempts repair_latest
             WHERE repair_latest.run_id = r.run_id
             ORDER BY repair_latest.attempt_number DESC LIMIT 1)
              AS latest_repair_failure_reason
           ,(SELECT COUNT(*) FROM run_ai_reviews review_active
             WHERE review_active.run_id = r.run_id
               AND review_active.review_state = 'running') AS review_active_count
           ,(SELECT review_state FROM run_ai_reviews review_latest
             WHERE review_latest.run_id = r.run_id
             ORDER BY review_latest.review_number DESC LIMIT 1)
              AS latest_review_state
           ,(SELECT head_sha FROM run_ai_reviews review_latest
             WHERE review_latest.run_id = r.run_id
             ORDER BY review_latest.review_number DESC LIMIT 1)
              AS latest_review_head_sha
           ,(SELECT COUNT(*) FROM run_review_fix_rounds fix_active
             WHERE fix_active.run_id = r.run_id
               AND fix_active.round_state IN ('running','waiting_ci','resolving'))
              AS review_fix_active_count
           ,${ACTIVE_SUCCESSOR_EXISTS_SQL}
           ,${LATEST_SUCCESSOR_STATE_SQL}
           ,${LATEST_SUCCESSOR_THREAD_SQL}
           ,(SELECT round_state FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_state
           ,(SELECT round_number FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_number
           ,(SELECT round_id FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_round_id
           ,(SELECT codex_thread_id FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_codex_thread_id
           ,(SELECT failure_reason FROM run_review_fix_rounds fix_latest
             WHERE fix_latest.run_id = r.run_id
             ORDER BY fix_latest.round_number DESC LIMIT 1)
              AS latest_review_fix_failure_reason
           ,${LATEST_ATTENTION_SQL}
           ,pps.last_captured_at AS project_poll_last_captured_at
           ,pps.last_attempt_state AS project_poll_last_attempt_state
    FROM runs r
    JOIN run_resources rr USING (run_id)
    LEFT JOIN run_ci_snapshots ci USING (run_id)
    LEFT JOIN preview_leases pl
      ON pl.run_id = r.run_id AND pl.state <> 'released'
    LEFT JOIN preview_leases evidence
      ON evidence.lease_id = r.preview_requirement_lease_id
    LEFT JOIN project_items pi
      ON pi.project = r.project AND pi.item_id = r.item_id
    LEFT JOIN project_poll_state pps ON pps.project = r.project
  `;
}

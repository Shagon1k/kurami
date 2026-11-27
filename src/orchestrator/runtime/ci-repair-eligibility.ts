import type { DatabaseSync } from "node:sqlite";
import { hasActivePrRequest } from "../controls/pr-boundary.ts";
import { canRetryUnchangedCi } from "./ci-no-change-retry.ts";
import { LATEST_ATTENTION_VALUE_SQL } from "./run-projections.ts";

/** Attention is not general repair admission: require the exact archived review-fix delivery. */
export function canRepairReviewFixCi(database: DatabaseSync, runId: string, requestId: string | null = null): boolean {
  if (hasActivePrRequest(database,runId) ||
    !database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='run_codex_tasks'").get()) return false;
  return Boolean(database.prepare(`SELECT 1 FROM runs r JOIN run_resources rr USING(run_id)
    JOIN run_ci_snapshots ci USING(run_id)
    JOIN run_review_fix_rounds f USING(run_id)
    JOIN run_control_requests q ON q.request_id=f.request_id AND q.run_id=r.run_id
    JOIN run_codex_tasks ct ON ct.run_id=r.run_id AND ct.context_id=f.round_id AND ct.kind='review_fix'
    WHERE r.run_id=? AND r.state='needs_attention' AND r.owner_state='none'
      AND r.execution_mode='live' AND r.stop_reason IS NULL AND r.archived_at IS NULL
      AND r.completion_requested_at IS NULL AND rr.resource_state='provisioned'
      AND rr.tmux_session_name IS NULL AND rr.previous_codex_thread_id IS NULL AND rr.codex_thread_id IS NOT NULL
      AND ${LATEST_ATTENTION_VALUE_SQL}='review_fix_ci_failed'
      AND f.round_state='needs_attention' AND f.failure_reason='review_fix_ci_failed' AND f.completed_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM run_review_fix_rounds newer WHERE newer.run_id=r.run_id AND newer.round_number>f.round_number)
      AND q.action='review_fix' AND q.request_state='applied'
      AND ci.repository=r.repository AND ci.repository=f.repository
      AND ci.pull_request_number=f.pull_request_number AND ci.pull_request_url=f.pull_request_url
      AND ci.head_sha=f.result_head_sha AND ci.head_sha<>f.source_head_sha
      AND ci.aggregate_state IN ('failed','missing') AND ci.last_error IS NULL
      AND julianday(ci.last_observed_at) BETWEEN julianday('now','-2 minutes') AND julianday('now')
      AND (SELECT COUNT(*) FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id)<2
      AND ct.thread_id=f.codex_thread_id AND ct.thread_id<>rr.codex_thread_id AND ct.turn_id IS NOT NULL
      AND ct.phase='terminal' AND ct.turn_status='completed' AND ct.failure_code IS NULL
      AND ct.stopped_at IS NOT NULL AND ct.released_at IS NOT NULL
      AND (ct.stop_requested IS NULL OR ct.stop_requested='release')
      AND julianday(ct.released_at)>=julianday(ct.stopped_at)
      AND ct.worktree_path=rr.worktree_path AND ct.branch_name=rr.branch_name
      AND EXISTS(SELECT 1 FROM run_codex_task_events e WHERE e.task_id=ct.task_id AND e.event_key='terminal:'||ct.turn_id
        AND e.method='turn/completed' AND e.thread_id=ct.thread_id AND e.turn_id=ct.turn_id AND e.status='completed' AND e.failure_code IS NULL)
      AND EXISTS(SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id AND h.reason='review_fix_task_archived'
        AND json_extract(h.details_json,'$.roundId')=f.round_id
        AND json_extract(h.details_json,'$.reviewFixCodexThreadId')=ct.thread_id
        AND json_extract(h.details_json,'$.restoredCodexThreadId')=rr.codex_thread_id)
      AND NOT EXISTS(SELECT 1 FROM run_control_requests pending WHERE pending.run_id=r.run_id
        AND pending.request_state IN ('pending','processing') AND (? IS NULL OR pending.request_id<>?))
      AND NOT EXISTS(SELECT 1 FROM run_codex_tasks active WHERE active.worktree_path=rr.worktree_path AND active.released_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM run_resources other JOIN runs owner USING(run_id)
        WHERE other.worktree_path=rr.worktree_path AND other.run_id<>r.run_id
          AND (owner.owner_state<>'none' OR other.tmux_session_name IS NOT NULL))
      AND NOT EXISTS(SELECT 1 FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id AND a.attempt_state IN ('running','waiting_ci'))
      AND NOT EXISTS(SELECT 1 FROM run_ai_reviews a WHERE a.run_id=r.run_id AND a.review_state='running')
      AND NOT EXISTS(SELECT 1 FROM run_review_fix_rounds active WHERE active.run_id=r.run_id AND active.round_state IN ('running','waiting_ci','resolving'))
      AND NOT EXISTS(SELECT 1 FROM run_autonomous_successions s WHERE s.run_id=r.run_id AND s.succession_state IN ('starting','running'))
      AND NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.project=r.project AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      AND NOT EXISTS(SELECT 1 FROM project_events e WHERE e.project=r.project AND e.item_id=r.item_id
        AND e.processing_state='pending' AND e.from_status IS NOT e.to_status)
  `).get(runId,requestId,requestId));
}

export function canRepairAttentionCi(database: DatabaseSync, runId: string, requestId: string | null = null): boolean {
  return canRetryUnchangedCi(database,runId,requestId) || canRepairReviewFixCi(database,runId,requestId);
}

import type { DatabaseSync } from "node:sqlite";
import { hasActivePrRequest } from "../controls/pr-boundary.ts";
import { LATEST_ATTENTION_VALUE_SQL } from "./run-projections.ts";

export function reconcileCiRepairAttempts(database: DatabaseSync): void {
  const attempts = database
    .prepare(
      `SELECT a.attempt_id, a.run_id, a.attempt_number, a.source_head_sha,
              a.attempt_state, a.updated_at, r.state AS run_state,
              r.owner_state, rr.tmux_session_name,
              ci.head_sha, ci.aggregate_state
       FROM run_ci_repair_attempts a
       JOIN runs r USING (run_id)
       JOIN run_resources rr USING (run_id)
       LEFT JOIN run_ci_snapshots ci USING (run_id)
       WHERE a.attempt_state IN ('running', 'waiting_ci')
       ORDER BY a.created_at, a.attempt_id`,
    )
    .all() as Array<{
    attempt_id: string;
    run_id: string;
    attempt_number: number;
    source_head_sha: string;
    attempt_state: "running" | "waiting_ci";
    updated_at: string;
    run_state: string;
    owner_state: string;
    tmux_session_name: string | null;
    head_sha: string | null;
    aggregate_state: string | null;
  }>;
  for (const attempt of attempts) {
    if (
      attempt.attempt_state === "running" &&
      attempt.run_state === "parked_review" &&
      attempt.owner_state === "none" &&
      attempt.tmux_session_name === null
    ) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'waiting_ci',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'running'`,
        )
        .run(attempt.attempt_id);
      continue;
    }
    if (attempt.attempt_state !== "waiting_ci") continue;
    const newHead =
      Boolean(attempt.head_sha) && attempt.head_sha !== attempt.source_head_sha;
    if (newHead && attempt.aggregate_state === "passed") {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'succeeded', result_head_sha = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(attempt.head_sha, attempt.attempt_id);
      continue;
    }
    if (
      newHead &&
      ["failed", "missing"].includes(attempt.aggregate_state ?? "")
    ) {
      const terminal = attempt.attempt_number >= 2;
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = ?, result_head_sha = ?, failure_reason = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(
          terminal ? "needs_attention" : "failed",
          attempt.head_sha,
          `CI ${attempt.aggregate_state} on repaired SHA`,
          attempt.attempt_id,
        );
      if (terminal) markRepairNeedsAttention(database, attempt.run_id, "ci_repair_attempt_budget_exhausted", attempt);
      continue;
    }
    const ageMinutes =
      (Date.now() - Date.parse(attempt.updated_at)) / (60 * 1_000);
    if (!newHead && ageMinutes >= 10) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'needs_attention',
               failure_reason = 'No new PR head appeared after the fixer task',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(attempt.attempt_id);
      markRepairNeedsAttention(database, attempt.run_id, "ci_repair_no_new_head", attempt);
      continue;
    }
    if (
      newHead &&
      ["pending", "unknown"].includes(attempt.aggregate_state ?? "") &&
      ageMinutes >= 30
    ) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'needs_attention', result_head_sha = ?,
               failure_reason = 'CI did not settle within the bounded wait',
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'waiting_ci'`,
        )
        .run(attempt.head_sha, attempt.attempt_id);
      markRepairNeedsAttention(
        database,
        attempt.run_id,
        "ci_repair_ci_timeout",
        attempt,
      );
    }
  }
}

function markRepairNeedsAttention(
  database: DatabaseSync,
  runId: string,
  reason: string,
  attempt: { attempt_id: string; attempt_number: number; source_head_sha: string },
): void {
  const current = database
    .prepare(`SELECT state FROM runs WHERE run_id = ?`)
    .get(runId) as { state: string };
  const changed = database
    .prepare(
      `UPDATE runs SET state = 'needs_attention', owner_state = 'none',
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE run_id = ? AND state = 'parked_review' AND owner_state = 'none'`,
    )
    .run(runId);
  if (changed.changes === 1) {
    database
      .prepare(
        `INSERT INTO run_state_history (
           run_id, from_state, to_state, reason, details_json
         ) VALUES (?, ?, 'needs_attention', ?, ?)`,
      )
      .run(
        runId,
        current.state,
        reason,
        JSON.stringify({
          attemptId: attempt.attempt_id,
          attemptNumber: attempt.attempt_number,
          sourceHeadSha: attempt.source_head_sha,
        }),
      );
  }
}

/** Only database evidence: external source validation belongs to the lifecycle caller. */
export function externalCiRepairCandidate(database: DatabaseSync, runId: string) {
  if (hasActivePrRequest(database, runId)) return null;
  const row = database.prepare(`SELECT r.run_id, r.project, r.repository, rr.worktree_path, rr.branch_name,
      rr.codex_thread_id, a.attempt_id, a.attempt_number, a.source_head_sha,
      ct.task_id, ct.thread_id, ct.turn_id, ct.stopped_at, ct.released_at,
      ci.head_sha, ci.pull_request_number, ci.pull_request_url, ci.last_observed_at,
      ci.content_digest, ci.checks_json,
      (SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id) AS history_sequence,
      (SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id AND reason='ci_repair_no_new_head') AS attention_sequence,
      (SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id AND reason='ci_repair_task_archived') AS archive_sequence,
      (SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id AND reason='codex_protocol_park_completed'
        AND json_extract(details_json,'$.taskId')=ct.task_id) AS release_sequence
    FROM runs r JOIN run_resources rr USING(run_id)
    JOIN run_ci_snapshots ci USING(run_id)
    JOIN run_ci_repair_attempts a ON a.run_id=r.run_id AND a.attempt_number=(SELECT MAX(attempt_number) FROM run_ci_repair_attempts WHERE run_id=r.run_id)
    JOIN run_control_requests q ON q.request_id=a.request_id AND q.run_id=r.run_id
    JOIN run_codex_tasks ct ON ct.run_id=r.run_id AND ct.context_id=a.attempt_id AND ct.kind='ci_repair'
    WHERE r.run_id=? AND r.state='needs_attention' AND r.owner_state='none'
      AND r.execution_mode='live' AND r.stop_reason IS NULL AND r.archived_at IS NULL
      AND r.completion_source_event_id IS NULL AND r.completion_requested_at IS NULL AND rr.resource_state='provisioned'
      AND rr.tmux_session_name IS NULL AND rr.previous_codex_thread_id IS NULL AND rr.codex_thread_id IS NOT NULL
      AND ${LATEST_ATTENTION_VALUE_SQL}='ci_repair_no_new_head'
      AND EXISTS(SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id
        AND h.sequence=(SELECT MAX(h2.sequence) FROM run_state_history h2 WHERE h2.run_id=r.run_id AND h2.from_state<>h2.to_state)
        AND h.from_state='parked_review' AND h.to_state='needs_attention'
        AND h.reason='ci_repair_no_new_head' AND json_extract(h.details_json,'$.attemptId')=a.attempt_id
        AND json_extract(h.details_json,'$.attemptNumber')=a.attempt_number
        AND json_extract(h.details_json,'$.sourceHeadSha')=a.source_head_sha)
      AND EXISTS(SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id
        AND h.sequence=(SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id
          AND reason NOT IN ('review_fix_task_archived','ci_repair_task_archived','preview_slot_leased','preview_slot_released'))
        AND h.from_state='parked_review' AND h.to_state='needs_attention'
        AND h.reason='ci_repair_no_new_head' AND json_extract(h.details_json,'$.attemptId')=a.attempt_id)
      AND a.attempt_state='needs_attention' AND a.result_head_sha IS NULL AND a.completed_at IS NOT NULL
      AND a.failure_reason='No new PR head appeared after the fixer task'
      AND (SELECT COUNT(*) FROM run_codex_tasks tasks WHERE tasks.run_id=r.run_id AND tasks.context_id=a.attempt_id AND tasks.kind='ci_repair')=1
      AND q.action='ci_repair' AND q.request_state='applied'
      AND julianday(ci.last_observed_at)>=julianday(a.completed_at)
      AND ci.repository=r.repository AND ci.head_sha<>a.source_head_sha AND ci.aggregate_state='passed' AND ci.last_error IS NULL
      AND julianday(ci.last_observed_at) BETWEEN julianday('now','-2 minutes') AND julianday('now')
      AND ct.thread_id=a.codex_thread_id AND ct.thread_id<>rr.codex_thread_id AND ct.turn_id IS NOT NULL
      AND ct.phase='terminal' AND ct.turn_status='completed' AND ct.failure_code IS NULL
      AND ct.stopped_at IS NOT NULL AND ct.released_at IS NOT NULL
      AND (ct.stop_requested IS NULL OR ct.stop_requested='release')
      AND julianday(ct.released_at)>=julianday(ct.stopped_at)
      AND ct.worktree_path=rr.worktree_path AND ct.branch_name=rr.branch_name
      AND EXISTS(SELECT 1 FROM run_codex_task_events e WHERE e.task_id=ct.task_id AND e.event_key='terminal:'||ct.turn_id
        AND e.method='turn/completed' AND e.thread_id=ct.thread_id AND e.turn_id=ct.turn_id AND e.status='completed' AND e.failure_code IS NULL)
      AND EXISTS(SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id AND h.reason='ci_repair_task_archived'
        AND h.from_state=h.to_state AND h.to_state IN ('parked_review','needs_attention')
        AND json_extract(h.details_json,'$.attemptId')=a.attempt_id
        AND h.sequence=(SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id AND reason='ci_repair_task_archived')
        AND json_extract(h.details_json,'$.attemptNumber')=a.attempt_number
        AND json_extract(h.details_json,'$.repairCodexThreadId')=ct.thread_id
        AND json_extract(h.details_json,'$.restoredCodexThreadId')=rr.codex_thread_id
        AND h.sequence > (SELECT MAX(sequence) FROM run_state_history WHERE run_id=r.run_id
          AND reason='codex_protocol_park_completed' AND json_extract(details_json,'$.taskId')=ct.task_id))
      AND NOT EXISTS(SELECT 1 FROM run_control_requests pending WHERE pending.run_id=r.run_id
        AND pending.request_state IN ('pending','queued','processing'))
      AND NOT EXISTS(SELECT 1 FROM run_codex_tasks active WHERE active.worktree_path=rr.worktree_path AND active.released_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM run_ai_reviews review WHERE review.run_id=r.run_id)
      AND NOT EXISTS(SELECT 1 FROM run_review_fix_rounds fix WHERE fix.run_id=r.run_id)
      AND NOT EXISTS(SELECT 1 FROM run_autonomous_successions s WHERE s.run_id=r.run_id AND s.succession_state IN ('starting','running'))
      AND NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.project=r.project AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      AND NOT EXISTS(SELECT 1 FROM project_events event WHERE event.project=r.project AND event.item_id=r.item_id
        AND event.processing_state='pending' AND event.from_status IS NOT event.to_status)

      AND NOT EXISTS(SELECT 1 FROM run_ci_repair_attempts active WHERE active.run_id=r.run_id AND active.attempt_state IN ('running','waiting_ci'))
      AND NOT EXISTS(SELECT 1 FROM project_status_requests status WHERE status.project=r.project AND status.item_id=r.item_id
        AND status.request_state IN ('checking','writing','awaiting_sync','uncertain'))
      AND NOT EXISTS(SELECT 1 FROM run_resources other JOIN runs owner USING(run_id)
        WHERE other.worktree_path=rr.worktree_path AND owner.run_id<>r.run_id
          AND (owner.owner_state<>'none' OR other.tmux_session_name IS NOT NULL))
      AND EXISTS(SELECT 1 FROM run_state_history release WHERE release.run_id=r.run_id
        AND release.reason='codex_protocol_park_completed' AND release.to_state='parked_review'
        AND json_extract(release.details_json,'$.taskId')=ct.task_id
        AND json_extract(release.details_json,'$.threadId')=ct.thread_id
        AND json_extract(release.details_json,'$.turnId')=ct.turn_id
        AND json_extract(release.details_json,'$.turnStatus')='completed'
        AND json_extract(release.details_json,'$.failureCode') IS NULL)
`).get(runId);
  if (!row || !/^[0-9a-f]{40,64}$/u.test(String(row.head_sha)) ||
      row.pull_request_url !== `https://github.com/${row.repository}/pull/${row.pull_request_number}`) return null;
  try {
    const checks: unknown = JSON.parse(String(row.checks_json));
    if (!Array.isArray(checks) || checks.length === 0 || checks.some(check => check?.state !== 'passed')) return null;
  } catch { return null; }
  return row;
}

/** Compare the complete selected evidence under the managed-writer SQLite fence.
 * The caller must validate the clean canonical checkout and live PR/branch first. */
export function recoverExternalCiRepair(database: DatabaseSync, candidate: NonNullable<ReturnType<typeof externalCiRepairCandidate>>): boolean {
  database.exec('BEGIN IMMEDIATE');
  try {
    const current = externalCiRepairCandidate(database, String(candidate.run_id));
    if (!current || JSON.stringify(current) !== JSON.stringify(candidate)) {
      database.exec('ROLLBACK');
      return false;
    }
    const changed = database.prepare(`UPDATE runs SET state='parked_review',
      updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE run_id=? AND state='needs_attention' AND owner_state='none'`).run(candidate.run_id!);
    if (changed.changes !== 1) throw new Error('External CI recovery fence changed');
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES (?,'needs_attention','parked_review','ci_repair_external_head_recovered',?)`).run(candidate.run_id!, JSON.stringify({
        attemptId: candidate.attempt_id, attemptNumber: candidate.attempt_number,
        taskId: candidate.task_id, threadId: candidate.thread_id, turnId: candidate.turn_id,
        sourceHeadSha: candidate.source_head_sha, externalHeadSha: candidate.head_sha,
        attentionSequence: candidate.attention_sequence, archiveSequence: candidate.archive_sequence,
        releaseSequence: candidate.release_sequence, historySequence: candidate.history_sequence, ciObservedAt: candidate.last_observed_at,
        pullRequestNumber: candidate.pull_request_number, workerProducedHead: false, repairRetry: false,
      }));
    database.exec('COMMIT');
    return true;
  } catch (error) { database.exec('ROLLBACK'); throw error; }
}

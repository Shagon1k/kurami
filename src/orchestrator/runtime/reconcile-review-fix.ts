import type { DatabaseSync } from "node:sqlite";
import { fail } from "./controller-context.ts";

function markReviewFixNeedsAttention(
  database: DatabaseSync,
  round: { round_id: string; run_id: string; round_number: number; source_head_sha: string },
  reason: string,
  failure: string,
  resultHeadSha: string | null,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const roundChanged = database
      .prepare(
        `UPDATE run_review_fix_rounds
         SET round_state='needs_attention', result_head_sha=?, failure_reason=?,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND round_state IN ('running','waiting_ci','resolving')`,
      )
      .run(resultHeadSha, failure, round.round_id);
    if (roundChanged.changes === 0) {
      database.exec("COMMIT");
      return;
    }
    const changed = database
      .prepare(
        `UPDATE runs SET state='needs_attention', owner_state='none',
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id=? AND state='parked_review' AND owner_state='none'`,
      )
      .run(round.run_id);
    if (changed.changes === 1)
      database
        .prepare(
          `INSERT INTO run_state_history (
             run_id, from_state, to_state, reason, details_json
           ) VALUES (?, 'parked_review', 'needs_attention', ?, ?)`,
        )
        .run(
          round.run_id,
          reason,
          JSON.stringify({
            roundId: round.round_id,
            roundNumber: round.round_number,
            sourceHeadSha: round.source_head_sha,
            resultHeadSha,
            failure,
          }),
        );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function reconcileReviewFixRounds(database: DatabaseSync): void {
  const exhaustedResolution = database
    .prepare(
      `SELECT round_id, run_id, round_number, source_head_sha, result_head_sha
       FROM run_review_fix_rounds
       WHERE round_state='resolving' AND resolution_attempt_count >= 3`,
    )
    .all() as Array<{
    round_id: string;
    run_id: string;
    round_number: number;
    source_head_sha: string;
    result_head_sha: string | null;
  }>;
  for (const round of exhaustedResolution)
    markReviewFixNeedsAttention(
      database,
      round,
      "review_fix_resolution_exhausted",
      "GitHub thread reconciliation failed after 3 attempts",
      round.result_head_sha,
    );
  const rounds = database
    .prepare(
      `SELECT f.round_id, f.run_id, f.round_number, f.source_head_sha,
              f.round_state, f.updated_at, f.waiting_ci_started_at,
              f.repository, f.pull_request_number, f.pull_request_url,
              f.codex_thread_id, r.state AS run_state,
              r.owner_state, rr.tmux_session_name, rr.codex_thread_id AS current_codex_thread_id,
              rr.previous_codex_thread_id,
              ci.repository AS ci_repository,
              ci.pull_request_number AS ci_pull_request_number,
              ci.pull_request_url AS ci_pull_request_url,
              ci.head_sha, ci.aggregate_state, ci.last_error,
              EXISTS (
                SELECT 1 FROM run_review_fix_operations cleanup
                WHERE cleanup.round_id=f.round_id
                  AND cleanup.operation_kind='cleanup'
                  AND cleanup.operation_state='completed'
                  AND cleanup.completed_at IS NOT NULL
                  AND cleanup.task_codex_thread_id=f.codex_thread_id
                  AND cleanup.previous_codex_thread_id=rr.codex_thread_id
              ) AS exact_completed_cleanup_operation,
              EXISTS (
                SELECT 1 FROM run_state_history cleanup_history
                WHERE cleanup_history.run_id=f.run_id
                  AND cleanup_history.reason='review_fix_task_archived'
                  AND json_extract(cleanup_history.details_json, '$.roundId')=f.round_id
                  AND json_extract(
                    cleanup_history.details_json,
                    '$.reviewFixCodexThreadId'
                  )=f.codex_thread_id
                  AND json_extract(
                    cleanup_history.details_json,
                    '$.restoredCodexThreadId'
                  )=rr.codex_thread_id
              ) AS exact_cleanup_history
       FROM run_review_fix_rounds f
       JOIN runs r USING (run_id)
       JOIN run_resources rr USING (run_id)
       LEFT JOIN run_ci_snapshots ci USING (run_id)
       WHERE f.round_state IN ('running','waiting_ci')
       ORDER BY f.created_at, f.round_id`,
    )
    .all() as Array<{
    round_id: string;
    run_id: string;
    round_number: number;
    source_head_sha: string;
    round_state: "running" | "waiting_ci";
    updated_at: string;
    waiting_ci_started_at: string | null;
    repository: string;
    pull_request_number: number;
    pull_request_url: string;
    codex_thread_id: string | null;
    run_state: string;
    owner_state: string;
    tmux_session_name: string | null;
    current_codex_thread_id: string | null;
    previous_codex_thread_id: string | null;
    ci_repository: string | null;
    ci_pull_request_number: number | null;
    ci_pull_request_url: string | null;
    head_sha: string | null;
    aggregate_state: string | null;
    last_error: string | null;
    exact_completed_cleanup_operation: number;
    exact_cleanup_history: number;
  }>;
  for (const round of rounds) {
    if (
      round.round_state === "running" &&
      round.run_state === "parked_review" &&
      round.owner_state === "none" &&
      round.tmux_session_name === null &&
      Boolean(round.codex_thread_id) &&
      round.codex_thread_id === round.current_codex_thread_id &&
      Boolean(round.previous_codex_thread_id)
    ) {
      database
        .prepare(
          `UPDATE run_review_fix_rounds SET round_state='waiting_ci',
             waiting_ci_started_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id=? AND round_state='running'`,
        )
        .run(round.round_id);
      // The writer terminal state and CI snapshot were observed before this
      // transition. A later controller pass must load both again.
      continue;
    }
    if (round.round_state !== "waiting_ci") continue;
    const activeTaskMapping =
      Boolean(round.codex_thread_id) &&
      round.codex_thread_id === round.current_codex_thread_id &&
      Boolean(round.previous_codex_thread_id);
    const cleanupCompletedMapping =
      Boolean(round.codex_thread_id) &&
      Boolean(round.current_codex_thread_id) &&
      round.current_codex_thread_id !== round.codex_thread_id &&
      round.previous_codex_thread_id === null &&
      (round.exact_completed_cleanup_operation === 1 || round.exact_cleanup_history === 1);
    const exactTaskIdentity =
      round.run_state === "parked_review" &&
      round.owner_state === "none" &&
      round.tmux_session_name === null &&
      (activeTaskMapping || cleanupCompletedMapping);
    if (!exactTaskIdentity) continue;
    const exactPullRequestIdentity =
      round.ci_repository?.toLowerCase() === round.repository.toLowerCase() &&
      round.ci_pull_request_number === round.pull_request_number &&
      round.ci_pull_request_url === round.pull_request_url;
    if (!exactPullRequestIdentity) {
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_ci_identity_mismatch",
        "review_fix_ci_identity_mismatch",
        null,
      );
      continue;
    }
    const exactPullRequest = round.last_error === null;
    const newHead =
      exactPullRequest &&
      Boolean(round.head_sha) &&
      round.head_sha !== round.source_head_sha;
    if (newHead && round.aggregate_state === "passed") {
      database
        .prepare(
          `UPDATE run_review_fix_rounds
           SET round_state='resolving', result_head_sha=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id=? AND round_state='waiting_ci'`,
        )
        .run(round.head_sha, round.round_id);
      continue;
    }
    if (newHead && ["failed", "missing"].includes(round.aggregate_state ?? "")) {
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_ci_failed",
        "review_fix_ci_failed",
        round.head_sha,
      );
      continue;
    }
    if (!round.waiting_ci_started_at) continue;
    const ageMinutes =
      (Date.now() - Date.parse(round.waiting_ci_started_at)) / 60_000;
    if (!newHead && ageMinutes >= 10) {
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_no_new_head",
        "review_fix_no_new_head",
        null,
      );
      continue;
    }
    if (
      newHead &&
      ["pending", "unknown"].includes(round.aggregate_state ?? "") &&
      ageMinutes >= 30
    )
      markReviewFixNeedsAttention(
        database,
        round,
        "review_fix_ci_timeout",
        "review_fix_ci_timeout",
        round.head_sha,
      );
  }

  reconcileFalseReviewFixNoNewHead(database);
}

function reconcileFalseReviewFixNoNewHead(database: DatabaseSync): void {
  const candidates = database
    .prepare(
      `SELECT f.round_id, f.run_id, f.round_number, f.source_head_sha,
              f.repository, f.pull_request_number, f.pull_request_url,
              f.codex_thread_id, f.waiting_ci_started_at, f.completed_at,
              r.state AS run_state, r.owner_state, r.stop_reason,
              rr.tmux_session_name, rr.codex_thread_id AS current_codex_thread_id,
              rr.previous_codex_thread_id,
              q.action AS request_action, q.request_state,
              ci.repository AS ci_repository,
              ci.pull_request_number AS ci_pull_request_number,
              ci.pull_request_url AS ci_pull_request_url,
              ci.head_sha, ci.aggregate_state, ci.last_observed_at, ci.last_error,
              EXISTS (
                SELECT 1 FROM run_review_fix_operations cleanup
                WHERE cleanup.round_id=f.round_id
                  AND cleanup.operation_kind='cleanup'
                  AND cleanup.operation_state='completed'
                  AND cleanup.completed_at IS NOT NULL
                  AND cleanup.task_codex_thread_id=f.codex_thread_id
                  AND cleanup.previous_codex_thread_id=rr.codex_thread_id
              ) AS exact_completed_cleanup_operation,
              EXISTS (
                SELECT 1 FROM run_state_history cleanup_history
                WHERE cleanup_history.run_id=f.run_id
                  AND cleanup_history.reason='review_fix_task_archived'
                  AND json_extract(cleanup_history.details_json, '$.roundId')=f.round_id
                  AND json_extract(
                    cleanup_history.details_json,
                    '$.reviewFixCodexThreadId'
                  )=f.codex_thread_id
                  AND json_extract(
                    cleanup_history.details_json,
                    '$.restoredCodexThreadId'
                  )=rr.codex_thread_id
              ) AS exact_cleanup_history,
              (SELECT h.reason FROM run_state_history h
               WHERE h.run_id=f.run_id AND h.to_state='needs_attention'
                 AND h.reason NOT IN (
                   'review_fix_task_archived', 'ci_repair_task_archived'
                 )
               ORDER BY h.sequence DESC LIMIT 1) AS attention_reason,
              (SELECT COUNT(*) FROM run_ci_repair_attempts a
               WHERE a.run_id=f.run_id
                 AND a.attempt_state IN ('running','waiting_ci')) AS active_repair_count,
              (SELECT COUNT(*) FROM run_ai_reviews a
               WHERE a.run_id=f.run_id AND a.review_state='running') AS active_review_count,
              (SELECT COUNT(*) FROM run_review_fix_rounds active
               WHERE active.run_id=f.run_id
                 AND active.round_state IN ('running','waiting_ci','resolving')) AS active_fix_count
       FROM run_review_fix_rounds f
       JOIN runs r USING (run_id)
       JOIN run_resources rr USING (run_id)
       JOIN run_control_requests q ON q.request_id=f.request_id
       JOIN run_ci_snapshots ci USING (run_id)
       WHERE f.round_state='needs_attention'
         AND f.failure_reason IN (
           'review_fix_no_new_head',
           'review_fix_ci_timeout',
           'review_fix_ci_failed',
           'No new PR head appeared after the review fixer task'
         )
         AND NOT EXISTS (
           SELECT 1 FROM run_review_fix_rounds newer
           WHERE newer.run_id=f.run_id AND newer.round_number>f.round_number
         )
       ORDER BY f.completed_at, f.round_id`,
    )
    .all() as Array<{
    round_id: string;
    run_id: string;
    round_number: number;
    source_head_sha: string;
    repository: string;
    pull_request_number: number;
    pull_request_url: string;
    codex_thread_id: string | null;
    waiting_ci_started_at: string | null;
    completed_at: string | null;
    run_state: string;
    owner_state: string;
    stop_reason: string | null;
    tmux_session_name: string | null;
    current_codex_thread_id: string | null;
    previous_codex_thread_id: string | null;
    request_action: string;
    request_state: string;
    ci_repository: string;
    ci_pull_request_number: number | null;
    ci_pull_request_url: string | null;
    head_sha: string | null;
    aggregate_state: string;
    last_observed_at: string;
    last_error: string | null;
    exact_completed_cleanup_operation: number;
    exact_cleanup_history: number;
    attention_reason: string | null;
    active_repair_count: number;
    active_review_count: number;
    active_fix_count: number;
  }>;

  for (const round of candidates) {
    const observedAt = Date.parse(round.last_observed_at);
    const failedAt = Date.parse(round.completed_at ?? "");
    const subsequentObservation =
      Number.isFinite(observedAt) &&
      Number.isFinite(failedAt) &&
      observedAt <= Date.now() &&
      observedAt > failedAt;
    const activeTaskMapping =
      Boolean(round.codex_thread_id) &&
      round.codex_thread_id === round.current_codex_thread_id &&
      Boolean(round.previous_codex_thread_id) &&
      round.previous_codex_thread_id !== round.codex_thread_id;
    const cleanupCompletedMapping =
      Boolean(round.codex_thread_id) &&
      Boolean(round.current_codex_thread_id) &&
      round.current_codex_thread_id !== round.codex_thread_id &&
      round.previous_codex_thread_id === null &&
      (round.exact_completed_cleanup_operation === 1 ||
        round.exact_cleanup_history === 1);
    const exactDelivery =
      round.run_state === "needs_attention" &&
      round.owner_state === "none" &&
      round.stop_reason === null &&
      (round.attention_reason === "review_fix_no_new_head" ||
        round.attention_reason === "review_fix_ci_timeout" ||
        round.attention_reason === "review_fix_ci_failed") &&
      round.request_action === "review_fix" &&
      round.request_state === "applied" &&
      round.tmux_session_name === null &&
      (activeTaskMapping || cleanupCompletedMapping) &&
      round.active_repair_count === 0 &&
      round.active_review_count === 0 &&
      round.active_fix_count === 0 &&
      round.last_error === null &&
      round.ci_repository.toLowerCase() === round.repository.toLowerCase() &&
      round.ci_pull_request_number === round.pull_request_number &&
      round.ci_pull_request_url === round.pull_request_url &&
      Boolean(round.head_sha) &&
      round.head_sha !== round.source_head_sha &&
      subsequentObservation &&
      ["pending", "passed", "failed", "missing"].includes(
        round.aggregate_state,
      );
    if (!exactDelivery || !round.head_sha) continue;

    if (["failed", "missing"].includes(round.aggregate_state)) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const changed = database
          .prepare(
            `UPDATE run_review_fix_rounds
             SET result_head_sha=?, failure_reason='review_fix_ci_failed',
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE round_id=? AND round_state='needs_attention'
               AND failure_reason IN (
                 'review_fix_no_new_head',
                 'review_fix_ci_timeout',
                 'review_fix_ci_failed',
                 'No new PR head appeared after the review fixer task'
               )`,
          )
          .run(round.head_sha, round.round_id);
        if (changed.changes !== 1)
          fail("Review-fix no-new-head state changed during reconciliation");
        database
          .prepare(
            `INSERT INTO run_state_history (
               run_id, from_state, to_state, reason, details_json
             ) VALUES (?, 'needs_attention', 'needs_attention',
               'review_fix_ci_failed', ?)`,
          )
          .run(
            round.run_id,
            JSON.stringify({
              roundId: round.round_id,
              roundNumber: round.round_number,
              sourceHeadSha: round.source_head_sha,
              resultHeadSha: round.head_sha,
              recoveredFrom: "review_fix_no_new_head",
            }),
          );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      continue;
    }

    const targetState =
      round.aggregate_state === "passed" ? "resolving" : "waiting_ci";
    database.exec("BEGIN IMMEDIATE");
    try {
      const roundChanged = database
        .prepare(
          `UPDATE run_review_fix_rounds
           SET round_state=?, result_head_sha=?, failure_reason=NULL,
               completed_at=NULL,
               -- A recovered round begins a new CI-observation boundary.
               -- Reusing the pre-attention clock can immediately turn fresh
               -- pending or passed CI into a false timeout.
               waiting_ci_started_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id=? AND round_state='needs_attention'
             AND failure_reason IN (
               'review_fix_no_new_head',
               'review_fix_ci_timeout',
               'review_fix_ci_failed',
               'No new PR head appeared after the review fixer task'
             )`,
        )
        .run(targetState, round.head_sha, round.round_id);
      const runChanged = database
        .prepare(
          `UPDATE runs SET state='parked_review', owner_state='none',
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE run_id=? AND state='needs_attention' AND owner_state='none'
             AND stop_reason IS NULL`,
        )
        .run(round.run_id);
      if (roundChanged.changes !== 1 || runChanged.changes !== 1)
        fail("Review-fix no-new-head recovery state changed during reconciliation");
      database
        .prepare(
          `INSERT INTO run_state_history (
             run_id, from_state, to_state, reason, details_json
           ) VALUES (?, 'needs_attention', 'parked_review',
             'review_fix_no_new_head_recovered', ?)`,
        )
        .run(
          round.run_id,
          JSON.stringify({
            roundId: round.round_id,
            roundNumber: round.round_number,
            sourceHeadSha: round.source_head_sha,
            resultHeadSha: round.head_sha,
            ciState: round.aggregate_state,
          }),
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  }
}

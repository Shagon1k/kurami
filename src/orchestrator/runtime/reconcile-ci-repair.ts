import type { DatabaseSync } from "node:sqlite";

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

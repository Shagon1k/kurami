import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  createGitHubAppInstallationToken,
  loadGitHubAppCredentialsFromFile,
  loadOwnerGitHubTokenFromFile,
} from "./github-app-auth.ts";
import { replyAndResolveReviewThread } from "./github-review-threads.ts";

process.umask(0o077);

const orchestratorHome = resolve(
  process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");

function fail(message: string): never {
  throw new Error(message);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const roundIndex = args.indexOf("--round-id");
  const roundId = roundIndex >= 0 ? args[roundIndex + 1]?.trim() : undefined;
  const apply = args.includes("--apply");
  const known = new Set([command, "--round-id", roundId, "--apply"]);
  if (
    !["resolve", "recover"].includes(command ?? "") ||
    !roundId ||
    !/^rfr_[a-f0-9]+$/u.test(roundId) ||
    args.some((arg) => !known.has(arg))
  )
    fail(
      "Usage: review-fix-manager.ts <resolve|recover> --round-id <round_id> [--apply]",
    );
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  try {
    if (command === "recover") {
      const recovery = database
        .prepare(
          `SELECT f.round_id, f.run_id, f.round_number, f.round_state,
                  f.result_head_sha, f.resolution_attempt_count, f.failure_reason,
                  r.state AS run_state, r.owner_state,
                  rr.codex_thread_id, rr.previous_codex_thread_id,
                  rr.tmux_session_name,
                  ci.head_sha AS ci_head_sha, ci.aggregate_state AS ci_state
           FROM run_review_fix_rounds f
           JOIN runs r ON r.run_id=f.run_id
           JOIN run_resources rr ON rr.run_id=f.run_id
           LEFT JOIN run_ci_snapshots ci ON ci.run_id=f.run_id
           WHERE f.round_id=?`,
        )
        .get(roundId) as
        | {
            round_id: string;
            run_id: string;
            round_number: number;
            round_state: string;
            result_head_sha: string | null;
            resolution_attempt_count: number;
            failure_reason: string | null;
            run_state: string;
            owner_state: string;
            codex_thread_id: string | null;
            previous_codex_thread_id: string | null;
            tmux_session_name: string | null;
            ci_head_sha: string | null;
            ci_state: string | null;
          }
        | undefined;
      if (
        !recovery ||
        recovery.round_state !== "needs_attention" ||
        !recovery.failure_reason?.startsWith(
          "GitHub thread reconciliation failed after 3 attempts:",
        ) ||
        !recovery.result_head_sha ||
        recovery.run_state !== "needs_attention" ||
        recovery.owner_state !== "none" ||
        !recovery.codex_thread_id ||
        recovery.previous_codex_thread_id !== null ||
        recovery.tmux_session_name !== null ||
        recovery.ci_head_sha !== recovery.result_head_sha ||
        recovery.ci_state !== "passed"
      )
        fail("Review fix round is not eligible for resolution-only recovery");
      const plan = {
        roundId,
        runId: recovery.run_id,
        roundNumber: recovery.round_number,
        resultHeadSha: recovery.result_head_sha,
        previousAttempts: recovery.resolution_attempt_count,
        action: "retry_github_resolution_only",
      };
      if (!apply) {
        process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
        return;
      }
      database.exec("BEGIN IMMEDIATE");
      try {
        const roundChanged = database
          .prepare(
            `UPDATE run_review_fix_rounds
             SET round_state='resolving', resolution_attempt_count=0,
                 failure_reason=NULL, completed_at=NULL,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE round_id=? AND round_state='needs_attention'
               AND resolution_attempt_count=3`,
          )
          .run(roundId);
        const runChanged = database
          .prepare(
            `UPDATE runs SET state='parked_review', owner_state='none',
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE run_id=? AND state='needs_attention' AND owner_state='none'`,
          )
          .run(recovery.run_id);
        if (roundChanged.changes !== 1 || runChanged.changes !== 1)
          fail("Review fix recovery state changed before it could be claimed");
        database
          .prepare(
            `UPDATE run_review_fix_threads
             SET thread_state='pending', failure_reason=NULL,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE round_id=? AND thread_state='failed'`,
          )
          .run(roundId);
        database
          .prepare(
            `INSERT INTO run_state_history (
               run_id, from_state, to_state, reason, details_json
             ) VALUES (?, 'needs_attention', 'parked_review',
               'review_fix_resolution_recovery_requested', ?)`,
          )
          .run(
            recovery.run_id,
            JSON.stringify({
              roundId,
              roundNumber: recovery.round_number,
              resultHeadSha: recovery.result_head_sha,
            }),
          );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, ...plan })}\n`,
      );
      return;
    }
    const round = database
      .prepare(
        `SELECT round_id, run_id, round_number, round_state, repository,
                pull_request_number, result_head_sha, resolution_attempt_count
         FROM run_review_fix_rounds WHERE round_id = ?`,
      )
      .get(roundId) as
      | {
          round_id: string;
          run_id: string;
          round_number: number;
          round_state: string;
          repository: string;
          pull_request_number: number;
          result_head_sha: string | null;
          resolution_attempt_count: number;
        }
      | undefined;
    if (!round || round.round_state !== "resolving" || !round.result_head_sha)
      fail("Review fix round is not ready to resolve threads");
    const threads = database
      .prepare(
        `SELECT thread_id, root_comment_id, thread_state
         FROM run_review_fix_threads WHERE round_id = ? ORDER BY rowid`,
      )
      .all(roundId) as Array<{
      thread_id: string;
      root_comment_id: number;
      thread_state: string;
    }>;
    const plan = {
      roundId,
      runId: round.run_id,
      resultHeadSha: round.result_head_sha,
      threads: threads.length,
      pending: threads.filter((thread) => thread.thread_state !== "resolved").length,
    };
    if (!apply) {
      process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
      return;
    }
    database
      .prepare(
        `UPDATE run_review_fix_rounds
         SET resolution_attempt_count=resolution_attempt_count+1,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND round_state='resolving'
           AND resolution_attempt_count < 3`,
      )
      .run(roundId);
    const credentials = await loadGitHubAppCredentialsFromFile(orchestratorHome);
    const replyToken = await createGitHubAppInstallationToken(credentials);
    const resolveToken = await loadOwnerGitHubTokenFromFile(orchestratorHome);
    for (const thread of threads) {
      if (thread.thread_state === "resolved") continue;
      const body = [
        `🤖 Fixed by Kurami in \`${round.result_head_sha.slice(0, 12)}\` after CI passed.`,
        `<!-- kurami-review-fix:${round.round_id}:${thread.thread_id} -->`,
      ].join("\n\n");
      try {
        const replyId = await replyAndResolveReviewThread(
          replyToken,
          resolveToken,
          round.repository,
          round.pull_request_number,
          thread.thread_id,
          thread.root_comment_id,
          body,
        );
        database
          .prepare(
            `UPDATE run_review_fix_threads
             SET thread_state='resolved', reply_comment_id=?, failure_reason=NULL,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE round_id=? AND thread_id=?`,
          )
          .run(replyId, roundId, thread.thread_id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        database
          .prepare(
            `UPDATE run_review_fix_threads
             SET thread_state='failed', failure_reason=?,
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE round_id=? AND thread_id=?`,
          )
          .run(message.slice(0, 500), roundId, thread.thread_id);
        if (round.resolution_attempt_count >= 2) {
          database
            .prepare(
              `UPDATE run_review_fix_rounds
               SET round_state='needs_attention', failure_reason=?,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
                   completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE round_id=? AND round_state='resolving'`,
            )
            .run(`GitHub thread reconciliation failed after 3 attempts: ${message}`.slice(0, 500), roundId);
          const current = database
            .prepare(`SELECT state FROM runs WHERE run_id=?`)
            .get(round.run_id) as { state: string };
          database
            .prepare(
              `UPDATE runs SET state='needs_attention', owner_state='none',
                 updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
               WHERE run_id=? AND state='parked_review' AND owner_state='none'`,
            )
            .run(round.run_id);
          database
            .prepare(
              `INSERT INTO run_state_history (
                 run_id, from_state, to_state, reason, details_json
               ) VALUES (?, ?, 'needs_attention', 'review_fix_resolution_exhausted', ?)`,
            )
            .run(round.run_id, current.state, JSON.stringify({ roundId, error: message.slice(0, 500) }));
        }
        throw error;
      }
    }
    database
      .prepare(
        `UPDATE run_review_fix_rounds
         SET round_state='succeeded', failure_reason=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND round_state='resolving'`,
      )
      .run(roundId);
    process.stdout.write(`${JSON.stringify({ ok: true, apply: true, action: "review_fix_threads_resolved", ...plan })}\n`);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});

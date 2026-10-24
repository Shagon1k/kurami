import type { DatabaseSync } from "node:sqlite";
import { loadOwnerGitHubTokenFromFile } from "../../integrations/github/app-auth.ts";
import {
  ownerSourceEffects,
  type SourceEffects,
} from "../worktrees/refresh-source.ts";
import {
  inspectInterruptedReviewFix,
  dirtyReviewFixSnapshot,
  interruptedReviewFixAction,
} from "../../runtime/interrupted-review-fix-recovery.ts";
import { startSession, validateAndPlan } from "./session-start.ts";
import {
  appendHistory,
  fail,
  git,
  orchestratorHome,
} from "./session-shared.ts";
import type {
  OrchestratorConfig,
  ProjectsRegistry,
  SessionRun,
} from "./session-types.ts";

/** Fresh bounded worker for the preserved round; never resume the failed thread.
 * The claim is durable before launch. Any crash after claim requires inspection,
 * not an automatic second dispatch, including a crash before tmux creation. */
export async function recoverInterruptedReviewFix(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  config: OrchestratorConfig,
  requestId: string,
  apply: boolean,
  suppliedEffects?: SourceEffects,
): Promise<void> {
  if (config.mode !== "live" || run.execution_mode !== "live")
    fail("Interrupted review recovery requires live mode");
  const previous = database
    .prepare(
      "SELECT * FROM run_interrupted_review_fix_recoveries WHERE request_id=?",
    )
    .get(requestId);
  if (previous)
    fail(
      "Recovery already claimed; inspect the receipt; automatic redispatch is forbidden",
    );
  const project = registry.projects[run.project];
  const effects =
    suppliedEffects ??
    ownerSourceEffects(await loadOwnerGitHubTokenFromFile(orchestratorHome));
  const original = inspectInterruptedReviewFix(
    database,
    run.run_id,
    project,
    requestId,
    effects,
  );
  const plan = await validateAndPlan(
    run,
    registry,
    null,
    original.context,
    original,
  );
  plan.tmuxSessionName = `cx-recovery-${requestId.replace(/^rq_/u, "")}`;
  if (!/^cx-recovery-[a-zA-Z0-9]+$/u.test(plan.tmuxSessionName))
    fail("Unsafe recovery request identity");
  plan.initialPrompt +=
    "\n\nInterrupted-worker recovery: preserve and inspect the existing staged, unstaged and untracked work. It is partial implementation, not delivery evidence. Finish only the original review snapshot above. Do not reset, clean, stash, discard or resume the old worker.\n";
  const claim = (maxSessions: number) => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const fresh = inspectInterruptedReviewFix(
        database,
        run.run_id,
        project,
        requestId,
        effects,
      );
      if (
        fresh.taskId !== original.taskId ||
        fresh.digest !== original.digest ||
        fresh.roundId !== original.roundId
      )
        fail("Preserved task or dirty bytes changed before claim");
      const count = database
        .prepare(
          `SELECT count(*) AS n FROM run_resources WHERE tmux_session_name IS NOT NULL`,
        )
        .get()!;
      if (Number(count.n) >= maxSessions)
        fail("Managed session mapping cap reached");
      database
        .prepare(
          `INSERT INTO run_interrupted_review_fix_recoveries
        (request_id,round_id,predecessor_task_id,dirty_digest,dirty_snapshot_json,session_name)
        VALUES (?,?,?,?,?,?)`,
        )
        .run(
          requestId,
          original.roundId,
          original.taskId,
          original.digest,
          original.snapshotJson,
          plan.tmuxSessionName,
        );
      database
        .prepare(
          `UPDATE runs SET state='parked_review',owner_state='cli',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE run_id=?`,
        )
        .run(run.run_id);
      // Keep the original primary thread for the existing cleanup lifecycle.
      database
        .prepare(
          `UPDATE run_resources SET tmux_session_name=?,codex_thread_id=NULL,
        updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?`,
        )
        .run(plan.tmuxSessionName, run.run_id);
      database
        .prepare(
          `UPDATE run_review_fix_rounds SET round_state='running',codex_thread_id=NULL,
        failure_reason=NULL,completed_at=NULL,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE round_id=?`,
        )
        .run(original.roundId);
      appendHistory(
        database,
        run.run_id,
        "needs_attention",
        "parked_review",
        "interrupted_review_fix_claimed",
        {
          requestId,
          roundId: original.roundId,
          predecessorTaskId: original.taskId,
          dirtyDigest: original.digest,
        },
      );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  const beforeDispatch = () => {
    database.exec("BEGIN IMMEDIATE");
    try {
      const mapped = database
        .prepare(
          `SELECT r.state,r.owner_state,r.stop_reason,rr.* FROM runs r
        JOIN run_resources rr USING(run_id) WHERE run_id=?`,
        )
        .get(run.run_id)!;
      if (
        mapped.state !== "parked_review" ||
        mapped.owner_state !== "cli" ||
        mapped.stop_reason !== null ||
        mapped.tmux_session_name !== plan.tmuxSessionName ||
        mapped.codex_thread_id !== null ||
        mapped.previous_codex_thread_id !== run.previous_codex_thread_id ||
        mapped.worktree_path !== original.worktreePath ||
        mapped.branch_name !== original.branchName
      )
        fail("Recovery ownership changed before dispatch");
      if (
        database
          .prepare(
            `SELECT 1 FROM run_control_requests WHERE run_id=? AND request_id<>?
        AND request_state IN ('pending','processing')`,
          )
          .get(run.run_id, requestId)
      )
        fail("Competing control before dispatch");
      effects.noWriter(original.worktreePath);
      const pull = effects.pull(
        project.repository,
        original.context.pullRequestNumber,
      );
      if (
        pull.number !== original.context.pullRequestNumber ||
        pull.html_url !== original.context.pullRequestUrl ||
        pull.state !== "open" ||
        pull.merged ||
        pull.head.sha !== original.sourceHeadSha ||
        pull.head.ref !== original.branchName ||
        pull.head.repo.full_name !== project.repository ||
        pull.base.ref !== project.workspace.base_branch ||
        pull.base.repo.full_name !== project.repository ||
        effects.remoteHead(project.repository, original.branchName) !==
          original.sourceHeadSha ||
        git(original.worktreePath, ["rev-parse", "HEAD"]) !==
          original.sourceHeadSha ||
        git(original.worktreePath, ["branch", "--show-current"]) !==
          original.branchName ||
        dirtyReviewFixSnapshot(original.worktreePath).digest !== original.digest
      )
        fail("Recovery source or dirty bytes changed before dispatch");
      if (
        !database
          .prepare(
            `SELECT 1 FROM run_control_requests WHERE request_id=? AND run_id=?
        AND action=? AND request_state IN ('pending','processing')`,
          )
          .get(requestId, run.run_id, interruptedReviewFixAction)
      )
        fail("Recovery owner request changed before dispatch");
      const receipt = database
        .prepare(
          `UPDATE run_interrupted_review_fix_recoveries
        SET dispatch_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE request_id=? AND dispatch_started_at IS NULL`,
        )
        .run(requestId);
      if (receipt.changes !== 1) fail("Recovery dispatch already attempted");
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  await startSession(database, run, plan, config, apply, {
    claim,
    beforeDispatch,
  });
  if (apply)
    database
      .prepare(
        `UPDATE run_control_requests SET request_state='applied',
    result_json=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=?
    AND action=? AND request_state IN ('pending','processing')`,
      )
      .run(
        JSON.stringify({
          action: interruptedReviewFixAction,
          roundId: original.roundId,
          predecessorTaskId: original.taskId,
          dirtyDigest: original.digest,
        }),
        requestId,
        interruptedReviewFixAction,
      );
}

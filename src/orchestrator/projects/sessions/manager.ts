import { taskForSession } from "../../integrations/codex/task-store.ts";
import { readFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { archiveThread, findAndNameThread } from "../../integrations/codex/app-server.ts";
import {
  inspectManagedReviewFixRecovery,
  loadManagedReviewFixRecoverySnapshot,
} from "../../runtime/managed-task-recovery.ts";
import { cancelCliSession, finalizeStop, guardReviewFixDelivery, leaveCliSession } from "./session-stop.ts";
import { loadRepairContext, loadReviewFixContext, startSession, validateAndPlan } from "./session-start.ts";
import { codexTitle } from "./prompts.ts";
import {
  appendHistory,
  capturePane,
  configPath,
  databasePath,
  fail,
  git,
  killTmuxSession,
  loadRun,
  orchestratorHome,
  projectsPath,
  runFile,
  tmuxSessionExists,
} from "./session-shared.ts";
import type {
  Action,
  Arguments,
  OrchestratorConfig,
  ProjectsRegistry,
  ReviewFixDeliveryRound,
  ReviewFixOperation,
  SessionRun,
} from "./session-types.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";

export { initialPrompt, reviewFixPrompt } from "./prompts.ts";

process.umask(0o077);

function parseArguments(): Arguments {
  const args = process.argv.slice(2);
  const action = args[0] as Action | undefined;
  const runIndex = args.indexOf("--run-id");
  const runId = runIndex >= 0 ? args[runIndex + 1]?.trim() : undefined;
  const requestIndex = args.indexOf("--request-id");
  const requestId =
    requestIndex >= 0 ? args[requestIndex + 1]?.trim() : undefined;
  const known = new Set([
    action,
    "--run-id",
    runId,
    "--request-id",
    requestId,
    "--apply",
  ]);
  const unknown = args.filter((arg) => !known.has(arg));

  if (
    (action !== "start" &&
      action !== "repair" &&
      action !== "cleanup-repair" &&
      action !== "review-fix" &&
      action !== "cleanup-review-fix" &&
      action !== "recover-managed-task" &&
      action !== "sync" &&
      action !== "inspect" &&
      action !== "cancel" &&
      action !== "park" &&
      action !== "handoff" &&
      action !== "finalize-stop") ||
    !runId ||
    (["repair", "review-fix", "recover-managed-task"].includes(action)
      ? !requestId
      : Boolean(requestId)) ||
    unknown.length > 0 ||
    (action === "inspect" && args.includes("--apply"))
  ) {
    fail(
      "Usage: session-manager.ts <start|repair|cleanup-repair|review-fix|cleanup-review-fix|recover-managed-task|sync|inspect|cancel|park|handoff|finalize-stop> --run-id <run_id> [--request-id <request_id>] [--apply]",
    );
  }
  return { action, runId, requestId, apply: args.includes("--apply") };
}

async function syncSession(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  apply: boolean,
): Promise<void> {
  const task = taskForSession(database,run.tmux_session_name);
  if (task) {
    process.stdout.write(`${JSON.stringify({ok:true,apply,action:task.thread_id ? "protocol_bound" : "protocol_pending",taskId:task.task_id,threadId:task.thread_id,turnId:task.turn_id})}\n`);
    return;
  }
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  if (!run.tmux_session_name || !tmuxSessionExists(run.tmux_session_name)) {
    fail(`Managed tmux session is not alive for run: ${run.run_id}`);
  }
  const activeRepair = database
    .prepare(
      `SELECT attempt_id, attempt_number FROM run_ci_repair_attempts
       WHERE run_id = ? AND attempt_state = 'running'
       ORDER BY attempt_number DESC LIMIT 1`,
    )
    .get(run.run_id) as
    | { attempt_id: string; attempt_number: number }
    | undefined;
  const activeReviewFix = database
    .prepare(
      `SELECT round_id, round_number FROM run_review_fix_rounds
       WHERE run_id = ? AND round_state = 'running'
       ORDER BY round_number DESC LIMIT 1`,
    )
    .get(run.run_id) as
    | { round_id: string; round_number: number }
    | undefined;
  const activeSuccessor = database
    .prepare(
      `SELECT succession_id, succession_number
       FROM run_autonomous_successions
       WHERE run_id=? AND succession_state IN ('starting','running')
       ORDER BY succession_number DESC LIMIT 1`,
    )
    .get(run.run_id) as
    | { succession_id: string; succession_number: number }
    | undefined;
  const title = activeSuccessor
    ? `${codexTitle(run, project)} · Autonomous continuation ${activeSuccessor.succession_number}`
    : activeRepair
    ? `${codexTitle(run, project)} · CI fix ${activeRepair.attempt_number}/2`
    : activeReviewFix
      ? `${codexTitle(run, project)} · Review fix ${activeReviewFix.round_number}`
    : codexTitle(run, project);
  const result = apply
    ? await findAndNameThread(
        planCodexBin(run.worktree_path),
        run.worktree_path!,
        title,
      )
    : {
        threadId: run.codex_thread_id,
        previousName: null,
        currentName: null,
        renamed: false,
      };
  const threadId = run.codex_thread_id ?? result.threadId;

  const plan = {
    runId: run.run_id,
    tmuxSessionName: run.tmux_session_name,
    codexTitle: title,
    threadId,
    previousName: result.previousName,
    currentName: result.currentName,
    renamed: result.renamed,
    action: threadId ? "record" : "pending",
  };
  if (!apply || !threadId) {
    process.stdout.write(`${JSON.stringify({ ok: true, apply, plan })}\n`);
    return;
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      !["starting", "running", "parked_review"].includes(current.run_state) ||
      current.owner_state !== "cli"
    ) {
      fail(
        `Run is not syncable: state=${current.run_state}, owner=${current.owner_state}`,
      );
    }
    database
      .prepare(
        `
        UPDATE runs
        SET state = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(current.run_state === "starting" ? "running" : current.run_state, run.run_id);
    database
      .prepare(
        `
        UPDATE run_resources
        SET codex_thread_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(threadId, run.run_id);
    if (activeRepair) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts SET codex_thread_id = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'running'`,
        )
        .run(threadId, activeRepair.attempt_id);
    }
    if (activeReviewFix) {
      database
        .prepare(
          `UPDATE run_review_fix_rounds SET codex_thread_id = ?,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id = ? AND round_state = 'running'`,
        )
        .run(threadId, activeReviewFix.round_id);
    }
    if (activeSuccessor) {
      database
        .prepare(
          `UPDATE run_autonomous_successions
           SET successor_thread_id=?, succession_state='running',
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE succession_id=? AND succession_state IN ('starting','running')`,
        )
        .run(threadId, activeSuccessor.succession_id);
    }
    const synchronizedState =
      current.run_state === "starting" ? "running" : current.run_state;
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      synchronizedState,
      activeRepair
        ? "ci_repair_thread_synchronized"
        : activeReviewFix
          ? "review_fix_thread_synchronized"
          : activeSuccessor
            ? "autonomous_successor_thread_synchronized"
            : "codex_thread_synchronized",
      { codexThreadId: threadId, codexTitle: title },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, apply: true, ...plan })}\n`,
  );
}

function planCodexBin(worktreePath: string | null): string {
  const requestedCodex = process.env.CODEX_BIN?.trim() || "codex";
  if (requestedCodex.includes("/")) return resolve(requestedCodex);
  return runFile("which", [requestedCodex]);
}

async function cleanupRepairSession(
  database: DatabaseSync,
  run: SessionRun,
  apply: boolean,
): Promise<void> {
  if (
    ![
      "parked_review",
      "needs_attention",
      "stopping",
      "archived",
      "cancelled",
    ].includes(run.run_state) ||
    run.owner_state !== "none" ||
    run.tmux_session_name !== null ||
    !run.codex_thread_id ||
    !run.previous_codex_thread_id
  ) {
    fail(
      `Run is not ready for CI repair cleanup: state=${run.run_state}, owner=${run.owner_state}, tmux=${run.tmux_session_name ?? "none"}, currentThread=${run.codex_thread_id ?? "none"}, previousThread=${run.previous_codex_thread_id ?? "none"}`,
    );
  }
  const attempt = database
    .prepare(
      `SELECT attempt_id, attempt_number, attempt_state, codex_thread_id
       FROM run_ci_repair_attempts
       WHERE run_id = ? AND codex_thread_id = ?
       ORDER BY attempt_number DESC LIMIT 1`,
    )
    .get(run.run_id, run.codex_thread_id) as
    | {
        attempt_id: string;
        attempt_number: number;
        attempt_state: string;
        codex_thread_id: string;
      }
    | undefined;
  if (!attempt || attempt.attempt_state === "running") {
    fail("Run has no completed CI repair task ready for cleanup");
  }
  const plan = {
    runId: run.run_id,
    attemptId: attempt.attempt_id,
    attemptNumber: attempt.attempt_number,
    attemptState: attempt.attempt_state,
    repairCodexThreadId: run.codex_thread_id,
    restoredCodexThreadId: run.previous_codex_thread_id,
    action: "archive_repair_and_restore_main",
  };
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, plan })}\n`,
    );
    return;
  }
  if (run.execution_mode !== "live") {
    fail(`Refusing CI repair cleanup for execution_mode=${run.execution_mode}`);
  }

  await archiveThread(planCodexBin(run.worktree_path), run.codex_thread_id);

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.owner_state !== "none" ||
      current.tmux_session_name !== null ||
      current.codex_thread_id !== run.codex_thread_id ||
      current.previous_codex_thread_id !== run.previous_codex_thread_id
    ) {
      fail("Run changed during CI repair task cleanup");
    }
    const changed = database
      .prepare(
        `UPDATE run_resources
         SET codex_thread_id = previous_codex_thread_id,
             previous_codex_thread_id = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND codex_thread_id = ?
           AND previous_codex_thread_id = ?`,
      )
      .run(
        run.run_id,
        run.codex_thread_id,
        run.previous_codex_thread_id,
      );
    if (changed.changes !== 1) {
      fail("Run resource mapping changed during CI repair task cleanup");
    }
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      current.run_state,
      "ci_repair_task_archived",
      {
        attemptId: attempt.attempt_id,
        attemptNumber: attempt.attempt_number,
        repairCodexThreadId: run.codex_thread_id,
        restoredCodexThreadId: run.previous_codex_thread_id,
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }

  process.stdout.write(
    `${JSON.stringify({ ok: true, apply: true, ...plan, archived: true })}\n`,
  );
}

async function cleanupReviewFixSession(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  apply: boolean,
): Promise<void> {
  if (
    !["parked_review", "needs_attention", "stopping", "archived", "cancelled"].includes(
      run.run_state,
    ) ||
    run.owner_state !== "none" ||
    run.tmux_session_name !== null ||
    !run.codex_thread_id ||
    !run.previous_codex_thread_id
  )
    fail("Run is not ready for review fix cleanup");
  const round = database
    .prepare(
      `SELECT round_id, round_number, round_state, source_head_sha,
              codex_thread_id, failure_reason
       FROM run_review_fix_rounds
       WHERE run_id = ? AND codex_thread_id = ?
       ORDER BY round_number DESC LIMIT 1`,
    )
    .get(run.run_id, run.codex_thread_id) as
    | ReviewFixDeliveryRound
    | undefined;
  if (!round || ["running", "waiting_ci", "resolving"].includes(round.round_state))
    fail("Run has no completed review fix task ready for cleanup");
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  let operation = database
    .prepare(
      `SELECT operation_state, request_id, task_codex_thread_id,
              previous_codex_thread_id, tmux_session_name, result_head_sha
       FROM run_review_fix_operations
       WHERE round_id=? AND operation_kind='cleanup'`,
    )
    .get(round.round_id) as ReviewFixOperation | undefined;
  if (!operation)
    await guardReviewFixDelivery(database, run, project, round, false, apply);
  const plan = {
    runId: run.run_id,
    roundId: round.round_id,
    roundNumber: round.round_number,
    roundState: round.round_state,
    reviewFixCodexThreadId: run.codex_thread_id,
    restoredCodexThreadId: run.previous_codex_thread_id,
    action: "archive_review_fix_and_restore_main",
  };
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
    return;
  }
  if (run.execution_mode !== "live")
    fail(`Refusing review fix cleanup for execution_mode=${run.execution_mode}`);

  if (!operation) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = loadRun(database, run.run_id);
      const currentRound = database
        .prepare(
          `SELECT round_state, codex_thread_id
           FROM run_review_fix_rounds WHERE round_id=? AND run_id=?`,
        )
        .get(round.round_id, run.run_id) as
        | { round_state: string; codex_thread_id: string | null }
        | undefined;
      if (
        current.owner_state !== "none" ||
        current.tmux_session_name !== null ||
        current.codex_thread_id !== run.codex_thread_id ||
        current.previous_codex_thread_id !== run.previous_codex_thread_id ||
        !currentRound ||
        ["running", "waiting_ci", "resolving"].includes(
          currentRound.round_state,
        ) ||
        currentRound.codex_thread_id !== run.codex_thread_id
      )
        fail("Run changed before review fix cleanup claim");
      database
        .prepare(
          `INSERT INTO run_review_fix_operations (
             round_id, operation_kind, operation_state,
             task_codex_thread_id, previous_codex_thread_id
           ) VALUES (?, 'cleanup', 'claimed', ?, ?)`,
        )
        .run(
          round.round_id,
          run.codex_thread_id,
          run.previous_codex_thread_id,
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    operation = {
      operation_state: "claimed",
      request_id: null,
      task_codex_thread_id: run.codex_thread_id,
      previous_codex_thread_id: run.previous_codex_thread_id,
      tmux_session_name: null,
      result_head_sha: null,
    };
  }
  if (
    operation.request_id !== null ||
    operation.task_codex_thread_id !== run.codex_thread_id ||
    operation.previous_codex_thread_id !== run.previous_codex_thread_id ||
    operation.tmux_session_name !== null
  )
    fail("Review fix cleanup operation identity does not match the run");
  if (operation.operation_state === "claimed") {
    await archiveThread(planCodexBin(run.worktree_path), run.codex_thread_id);
    const recorded = database
      .prepare(
        `UPDATE run_review_fix_operations
         SET operation_state='side_effect_succeeded', failure_reason=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND operation_kind='cleanup'
           AND operation_state='claimed'
           AND task_codex_thread_id=? AND previous_codex_thread_id=?`,
      )
      .run(
        round.round_id,
        run.codex_thread_id,
        run.previous_codex_thread_id,
      );
    if (recorded.changes !== 1)
      fail("Review fix cleanup operation changed after archival");
    operation.operation_state = "side_effect_succeeded";
  }
  if (operation.operation_state !== "side_effect_succeeded")
    fail("Review fix cleanup operation is not ready to finalize");
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.owner_state !== "none" ||
      current.tmux_session_name !== null ||
      current.codex_thread_id !== run.codex_thread_id ||
      current.previous_codex_thread_id !== run.previous_codex_thread_id
    )
      fail("Run changed during review fix task cleanup");
    const changed = database
      .prepare(
        `UPDATE run_resources
         SET codex_thread_id = previous_codex_thread_id,
             previous_codex_thread_id = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND codex_thread_id = ?
           AND previous_codex_thread_id = ?`,
      )
      .run(run.run_id, run.codex_thread_id, run.previous_codex_thread_id);
    if (changed.changes !== 1)
      fail("Run resource mapping changed during review fix task cleanup");
    const operationChanged = database
      .prepare(
        `UPDATE run_review_fix_operations
         SET operation_state='completed', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND operation_kind='cleanup'
           AND operation_state='side_effect_succeeded'
           AND task_codex_thread_id=? AND previous_codex_thread_id=?`,
      )
      .run(
        round.round_id,
        run.codex_thread_id,
        run.previous_codex_thread_id,
      );
    if (operationChanged.changes !== 1)
      fail("Review fix cleanup operation changed during finalization");
    appendHistory(database, run.run_id, current.run_state, current.run_state, "review_fix_task_archived", {
      roundId: round.round_id,
      roundNumber: round.round_number,
      reviewFixCodexThreadId: run.codex_thread_id,
      restoredCodexThreadId: run.previous_codex_thread_id,
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, apply: true, ...plan, archived: true })}\n`);
}

function recoverManagedReviewFixTask(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  config: OrchestratorConfig,
  requestId: string,
  apply: boolean,
): void {
  const request = database
    .prepare(
      `SELECT request_state FROM run_control_requests
       WHERE request_id=? AND run_id=? AND action='recover_managed_task'`,
    )
    .get(requestId, run.run_id) as { request_state: string } | undefined;
  if (!request || request.request_state !== "pending")
    fail("Managed task recovery request is no longer pending");
  const project = registry.projects[run.project];
  let operation = database
    .prepare(
      `SELECT operation_state, request_id, task_codex_thread_id,
              previous_codex_thread_id, tmux_session_name, result_head_sha
       FROM run_review_fix_operations
       WHERE round_id=(
         SELECT round_id FROM run_review_fix_rounds
         WHERE run_id=? ORDER BY round_number DESC LIMIT 1
       ) AND operation_kind='managed_recovery'`,
    )
    .get(run.run_id) as ReviewFixOperation | undefined;
  const initial = loadManagedReviewFixRecoverySnapshot(
    database,
    run.run_id,
    requestId,
  );
  if (!initial) fail("Managed recovery run disappeared");
  const inspection = operation
    ? null
    : inspectManagedReviewFixRecovery(initial, project);
  if (inspection && !inspection.eligible)
    fail(`Managed review-fix recovery refused: ${inspection.reason}`);
  if (
    operation &&
    (operation.request_id !== requestId ||
      operation.task_codex_thread_id !== run.codex_thread_id ||
      operation.previous_codex_thread_id !== run.previous_codex_thread_id ||
      operation.tmux_session_name !== run.tmux_session_name ||
      !operation.result_head_sha ||
      initial.roundId === null)
  )
    fail("Managed review-fix recovery operation identity mismatch");
  const roundId = inspection?.eligible ? inspection.roundId : initial.roundId!;
  const resultHeadSha = inspection?.eligible
    ? inspection.headSha
    : operation!.result_head_sha!;
  const targetRoundState =
    initial.ciHeadSha === resultHeadSha && initial.ciAggregateState === "passed"
      ? "resolving"
      : "waiting_ci";
  const plan = {
    runId: run.run_id,
    requestId,
    roundId,
    resultHeadSha,
    targetRoundState,
    tmuxSessionName: run.tmux_session_name,
    action: "recover_delivered_review_fix",
  };
  if (!apply) {
    process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
    return;
  }
  if (
    process.env.KURAMI_CONTROLLER_ACTION !== "recover_managed_task" ||
    config.mode !== "live" ||
    run.execution_mode !== "live"
  )
    fail("Managed task recovery may only be applied by the live controller");

  if (!operation) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const current = loadManagedReviewFixRecoverySnapshot(
        database,
        run.run_id,
        requestId,
      );
      if (!current) fail("Managed recovery run changed before claim");
      const currentInspection = inspectManagedReviewFixRecovery(current, project);
      if (
        !currentInspection.eligible ||
        currentInspection.roundId !== roundId ||
        currentInspection.headSha !== resultHeadSha ||
        current.tmuxSessionName !== run.tmux_session_name ||
        !run.tmux_session_name ||
        !run.codex_thread_id ||
        !run.previous_codex_thread_id
      )
        fail(
          `Managed review-fix recovery changed before claim${currentInspection.eligible ? "" : `: ${currentInspection.reason}`}`,
        );
      database
        .prepare(
          `INSERT INTO run_review_fix_operations (
             round_id, operation_kind, operation_state, request_id,
             task_codex_thread_id, previous_codex_thread_id,
             tmux_session_name, result_head_sha
           ) VALUES (?, 'managed_recovery', 'claimed', ?, ?, ?, ?, ?)`,
        )
        .run(
          roundId,
          requestId,
          run.codex_thread_id,
          run.previous_codex_thread_id,
          run.tmux_session_name,
          resultHeadSha,
        );
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    operation = {
      operation_state: "claimed",
      request_id: requestId,
      task_codex_thread_id: run.codex_thread_id,
      previous_codex_thread_id: run.previous_codex_thread_id,
      tmux_session_name: run.tmux_session_name,
      result_head_sha: resultHeadSha,
    };
  }

  if (operation.operation_state === "claimed") {
    if (!operation.tmux_session_name)
      fail("Managed review-fix recovery lost its claimed session mapping");
    if (tmuxSessionExists(operation.tmux_session_name))
      killTmuxSession(operation.tmux_session_name);
    if (tmuxSessionExists(operation.tmux_session_name))
      fail("Managed review-fix session remained alive after termination");
    const recorded = database
      .prepare(
        `UPDATE run_review_fix_operations
         SET operation_state='side_effect_succeeded', failure_reason=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND operation_kind='managed_recovery'
           AND operation_state='claimed' AND request_id=?
           AND tmux_session_name=?`,
      )
      .run(roundId, requestId, operation.tmux_session_name);
    if (recorded.changes !== 1)
      fail("Managed review-fix recovery operation changed after termination");
    operation.operation_state = "side_effect_succeeded";
  }
  if (operation.operation_state !== "side_effect_succeeded")
    fail("Managed review-fix recovery operation is not ready to finalize");
  if (
    !run.worktree_path ||
    !run.branch_name ||
    git(run.worktree_path, ["status", "--porcelain", "--untracked-files=all"]) !==
      "" ||
    git(run.worktree_path, ["branch", "--show-current"]) !== run.branch_name ||
    git(run.worktree_path, ["rev-parse", "HEAD"]) !== resultHeadSha ||
    git(run.worktree_path, [
      "rev-parse",
      `refs/remotes/origin/${run.branch_name}`,
    ]) !== resultHeadSha
  )
    fail("Managed review-fix Git state changed after session termination");

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadManagedReviewFixRecoverySnapshot(
      database,
      run.run_id,
      requestId,
    );
    if (
      !current ||
      current.runState !== "needs_attention" ||
      current.ownerState !== "cli" ||
      current.stopReason !== null ||
      current.roundId !== roundId ||
      current.roundState !== "needs_attention" ||
      current.roundFailureReason !== "review_fix_uncommitted_changes" ||
      current.roundCodexThreadId !== operation.task_codex_thread_id ||
      current.codexThreadId !== operation.task_codex_thread_id ||
      current.previousCodexThreadId !== operation.previous_codex_thread_id ||
      current.tmuxSessionName !== operation.tmux_session_name ||
      current.ciHeadSha !== resultHeadSha ||
      current.ciLastError !== null ||
      !["pending", "passed"].includes(current.ciAggregateState ?? "")
    )
      fail("Managed review-fix recovery state changed after termination");
    const finalRoundState =
      current.ciAggregateState === "passed" ? "resolving" : "waiting_ci";
    const roundChanged = database
      .prepare(
        `UPDATE run_review_fix_rounds
         SET round_state=?, result_head_sha=?, failure_reason=NULL,
             completed_at=NULL,
             waiting_ci_started_at=CASE WHEN ?='waiting_ci'
               THEN COALESCE(waiting_ci_started_at,
                 strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
               ELSE waiting_ci_started_at END,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND run_id=? AND round_state='needs_attention'
           AND failure_reason='review_fix_uncommitted_changes'
           AND codex_thread_id=? AND source_head_sha=?`,
      )
      .run(
        finalRoundState,
        resultHeadSha,
        finalRoundState,
        roundId,
        run.run_id,
        operation.task_codex_thread_id,
        current.roundSourceHeadSha,
      );
    const runChanged = database
      .prepare(
        `UPDATE runs SET state='parked_review', owner_state='none',
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id=? AND state='needs_attention' AND owner_state='cli'
           AND stop_reason IS NULL AND execution_mode='live'`,
      )
      .run(run.run_id);
    const resourceChanged = database
      .prepare(
        `UPDATE run_resources SET tmux_session_name=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id=? AND resource_state='provisioned'
           AND tmux_session_name=? AND codex_thread_id=?
           AND previous_codex_thread_id=?`,
      )
      .run(
        run.run_id,
        operation.tmux_session_name,
        operation.task_codex_thread_id,
        operation.previous_codex_thread_id,
      );
    const operationChanged = database
      .prepare(
        `UPDATE run_review_fix_operations
         SET operation_state='completed', completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE round_id=? AND operation_kind='managed_recovery'
           AND operation_state='side_effect_succeeded' AND request_id=?`,
      )
      .run(roundId, requestId);
    if (
      roundChanged.changes !== 1 ||
      runChanged.changes !== 1 ||
      resourceChanged.changes !== 1 ||
      operationChanged.changes !== 1
    )
      fail("Managed review-fix recovery state changed during claim");
    database.prepare("UPDATE run_codex_tasks SET released_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=? AND session_name=? AND stopped_at IS NOT NULL AND released_at IS NULL").run(run.run_id,operation.tmux_session_name);
    appendHistory(
      database,
      run.run_id,
      "needs_attention",
      "parked_review",
      "review_fix_managed_task_recovered",
      {
        requestId,
        roundId,
        sourceHeadSha: current.roundSourceHeadSha,
        resultHeadSha,
        ciState: current.ciAggregateState,
        targetRoundState: finalRoundState,
        previousTmuxSessionName: operation.tmux_session_name,
        codexThreadId: operation.task_codex_thread_id,
        previousCodexThreadId: operation.previous_codex_thread_id,
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  process.stdout.write(`${JSON.stringify({ ok: true, apply: true, ...plan })}\n`);
}

function inspectSession(database: DatabaseSync, runId: string): void {
  const run = loadRun(database, runId);
  const tmuxAlive = run.tmux_session_name
    ? tmuxSessionExists(run.tmux_session_name)
    : false;
  let paneCommand: string | null = null;
  if (tmuxAlive && run.tmux_session_name) {
    paneCommand = runFile("tmux", [
      "display-message",
      "-p",
      "-t",
      `${run.tmux_session_name}:0.0`,
      "#{pane_current_command}",
    ]);
  }
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      runId: run.run_id,
      runState: run.run_state,
      ownerState: run.owner_state,
      resourceState: run.resource_state,
      worktreePath: run.worktree_path,
      branchName: run.branch_name,
      tmuxSessionName: run.tmux_session_name,
      tmuxAlive,
      paneCommand,
      codexThreadId: run.codex_thread_id,
    })}\n`,
  );
}

export async function runSessionManagerCli(): Promise<void> {
  const args = parseArguments();
  const config = parse(
    await readFile(configPath, "utf8"),
  ) as OrchestratorConfig;
  const registry = parse(
    await readFile(projectsPath, "utf8"),
  ) as ProjectsRegistry;
  if (config.version !== 1 || registry.version !== 1) {
    fail("Unsupported configuration version");
  }
  if (
    !Number.isInteger(config.limits.max_tmux_sessions_global) ||
    config.limits.max_tmux_sessions_global < 1
  ) {
    fail("Invalid max_tmux_sessions_global");
  }

  const database = openOrchestratorDatabase(databasePath);
  try {
    if (args.action === "inspect") {
      inspectSession(database, args.runId);
      return;
    }
    const run = loadRun(database, args.runId);
    if (args.action === "sync") {
      await syncSession(database, run, registry, args.apply);
      return;
    }
    if (args.action === "cleanup-repair") {
      await cleanupRepairSession(database, run, args.apply);
      return;
    }
    if (args.action === "cleanup-review-fix") {
      await cleanupReviewFixSession(database, run, registry, args.apply);
      return;
    }
    if (args.action === "recover-managed-task") {
      recoverManagedReviewFixTask(
        database,
        run,
        registry,
        config,
        args.requestId!,
        args.apply,
      );
      return;
    }
    if (args.action === "cancel") {
      await cancelCliSession(database, run, args.apply);
      return;
    }
    if (args.action === "park") {
      await leaveCliSession(database, run, registry, args.apply, "none");
      return;
    }
    if (args.action === "handoff") {
      await leaveCliSession(database, run, registry, args.apply, "remote");
      return;
    }
    if (args.action === "finalize-stop") {
      await finalizeStop(database, run, registry, args.apply);
      return;
    }
    const repair =
      args.action === "repair"
        ? loadRepairContext(database, run, args.requestId!)
        : null;
    const project = registry.projects[run.project];
    if (!project) fail(`Unknown project in run: ${run.project}`);
    const reviewFix =
      args.action === "review-fix"
        ? await loadReviewFixContext(database, run, project, args.requestId!)
        : null;
    const plan = await validateAndPlan(run, registry, repair, reviewFix);
    await startSession(database, run, plan, config, args.apply);
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runSessionManagerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    writeSync(2, `${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}

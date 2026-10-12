import { completeSuccessions } from "./complete-successions.ts";
import { capturePrimaryStoppedResult, type PrimaryStoppedResult } from "../../integrations/codex/primary-diagnostic.ts";
import { captureParkProcesses, cleanupParkProcesses, saveParkProcesses, loadParkProcesses, clearParkProcesses } from "./park-processes.ts";
import { taskForSession, protocolTurnSucceeded } from "../../integrations/codex/task-store.ts";
import { protocolRemoteBlocker, stopProtocolTask, releaseProtocolTask } from "./protocol-session.ts";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  transcriptBusy,
  transcriptHasCompletedTurn,
  transcriptHasIdlePrompt,
  transcriptWaitingOnApproval,
} from "../../runtime/codex-terminal.ts";
import type { ProjectConfig, ProjectsRegistry, ReviewFixDeliveryRound, SessionRun } from "./session-types.ts";
import {
  appendHistory,
  capturePane,
  fail,
  git,
  gitRefExists,
  killTmuxSession,
  loadRun,
  orchestratorHome,
  pathExists,
  sendTmuxKeys,
  sendTmuxLiteral,
  tmuxSessionExists,
} from "./session-shared.ts";

async function reviewFixHasUndeliveredChanges(
  run: SessionRun,
  project: ProjectConfig,
  round: ReviewFixDeliveryRound,
): Promise<{ dirty: boolean; headSha: string; sourceHeadSha: string }> {
  if (!run.worktree_path || !run.branch_name)
    fail("Review fix has no managed worktree/branch mapping");
  if (project.repository.toLowerCase() !== run.repository.toLowerCase())
    fail("Review fix repository mapping does not match the run");

  const worktreeRoot = resolve(project.workspace.worktree_root);
  const worktreePath = resolve(run.worktree_path);
  const relativePath = relative(worktreeRoot, worktreePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    resolve(worktreeRoot, relativePath) !== worktreePath
  )
    fail(`Review fix worktree escapes the configured root: ${worktreePath}`);
  if (!(await stat(worktreePath)).isDirectory())
    fail(`Review fix worktree is not a directory: ${worktreePath}`);
  if ((await realpath(worktreePath)) !== worktreePath)
    fail(`Review fix worktree path is not canonical: ${worktreePath}`);
  if (git(worktreePath, ["rev-parse", "--show-toplevel"]) !== worktreePath)
    fail(`Review fix path is not the exact managed worktree: ${worktreePath}`);
  const branch = git(worktreePath, ["branch", "--show-current"]);
  if (branch !== run.branch_name)
    fail(`Review fix branch mismatch: expected ${run.branch_name}, got ${branch}`);

  return {
    dirty:
      git(worktreePath, ["status", "--porcelain", "--untracked-files=all"]) !==
      "",
    headSha: git(worktreePath, ["rev-parse", "HEAD"]),
    sourceHeadSha: round.source_head_sha,
  };
}

function markUndeliveredReviewFix(
  database: DatabaseSync,
  run: SessionRun,
  round: ReviewFixDeliveryRound,
  delivery: { headSha: string; sourceHeadSha: string },
  tmuxAlive: boolean,
): void {
  const reason = "review_fix_uncommitted_changes";
  const detail =
    "Review fix left staged or uncommitted work without advancing HEAD beyond its source SHA";
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.codex_thread_id !== run.codex_thread_id ||
      current.previous_codex_thread_id !== run.previous_codex_thread_id ||
      current.tmux_session_name !== run.tmux_session_name
    )
      fail("Run changed while preserving undelivered review fix work");
    const currentRound = database
      .prepare(
        `SELECT source_head_sha, codex_thread_id, failure_reason
         FROM run_review_fix_rounds WHERE round_id=? AND run_id=?`,
      )
      .get(round.round_id, run.run_id) as
      | {
          source_head_sha: string;
          codex_thread_id: string | null;
          failure_reason: string | null;
        }
      | undefined;
    if (
      !currentRound ||
      currentRound.source_head_sha !== round.source_head_sha ||
      currentRound.codex_thread_id !== round.codex_thread_id
    )
      fail("Review fix round changed while preserving undelivered work");

    database
      .prepare(
        `UPDATE run_review_fix_rounds
         SET round_state='needs_attention', failure_reason=?,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             completed_at=COALESCE(completed_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         WHERE round_id=?`,
      )
      .run(reason, round.round_id);
    if (!tmuxAlive && run.tmux_session_name)
      database
        .prepare(
          `UPDATE run_resources SET tmux_session_name=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE run_id=? AND tmux_session_name=?`,
        )
        .run(run.run_id, run.tmux_session_name);
    if (!["archived", "cancelled"].includes(current.run_state))
      database
        .prepare(
          `UPDATE runs SET state='needs_attention', owner_state=?,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE run_id=?`,
        )
        .run(tmuxAlive ? "cli" : "none", run.run_id);
    if (
      current.run_state !== "needs_attention" ||
      currentRound.failure_reason !== reason
    )
      appendHistory(
        database,
        run.run_id,
        current.run_state,
        ["archived", "cancelled"].includes(current.run_state)
          ? current.run_state
          : "needs_attention",
        reason,
        {
          roundId: round.round_id,
          roundNumber: round.round_number,
          sourceHeadSha: delivery.sourceHeadSha,
          localHeadSha: delivery.headSha,
          codexThreadId: run.codex_thread_id,
          previousCodexThreadId: run.previous_codex_thread_id,
          detail,
        },
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function guardReviewFixDelivery(
  database: DatabaseSync,
  run: SessionRun,
  project: ProjectConfig,
  round: ReviewFixDeliveryRound,
  tmuxAlive: boolean,
  apply: boolean,
): Promise<void> {
  const delivery = await reviewFixHasUndeliveredChanges(run, project, round);
  if (!delivery.dirty || delivery.headSha !== delivery.sourceHeadSha) return;
  if (apply)
    markUndeliveredReviewFix(database, run, round, delivery, tmuxAlive);
  fail(
    "Review fix left staged or uncommitted work without advancing HEAD beyond its source SHA; preserving the review-fix task for attention",
  );
}

function recordHandoffRelease(
  database: DatabaseSync,
  run: SessionRun,
  toState: string,
  targetOwner: "none" | "remote",
  tailPath: string,
  tmuxAlive: boolean,
  forced: boolean,
  primaryStoppedResult: PrimaryStoppedResult | null,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== run.run_state ||
      current.owner_state !== "cli" ||
      current.stop_reason !== run.stop_reason ||
      current.codex_thread_id !== run.codex_thread_id ||
      current.previous_codex_thread_id !== run.previous_codex_thread_id ||
      current.tmux_session_name !== run.tmux_session_name
    ) {
      fail(
        `Run changed during handoff: state=${current.run_state}, owner=${current.owner_state}, tmux=${current.tmux_session_name ?? "none"}`,
      );
    }
    const runChanged = database
      .prepare(
        `
        UPDATE runs
        SET state = ?, owner_state = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND state = ? AND owner_state = 'cli'
      `,
      )
      .run(toState, targetOwner, run.run_id, run.run_state);
    const resourceChanged = database
      .prepare(
        `
        UPDATE run_resources
        SET tmux_session_name = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND tmux_session_name IS ?
      `,
      )
      .run(run.run_id, run.tmux_session_name);
    if (runChanged.changes !== 1 || resourceChanged.changes !== 1)
      fail("Run changed while recording the completed tmux release");
    completeSuccessions(database, run.run_id);
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      toState,
      targetOwner === "remote"
        ? "codex_cli_handoff_completed"
        : "codex_cli_park_completed",
      {
        primaryStoppedResult,
        codexThreadId: run.codex_thread_id,
        previousTmuxSessionName: run.tmux_session_name,
        terminalTailPath: tailPath,
        recoveredAfterTmuxExit: !tmuxAlive,
        forced,
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function leaveCliSession(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  apply: boolean,
  targetOwner: "none" | "remote",
): Promise<void> {
  const task = taskForSession(database,run.tmux_session_name);
  if (task && !task.released_at) {
    if (apply && run.execution_mode !== "live") fail("Protocol release requires live mode");
    if (targetOwner === "remote") fail(protocolRemoteBlocker);
    if (run.owner_state !== "cli" || run.stop_reason !== null ||
        !["running","parked_review"].includes(run.run_state)) fail("Protocol task is not parkable");
    if (!protocolTurnSucceeded(database,task.session_name)) fail("Exact protocol turn has not completed successfully with a process stop receipt");
    const activeFix = database.prepare(`SELECT round_id,round_number,round_state,source_head_sha,codex_thread_id,failure_reason
      FROM run_review_fix_rounds WHERE round_id=? AND round_state='running'`).get(task.context_id) as ReviewFixDeliveryRound | undefined;
    if (activeFix) await guardReviewFixDelivery(database,run,registry.projects[run.project]!,activeFix,true,apply);
    if (apply) releaseProtocolTask(database,task,"parked_review","codex_protocol_park_completed");
    process.stdout.write(`${JSON.stringify({ok:true,apply,action:"protocol_parked",taskId:task.task_id,turnId:task.turn_id})}\n`);
    return;
  }
  if (
    targetOwner === "remote" &&
    run.run_state === "remote_owned" &&
    run.owner_state === "remote"
  ) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply, action: "already_remote_owned", runId: run.run_id, codexThreadId: run.codex_thread_id })}\n`,
    );
    return;
  }
  const handoffReadyStates =
    targetOwner === "remote"
      ? ["running", "parked_review", "needs_attention"]
      : ["running", "parked_review", "stopping"];
  if (
    !handoffReadyStates.includes(run.run_state) ||
    run.owner_state !== "cli"
  ) {
    fail(
      `Run is not CLI-owned and handoff-ready: state=${run.run_state}, owner=${run.owner_state}`,
    );
  }
  if (!run.codex_thread_id) fail(`Run has no synchronized Codex thread ID`);
  let tmuxAlive = run.tmux_session_name
    ? tmuxSessionExists(run.tmux_session_name)
    : false;
  if (
    targetOwner === "remote" &&
    run.run_state === "needs_attention" &&
    (run.resource_state !== "provisioned" ||
      !run.tmux_session_name ||
      !/^cx-[a-z0-9-]+$/u.test(run.tmux_session_name) ||
      !tmuxAlive)
  ) {
    fail(
      "Needs-attention handoff requires its live managed Codex tmux session",
    );
  }
  const tmuxAliveAtStart = tmuxAlive;
  let transcript =
    tmuxAlive && run.tmux_session_name
      ? capturePane(run.tmux_session_name)
      : "";
  let waitingOnApproval = transcriptWaitingOnApproval(transcript);
  let busy = transcriptBusy(transcript);
  const initialBusy = busy;
  const attentionHandoff =
    targetOwner === "remote" && run.run_state === "needs_attention";
  const interruptRequired =
    targetOwner === "remote" && (busy || (attentionHandoff && waitingOnApproval));
  const tailDirectory = resolve(orchestratorHome, "logs/session-handoffs");
  const tailPath = resolve(tailDirectory, `${run.run_id}.txt`);
  const autonomousCompletion =
    targetOwner === "none" &&
    run.run_state === "running" &&
    (run.interaction_policy === "autonomous" ||
      run.autonomous_successor_active !== 0);
  const targetState = targetOwner === "remote"
    ? "remote_owned"
    : autonomousCompletion
      ? "parked_review"
      : run.run_state;
  let terminalTurnCompleted = transcriptHasCompletedTurn(transcript);
  const initialPlan = {
    runId: run.run_id,
    fromState: run.run_state,
    toState: targetState,
    fromOwner: run.owner_state,
    toOwner: targetOwner,
    tmuxSessionName: run.tmux_session_name,
    tmuxAlive,
    codexThreadId: run.codex_thread_id,
    initialBusy,
    busy,
    waitingOnApproval,
    terminalTurnCompleted,
    interruptRequired,
    interruptedTurn: false,
    tailPath,
  };
  if (waitingOnApproval && !attentionHandoff)
    fail(`Codex is waiting for approval; resolve it before handoff`);
  if (busy && targetOwner !== "remote")
    fail(`Codex turn is still active; handoff is not safe yet`);
  if (
    targetOwner === "none" &&
    tmuxAlive &&
    !terminalTurnCompleted
  ) {
    fail("Codex turn has not reached a completed terminal prompt");
  }
  if (
    targetOwner === "none" &&
    run.run_state === "running" &&
    !autonomousCompletion
  ) {
    fail("A running non-autonomous turn cannot be parked");
  }
  if (targetOwner === "none" && run.codex_thread_id) {
    const activeReviewFix = database
      .prepare(
        `SELECT round_id, round_number, round_state, source_head_sha,
                codex_thread_id, failure_reason
         FROM run_review_fix_rounds
         WHERE run_id=? AND codex_thread_id=? AND round_state='running'
         ORDER BY round_number DESC LIMIT 1`,
      )
      .get(run.run_id, run.codex_thread_id) as
      | ReviewFixDeliveryRound
      | undefined;
    if (activeReviewFix) {
      const project = registry.projects[run.project];
      if (!project) fail(`Unknown project in run: ${run.project}`);
      await guardReviewFixDelivery(
        database,
        run,
        project,
        activeReviewFix,
        tmuxAlive,
        apply,
      );
    }
  }
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, plan: initialPlan })}\n`,
    );
    return;
  }
  if (run.execution_mode !== "live") {
    fail(`Refusing handoff for execution_mode=${run.execution_mode}`);
  }

  let interruptedTurn = false;
  if (interruptRequired && tmuxAlive && run.tmux_session_name) {
    sendTmuxKeys(run.tmux_session_name, ["Escape"]);
    let stableIdleSamples = 0;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      if (!tmuxSessionExists(run.tmux_session_name)) {
        tmuxAlive = false;
        busy = false;
        interruptedTurn = true;
        break;
      }
      transcript = capturePane(run.tmux_session_name);
      waitingOnApproval = transcriptWaitingOnApproval(transcript);
      if (waitingOnApproval && !attentionHandoff) {
        fail(`Codex reached an approval prompt during handoff; resolve it before retrying`);
      }
      busy = transcriptBusy(transcript);
      const idlePrompt = transcriptHasIdlePrompt(transcript);
      stableIdleSamples = !busy && idlePrompt ? stableIdleSamples + 1 : 0;
      if (stableIdleSamples >= 2) {
        interruptedTurn = true;
        break;
      }
      if (attempt === 11 || attempt === 23) {
        sendTmuxKeys(run.tmux_session_name, ["Escape"]);
      }
    }
    if (busy || waitingOnApproval) {
      fail(
        `Codex did not reach an idle prompt within the bounded interrupt window`,
      );
    }
  }

  if (targetOwner === "none" && tmuxAlive && run.tmux_session_name) {
    transcript = capturePane(run.tmux_session_name);
    waitingOnApproval = transcriptWaitingOnApproval(transcript);
    busy = transcriptBusy(transcript);
    terminalTurnCompleted = transcriptHasCompletedTurn(transcript);
    if (waitingOnApproval)
      fail(`Codex is waiting for approval; resolve it before handoff`);
    if (busy) fail(`Codex turn is still active; handoff is not safe yet`);
    if (!terminalTurnCompleted)
      fail("Codex turn has not reached a completed terminal prompt");
  }

  const plan = {
    ...initialPlan,
    tmuxAlive: tmuxAliveAtStart,
    busy,
    waitingOnApproval,
    interruptedTurn,
    terminalTurnCompleted,
  };

  await mkdir(tailDirectory, { recursive: true, mode: 0o700 });
  await writeFile(tailPath, `${transcript}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  // Capture before the pane exits and descendants are reparented. Remote handoff
  // keeps its existing process policy; active turns never reach here.
  const parkReceiptPath = `${tailPath}.processes.json`;
  const parkIdentity = { runId: run.run_id, session: run.tmux_session_name ?? "", threadId: run.codex_thread_id! };
  const parkProcesses = targetOwner === "none"
    ? tmuxAlive && run.tmux_session_name
      ? captureParkProcesses(run.tmux_session_name) : loadParkProcesses(parkReceiptPath, parkIdentity)
    : [];
  if (targetOwner === "none" && tmuxAlive) saveParkProcesses(parkReceiptPath, parkIdentity, parkProcesses);
  let forced = false;
  if (tmuxAlive && run.tmux_session_name) {
    sendTmuxKeys(run.tmux_session_name, ["C-u"]);
    sendTmuxKeys(run.tmux_session_name, ["C-d"]);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      if (!tmuxSessionExists(run.tmux_session_name)) break;
      if (
        attempt === 3 &&
        targetOwner === "none" &&
        terminalTurnCompleted
      ) {
        forced = true;
        killTmuxSession(run.tmux_session_name);
        break;
      }
      if (attempt === 11 || attempt === 23) {
        sendTmuxKeys(run.tmux_session_name, ["C-d"]);
      }
    }
    if (tmuxSessionExists(run.tmux_session_name)) {
      fail(`Codex/tmux did not exit within the bounded handoff window`);
    }
  }

  const cleanedDescendants = await cleanupParkProcesses(parkProcesses);
  const primaryStoppedResult = targetOwner === "none" && terminalTurnCompleted &&
    !run.previous_codex_thread_id && run.stop_reason === null
    ? capturePrimaryStoppedResult(run.codex_thread_id!, run.worktree_path) : null;
  recordHandoffRelease(database, run, plan.toState, targetOwner, tailPath, tmuxAlive, forced, primaryStoppedResult);
  if (targetOwner === "none") clearParkProcesses(parkReceiptPath);

  process.stdout.write(
    `${JSON.stringify({ ok: true, apply: true, ...plan, forced, cleanedDescendants })}\n`,
  );
}

function recordCliStop(
  database: DatabaseSync,
  run: SessionRun,
  stopIntent: "cancelled" | "completed",
  tailPath: string,
  tmuxAlive: boolean,
  forced: boolean,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.stop_reason !== stopIntent ||
      current.owner_state !== "cli" ||
      current.tmux_session_name !== run.tmux_session_name
    ) {
      fail(
        `Run changed during CLI stop: state=${current.run_state}, owner=${current.owner_state}, tmux=${current.tmux_session_name ?? "none"}`,
      );
    }
    database
      .prepare(
        `
        UPDATE runs
        SET state = 'stopping', owner_state = 'none',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(run.run_id);
    database
      .prepare(
        `
        UPDATE run_resources
        SET tmux_session_name = NULL,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(run.run_id);
    appendHistory(
      database,
      run.run_id,
      run.run_state,
      "stopping",
      stopIntent === "completed"
        ? "codex_cli_completion_stop_completed"
        : "codex_cli_cancel_completed",
      {
        codexThreadId: run.codex_thread_id,
        previousTmuxSessionName: run.tmux_session_name,
        terminalTailPath: tailPath,
        recoveredAfterTmuxExit: !tmuxAlive,
        forced,
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export async function cancelCliSession(
  database: DatabaseSync,
  run: SessionRun,
  apply: boolean,
): Promise<void> {
  const task = taskForSession(database,run.tmux_session_name);
  if (task && !task.released_at) {
    if (apply && run.execution_mode !== "live") fail("Protocol cancellation requires live mode");
    if (!run.stop_reason || run.owner_state !== "cli") fail("Protocol cancellation has no owner stop intent");
    if (apply) {
      const stopped = await stopProtocolTask(database,task,"cancel");
      releaseProtocolTask(database,stopped,"stopping","codex_protocol_stop_completed");
    }
    process.stdout.write(`${JSON.stringify({ok:true,apply,action:"protocol_stopped",taskId:task.task_id})}\n`);
    return;
  }
  const stopIntent = run.stop_reason;
  if (
    (stopIntent !== "cancelled" && stopIntent !== "completed") ||
    run.owner_state !== "cli"
  ) {
    fail(
      `Run is not CLI-owned with stop intent: state=${run.run_state}, owner=${run.owner_state}, stopReason=${run.stop_reason ?? "none"}`,
    );
  }
  if (
    run.tmux_session_name &&
    !/^cx-[a-z0-9-]+$/u.test(run.tmux_session_name)
  ) {
    fail(`Run has an unsafe tmux session mapping: ${run.tmux_session_name}`);
  }

  const tmuxAlive = run.tmux_session_name
    ? tmuxSessionExists(run.tmux_session_name)
    : false;
  let transcript = "";
  if (tmuxAlive && run.tmux_session_name) {
    try {
      transcript = capturePane(run.tmux_session_name);
    } catch {
      if (tmuxSessionExists(run.tmux_session_name)) throw new Error("Failed to capture active Codex session");
    }
  }
  const tailDirectory = resolve(
    orchestratorHome,
    stopIntent === "completed"
      ? "logs/session-completions"
      : "logs/session-cancellations",
  );
  const tailPath = resolve(tailDirectory, `${run.run_id}.txt`);
  const plan = {
    runId: run.run_id,
    runState: run.run_state,
    fromOwner: run.owner_state,
    toOwner: "none",
    tmuxSessionName: run.tmux_session_name,
    tmuxAlive,
    codexThreadId: run.codex_thread_id,
    tailPath,
  };
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, plan })}\n`,
    );
    return;
  }
  if (run.execution_mode !== "live") {
    fail(`Refusing cancellation for execution_mode=${run.execution_mode}`);
  }

  await mkdir(tailDirectory, { recursive: true, mode: 0o700 });
  await writeFile(tailPath, `${transcript}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  let forced = false;
  if (run.tmux_session_name && tmuxSessionExists(run.tmux_session_name)) {
    sendTmuxKeys(run.tmux_session_name, ["Escape"]);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  if (run.tmux_session_name && tmuxSessionExists(run.tmux_session_name)) {
    sendTmuxKeys(run.tmux_session_name, ["C-u"]);
    sendTmuxLiteral(run.tmux_session_name, "/exit");
    sendTmuxKeys(run.tmux_session_name, ["Enter"]);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      if (!tmuxSessionExists(run.tmux_session_name)) break;
    }
  }
  if (run.tmux_session_name && tmuxSessionExists(run.tmux_session_name)) {
    forced = true;
    killTmuxSession(run.tmux_session_name);
  }
  if (run.tmux_session_name && tmuxSessionExists(run.tmux_session_name)) {
    fail(`Managed tmux session is still alive after bounded cancellation`);
  }

  recordCliStop(database, run, stopIntent, tailPath, tmuxAlive, forced);

  const action =
    stopIntent === "completed" ? "stopped_cli_for_completion" : "cancelled_cli";
  process.stdout.write(
    `${JSON.stringify({ ok: true, apply: true, action, ...plan, forced })}\n`,
  );
}

export async function finalizeStop(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  apply: boolean,
): Promise<void> {
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  if (run.run_state !== "stopping") {
    fail(`Run is not stopping: state=${run.run_state}`);
  }
  if (!run.worktree_path || !run.branch_name) {
    fail(`Run has no worktree/branch mapping: ${run.run_id}`);
  }

  const tmuxAlive = run.tmux_session_name
    ? tmuxSessionExists(run.tmux_session_name)
    : false;
  const worktreeExists = await pathExists(resolve(run.worktree_path));
  const canonicalRepository = resolve(project.workspace.canonical_repository);
  const branchExists = gitRefExists(
    canonicalRepository,
    `refs/heads/${run.branch_name}`,
  );
  const plan = {
    runId: run.run_id,
    fromState: run.run_state,
    toState: "cancelled",
    resourceState: "released",
    tmuxAlive,
    worktreeExists,
    branchExists,
  };

  if (tmuxAlive || worktreeExists || branchExists) {
    fail(
      `Cleanup is incomplete: tmuxAlive=${tmuxAlive}, worktreeExists=${worktreeExists}, branchExists=${branchExists}`,
    );
  }
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, plan })}\n`,
    );
    return;
  }
  if (run.execution_mode !== "live") {
    fail(`Refusing stop finalization for execution_mode=${run.execution_mode}`);
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== "stopping" ||
      current.resource_state === "released"
    ) {
      fail(
        `Run changed during stop finalization: state=${current.run_state}, resource=${current.resource_state}`,
      );
    }
    database
      .prepare(
        `
        UPDATE runs
        SET state = 'cancelled', owner_state = 'none',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(run.run_id);
    database
      .prepare(
        `
        UPDATE run_resources
        SET resource_state = 'released',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(run.run_id);
    completeSuccessions(database, run.run_id);
    appendHistory(
      database,
      run.run_id,
      "stopping",
      "cancelled",
      "cleanup_absence_verified",
      {
        tmuxSessionName: run.tmux_session_name,
        worktreePath: run.worktree_path,
        branchName: run.branch_name,
      },
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

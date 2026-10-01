import { claimProtocolTask, taskForSession } from "../../integrations/codex/task-store.ts";
import { reviewContextMatches } from "../../controls/ai-review.ts";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  createGitHubAppInstallationToken,
  loadGitHubAppCredentialsFromFile,
} from "../../integrations/github/app-auth.ts";
import {
  fetchActionableReviewThreads,
  fetchSummaryOnlyReviewFindings,
} from "../../integrations/github/review-threads.ts";
import { codexTitle, initialPrompt, repairPrompt, reviewFixPrompt } from "./prompts.ts";
import type {
  CiCheck,
  OrchestratorConfig,
  ProjectConfig,
  ProjectsRegistry,
  RepairContext,
  ReviewFixContext,
  SessionRun,
  StartPlan,
} from "./session-types.ts";
import {
  appendHistory,
  fail,
  git,
  gitIsAncestor,
  killTmuxSession,
  launcherPath,
  loadRun,
  managedTmuxSessionCount,
  orchestratorHome,
  runFile,
  tmuxSessionExists,
} from "./session-shared.ts";

function sessionName(run: SessionRun, project: ProjectConfig): string {
  const prefix = project.workspace.branch_prefix.toLowerCase();
  const shortRunId = run.run_id.replace(/^r_/u, "").slice(0, 6).toLowerCase();
  const value = `cx-${prefix}-${run.issue_number}-${shortRunId}`;
  if (!/^[a-z0-9-]+$/u.test(value)) fail("Generated unsafe tmux session name");
  return value;
}

export function loadRepairContext(
  database: DatabaseSync,
  run: SessionRun,
  requestId: string,
): RepairContext {
  const request = database
    .prepare(
      `SELECT request_id FROM run_control_requests
       WHERE request_id = ? AND run_id = ? AND action = 'ci_repair'
         AND request_state = 'pending'`,
    )
    .get(requestId, run.run_id) as { request_id: string } | undefined;
  if (!request) fail("CI repair request is no longer pending");
  const snapshot = database
    .prepare(
      `SELECT pull_request_number, pull_request_url, head_sha,
              aggregate_state, checks_json
       FROM run_ci_snapshots WHERE run_id = ?`,
    )
    .get(run.run_id) as
    | {
        pull_request_number: number | null;
        pull_request_url: string | null;
        head_sha: string | null;
        aggregate_state: string;
        checks_json: string;
      }
    | undefined;
  if (
    !snapshot ||
    !["failed", "missing"].includes(snapshot.aggregate_state) ||
    !snapshot.head_sha ||
    !snapshot.pull_request_number ||
    !snapshot.pull_request_url
  )
    fail("Run has no exact failed CI snapshot eligible for repair");
  if (!reviewContextMatches(database,requestId,snapshot.head_sha,snapshot.pull_request_url))
    fail("Projects CI repair request refers to a different PR or commit");
  const active = database
    .prepare(
      `SELECT 1 FROM run_ci_repair_attempts
       WHERE run_id = ? AND attempt_state IN ('running', 'waiting_ci')`,
    )
    .get(run.run_id);
  if (active) fail("A CI repair attempt is already active");
  const count = Number(
    (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM run_ci_repair_attempts WHERE run_id = ?`,
        )
        .get(run.run_id) as { count: number }
    ).count,
  );
  if (count >= 2) fail("CI repair attempt budget is exhausted");
  const checks = JSON.parse(snapshot.checks_json) as CiCheck[];
  if (!Array.isArray(checks)) fail("CI repair snapshot checks are invalid");
  return {
    requestId,
    attemptId: `cra_${requestId.replace(/^rq_/u, "")}`,
    attemptNumber: count + 1,
    sourceHeadSha: snapshot.head_sha,
    sourceCiState: snapshot.aggregate_state as "failed" | "missing",
    sourceChecks: checks,
    pullRequestNumber: snapshot.pull_request_number,
    pullRequestUrl: snapshot.pull_request_url,
  };
}

export async function loadReviewFixContext(
  database: DatabaseSync,
  run: SessionRun,
  project: ProjectConfig,
  requestId: string,
): Promise<ReviewFixContext> {
  const request = database
    .prepare(
      `SELECT 1 FROM run_control_requests
       WHERE request_id = ? AND run_id = ? AND action = 'review_fix'
         AND request_state = 'pending'`,
    )
    .get(requestId, run.run_id);
  if (!request) fail("Review fix request is no longer pending");
  if (
    database
      .prepare(
        `SELECT 1 FROM run_review_fix_rounds
         WHERE run_id = ? AND round_state IN ('running', 'waiting_ci', 'resolving')`,
      )
      .get(run.run_id)
  )
    fail("A review fix round is already active");
  const snapshot = database
    .prepare(
      `SELECT pull_request_number, pull_request_url, head_sha
       FROM run_ci_snapshots WHERE run_id = ?`,
    )
    .get(run.run_id) as
    | {
        pull_request_number: number | null;
        pull_request_url: string | null;
        head_sha: string | null;
      }
    | undefined;
  if (!snapshot?.pull_request_number || !snapshot.pull_request_url || !snapshot.head_sha)
    fail("Run has no exact pull request snapshot eligible for review fixes");
  if (!reviewContextMatches(database,requestId,snapshot.head_sha,snapshot.pull_request_url))
    fail("Projects review fix request refers to a different PR or commit");
  const readyReviews = database
    .prepare(
      `SELECT review_id, github_review_id FROM run_ai_reviews
       WHERE run_id = ? AND head_sha = ? AND review_state = 'ready'
       ORDER BY review_number`,
    )
    .all(run.run_id, snapshot.head_sha) as Array<{ review_id: string; github_review_id: string | null }>;
  const validReviewIds = new Set(readyReviews.map((row) => row.review_id));
  const credentials = await loadGitHubAppCredentialsFromFile(orchestratorHome);
  const token = await createGitHubAppInstallationToken(credentials);
  const threads = await fetchActionableReviewThreads(
    token,
    run.repository,
    snapshot.pull_request_number,
    project.owner,
    snapshot.head_sha,
    validReviewIds,
  );
  const summaryFindings = await fetchSummaryOnlyReviewFindings(
    token,
    run.repository,
    snapshot.pull_request_number,
    snapshot.head_sha,
    readyReviews
      .filter((row): row is { review_id: string; github_review_id: string } => Boolean(row.github_review_id))
      .map((row) => ({ reviewId: row.review_id, githubReviewId: row.github_review_id })),
  );
  const threadedFindingIds = new Set(
    threads
      .filter((thread) => thread.sourceKind === "ai" && thread.reviewId && thread.findingNumber)
      .map((thread) => `${thread.reviewId}:${thread.findingNumber}`),
  );
  const unthreadedSummaryFindings = summaryFindings.filter(
    (finding) => !threadedFindingIds.has(`${finding.reviewId}:${finding.findingNumber}`),
  );
  if (threads.length === 0 && unthreadedSummaryFindings.length === 0)
    fail("No actionable unresolved review threads or AI findings exist on the current PR SHA");
  const roundNumber = Number(
    (
      database
        .prepare(`SELECT COUNT(*) AS count FROM run_review_fix_rounds WHERE run_id = ?`)
        .get(run.run_id) as { count: number }
    ).count,
  ) + 1;
  return {
    requestId,
    roundId: `rfr_${requestId.replace(/^rq_/u, "")}`,
    roundNumber,
    sourceHeadSha: snapshot.head_sha,
    pullRequestNumber: snapshot.pull_request_number,
    pullRequestUrl: snapshot.pull_request_url,
    threads,
    summaryOnlyFindings: unthreadedSummaryFindings,
  };
}

export async function validateAndPlan(
  run: SessionRun,
  registry: ProjectsRegistry,
  repair: RepairContext | null = null,
  reviewFix: ReviewFixContext | null = null,
): Promise<StartPlan> {
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  if (project.repository.toLowerCase() !== run.repository.toLowerCase()) {
    fail(`Repository mapping mismatch for run: ${run.run_id}`);
  }
  if (!run.worktree_path || !run.branch_name) {
    fail(`Run has no worktree/branch mapping: ${run.run_id}`);
  }

  const worktreeRoot = resolve(project.workspace.worktree_root);
  const worktreePath = resolve(run.worktree_path);
  const relativePath = relative(worktreeRoot, worktreePath);
  if (
    !relativePath ||
    relativePath.startsWith("..") ||
    resolve(worktreeRoot, relativePath) !== worktreePath
  ) {
    fail(`Worktree path escapes configured root: ${worktreePath}`);
  }
  const worktreeStats = await stat(worktreePath);
  if (!worktreeStats.isDirectory())
    fail(`Worktree is not a directory: ${worktreePath}`);
  if ((await realpath(worktreePath)) !== worktreePath) {
    fail(`Worktree path is not canonical: ${worktreePath}`);
  }
  if (git(worktreePath, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    fail(`Path is not a Git worktree: ${worktreePath}`);
  }
  const actualBranch = git(worktreePath, ["branch", "--show-current"]);
  if (actualBranch !== run.branch_name) {
    fail(`Branch mismatch: expected ${run.branch_name}, got ${actualBranch}`);
  }
  if (run.base_sha && !gitIsAncestor(worktreePath, run.base_sha)) {
    fail(`Recorded base SHA is not an ancestor of worktree HEAD`);
  }
  if (repair || reviewFix) {
    if (git(worktreePath, ["status", "--porcelain"]))
      fail("Technical fix requires a clean managed worktree");
    const head = git(worktreePath, ["rev-parse", "HEAD"]);
    const sourceHeadSha = repair?.sourceHeadSha ?? reviewFix!.sourceHeadSha;
    if (head !== sourceHeadSha)
      fail(
        `Technical fix exact SHA mismatch: worktree=${head}, snapshot=${sourceHeadSha}`,
      );
  }

  const requestedCodex = process.env.CODEX_BIN?.trim() || "codex";
  const codexBin = requestedCodex.includes("/")
    ? resolve(requestedCodex)
    : runFile("which", [requestedCodex]);
  const codexStats = await stat(codexBin);
  if (!codexStats.isFile() || (codexStats.mode & 0o111) === 0) {
    fail(`Codex executable is not runnable: ${codexBin}`);
  }
  const launcherStats = await stat(launcherPath);
  if (!launcherStats.isFile() || (launcherStats.mode & 0o111) === 0) {
    fail(`Session launcher is not executable: ${launcherPath}`);
  }

  return {
    runId: run.run_id,
    project: run.project,
    repository: run.repository,
    issueNumber: run.issue_number,
    worktreePath,
    canonicalRepository: resolve(project.workspace.canonical_repository),
    branchName: run.branch_name,
    tmuxSessionName: run.tmux_session_name ?? sessionName(run, project),
    launcherPath,
    codexBin,
    codexTitle: repair
      ? `${codexTitle(run, project)} · CI fix ${repair.attemptNumber}/2`
      : reviewFix
        ? `${codexTitle(run, project)} · Review fix ${reviewFix.roundNumber}`
        : codexTitle(run, project),
    initialPrompt: repair
      ? repairPrompt(run, repair)
      : reviewFix
        ? reviewFixPrompt(run, reviewFix)
        : initialPrompt(run),
    repair,
    reviewFix,
  };
}

function claimSession(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
  maxTmuxSessions: number,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (current.owner_state === "remote") fail("Remote ownership changed before start claim");
    if (
      current.run_state !== "starting" ||
      current.owner_state !== "none" ||
      current.resource_state !== "provisioned" ||
      current.tmux_session_name !== null ||
      current.previous_codex_thread_id !== null ||
      current.codex_thread_id !== null
    ) {
      fail(
        `Run is not session-startable: state=${current.run_state}, owner=${current.owner_state}, resource=${current.resource_state}, tmux=${current.tmux_session_name ?? "none"}`,
      );
    }
    const mappedCount = Number(
      (
        database
          .prepare(
            `
            SELECT COUNT(*) AS count
            FROM run_resources rr
            JOIN runs r USING (run_id)
            WHERE rr.tmux_session_name IS NOT NULL
              AND r.state IN ('starting', 'running', 'handoff_pending', 'stopping', 'needs_attention')
          `,
          )
          .get() as { count: number }
      ).count,
    );
    if (mappedCount >= maxTmuxSessions) {
      fail(`tmux mapping limit reached: ${mappedCount}/${maxTmuxSessions}`);
    }
    const resourceChanged = database
      .prepare(
        `
        UPDATE run_resources
        SET tmux_session_name = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND tmux_session_name IS NULL
      `,
      )
      .run(plan.tmuxSessionName, run.run_id);
    if (resourceChanged.changes !== 1)
      fail("Run tmux mapping changed before session claim");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function claimRepairSession(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
  maxTmuxSessions: number,
): void {
  const repair = plan.repair;
  if (!repair) fail("Missing CI repair context");
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== "parked_review" ||
      current.owner_state !== "none" ||
      current.resource_state !== "provisioned" ||
      current.tmux_session_name !== null
    ) {
      fail(
        `Run is not CI-repairable: state=${current.run_state}, owner=${current.owner_state}, resource=${current.resource_state}, tmux=${current.tmux_session_name ?? "none"}`,
      );
    }
    const mappedCount = Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM run_resources rr
             JOIN runs r USING (run_id)
             WHERE rr.tmux_session_name IS NOT NULL
               AND r.state IN ('starting', 'running', 'handoff_pending', 'parked_review', 'stopping', 'needs_attention')`,
          )
          .get() as { count: number }
      ).count,
    );
    if (mappedCount >= maxTmuxSessions)
      fail(`tmux mapping limit reached: ${mappedCount}/${maxTmuxSessions}`);
    const request = database
      .prepare(
        `SELECT 1 FROM run_control_requests
         WHERE request_id = ? AND run_id = ? AND action = 'ci_repair'
           AND request_state = 'pending'`,
      )
      .get(repair.requestId, run.run_id);
    if (!request) fail("CI repair request changed before claim");
    const snapshot = database
      .prepare(
        `SELECT head_sha, aggregate_state FROM run_ci_snapshots WHERE run_id = ?`,
      )
      .get(run.run_id) as
      | { head_sha: string | null; aggregate_state: string }
      | undefined;
    if (
      snapshot?.head_sha !== repair.sourceHeadSha ||
      snapshot.aggregate_state !== repair.sourceCiState
    )
      fail("CI snapshot changed before repair claim");
    const mapped = database
      .prepare(
        `UPDATE run_resources SET tmux_session_name = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND tmux_session_name IS NULL`,
      )
      .run(plan.tmuxSessionName, run.run_id);
    if (mapped.changes !== 1) fail("Run tmux mapping changed before repair claim");
    database
      .prepare(
        `INSERT INTO run_ci_repair_attempts (
           attempt_id, run_id, request_id, attempt_number, source_head_sha,
           source_ci_state, source_checks_json, attempt_state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'running')`,
      )
      .run(
        repair.attemptId,
        run.run_id,
        repair.requestId,
        repair.attemptNumber,
        repair.sourceHeadSha,
        repair.sourceCiState,
        JSON.stringify(repair.sourceChecks),
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function claimReviewFixSession(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
  maxTmuxSessions: number,
): void {
  const fix = plan.reviewFix;
  if (!fix) fail("Missing review fix context");
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== "parked_review" ||
      current.owner_state !== "none" ||
      current.resource_state !== "provisioned" ||
      current.tmux_session_name !== null ||
      current.previous_codex_thread_id !== null ||
      !current.codex_thread_id
    )
      fail("Run is not in a stable review-fixable state");
    const mappedCount = Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM run_resources rr
             JOIN runs r USING (run_id)
             WHERE rr.tmux_session_name IS NOT NULL
               AND r.state IN ('starting','running','handoff_pending','parked_review','stopping','needs_attention')`,
          )
          .get() as { count: number }
      ).count,
    );
    if (mappedCount >= maxTmuxSessions)
      fail(`tmux mapping limit reached: ${mappedCount}/${maxTmuxSessions}`);
    const currentSnapshot = database
      .prepare(`SELECT head_sha FROM run_ci_snapshots WHERE run_id = ?`)
      .get(run.run_id) as { head_sha: string | null } | undefined;
    if (currentSnapshot?.head_sha !== fix.sourceHeadSha)
      fail("Pull request head changed before review fix claim");
    const mapped = database
      .prepare(
        `UPDATE run_resources SET tmux_session_name = ?,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND tmux_session_name IS NULL`,
      )
      .run(plan.tmuxSessionName, run.run_id);
    if (mapped.changes !== 1) fail("Run tmux mapping changed before review fix claim");
    database
      .prepare(
        `INSERT INTO run_review_fix_rounds (
           round_id, run_id, request_id, round_number, round_state,
           repository, pull_request_number, pull_request_url,
           source_head_sha, snapshot_json
         ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
      )
      .run(
        fix.roundId,
        run.run_id,
        fix.requestId,
        fix.roundNumber,
        run.repository,
        fix.pullRequestNumber,
        fix.pullRequestUrl,
        fix.sourceHeadSha,
        JSON.stringify(fix.threads),
      );
    const insertThread = database.prepare(
      `INSERT INTO run_review_fix_threads (
         round_id, thread_id, root_comment_id, source_kind, path, line
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const thread of fix.threads)
      insertThread.run(
        fix.roundId,
        thread.threadId,
        thread.rootCommentId,
        thread.sourceKind,
        thread.path,
        thread.line,
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordStarted(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = database
      .prepare(
        `
        UPDATE runs
        SET state = 'running', owner_state = 'cli',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND state = 'starting' AND owner_state = 'none'
      `,
      )
      .run(run.run_id);
    if (result.changes !== 1)
      fail("Run ownership changed during session start");
    appendHistory(
      database,
      run.run_id,
      "starting",
      "running",
      "codex_initial_turn_started",
      {
        tmuxSessionName: plan.tmuxSessionName,
        ownerState: "cli",
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordRepairStarted(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
): void {
  const repair = plan.repair;
  if (!repair) fail("Missing CI repair context");
  database.exec("BEGIN IMMEDIATE");
  try {
    const changed = database
      .prepare(
        `UPDATE runs SET owner_state = 'cli',
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND state = 'parked_review' AND owner_state = 'none'`,
      )
      .run(run.run_id);
    if (changed.changes !== 1) fail("Run ownership changed during CI repair start");
    const resourceChanged = database
      .prepare(
        `UPDATE run_resources
         SET previous_codex_thread_id = codex_thread_id,
             codex_thread_id = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND tmux_session_name = ?
           AND previous_codex_thread_id IS NULL
           AND codex_thread_id IS NOT NULL`,
      )
      .run(run.run_id, plan.tmuxSessionName);
    if (resourceChanged.changes !== 1)
      fail("Run resource mapping changed during CI repair start");
    appendHistory(
      database,
      run.run_id,
      "parked_review",
      "parked_review",
      "ci_repair_started",
      {
        requestId: repair.requestId,
        attemptId: repair.attemptId,
        attemptNumber: repair.attemptNumber,
        sourceHeadSha: repair.sourceHeadSha,
        tmuxSessionName: plan.tmuxSessionName,
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordReviewFixStarted(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
): void {
  const fix = plan.reviewFix;
  if (!fix) fail("Missing review fix context");
  database.exec("BEGIN IMMEDIATE");
  try {
    const changed = database
      .prepare(
        `UPDATE runs SET owner_state = 'cli',
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND state = 'parked_review' AND owner_state = 'none'`,
      )
      .run(run.run_id);
    if (changed.changes !== 1) fail("Run ownership changed during review fix start");
    const resourceChanged = database
      .prepare(
        `UPDATE run_resources
         SET previous_codex_thread_id = codex_thread_id,
             codex_thread_id = NULL,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ? AND tmux_session_name = ?
           AND previous_codex_thread_id IS NULL
           AND codex_thread_id IS NOT NULL`,
      )
      .run(run.run_id, plan.tmuxSessionName);
    if (resourceChanged.changes !== 1)
      fail("Run resource mapping changed during review fix start");
    appendHistory(database, run.run_id, "parked_review", "parked_review", "review_fix_started", {
      requestId: fix.requestId,
      roundId: fix.roundId,
      roundNumber: fix.roundNumber,
      sourceHeadSha: fix.sourceHeadSha,
      threadCount: fix.threads.length,
      tmuxSessionName: plan.tmuxSessionName,
    });
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordStartFailure(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (current.owner_state === "remote") fail("Remote ownership changed; start failure cannot seize it");
    database
      .prepare(
        `
        UPDATE runs
        SET state = 'needs_attention', owner_state = 'none',
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
        WHERE run_id = ? AND tmux_session_name = ?
      `,
      )
      .run(run.run_id, plan.tmuxSessionName);
    if (plan.repair) {
      database
        .prepare(
          `UPDATE run_ci_repair_attempts
           SET attempt_state = 'needs_attention', failure_reason = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE attempt_id = ? AND attempt_state = 'running'`,
        )
        .run(message, plan.repair.attemptId);
    }
    if (plan.reviewFix) {
      database
        .prepare(
          `UPDATE run_review_fix_rounds
           SET round_state = 'needs_attention', failure_reason = ?,
               updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
               completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE round_id = ? AND round_state = 'running'`,
        )
        .run(message, plan.reviewFix.roundId);
    }
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      "needs_attention",
      plan.repair
        ? "ci_repair_tmux_start_failed"
        : plan.reviewFix
          ? "review_fix_tmux_start_failed"
          : "codex_tmux_start_failed",
      { tmuxSessionName: plan.tmuxSessionName, error: message },
    );
    database.exec("COMMIT");
  } catch (recordError) {
    database.exec("ROLLBACK");
    const recordMessage =
      recordError instanceof Error ? recordError.message : String(recordError);
    throw new Error(
      `${message}; additionally failed to record state: ${recordMessage}`,
    );
  }
}

async function launchManagedTmux(run: SessionRun, plan: StartPlan, taskId: string | null, timeoutMs: number, onDispatch: () => void): Promise<void> {
  const promptDirectory = resolve(orchestratorHome, "state/session-prompts");
  const promptPath = resolve(promptDirectory, `${run.run_id}-${Date.now()}.b64`);
  await mkdir(promptDirectory, { recursive: true, mode: 0o700 });
  await writeFile(promptPath, Buffer.from(plan.initialPrompt, "utf8").toString("base64"), { mode: 0o600, flag: "wx" });
  onDispatch();
  runFile("tmux", [
    "new-session",
    "-d",
    "-s",
    plan.tmuxSessionName,
    "-c",
    plan.worktreePath,
    "-e",
    `KURAMI_HOME=${orchestratorHome}`,
    "-e",
    `HERMES_RUN_ID=${run.run_id}`,
    "-e",
    `HERMES_REPOSITORY=${run.repository}`,
    "-e",
    `HERMES_ISSUE_NUMBER=${run.issue_number}`,
    "-e",
    `HERMES_WORKTREE_PATH=${plan.worktreePath}`,
    "-e",
    `HERMES_CANONICAL_REPOSITORY=${plan.canonicalRepository}`,
    "-e",
    `HERMES_INITIAL_PROMPT_FILE=${promptPath}`,
    "-e",
    `CODEX_BIN=${plan.codexBin}`,
    ...(taskId ? ["-e", `HERMES_CODEX_TASK_ID=${taskId}`, "-e", `HERMES_CODEX_TASK_OPTIONS=${JSON.stringify({ title:plan.codexTitle, timeoutMs })}`] : []),
    plan.launcherPath,
  ]);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  if (!taskId && !tmuxSessionExists(plan.tmuxSessionName)) {
    fail(`tmux session exited during startup: ${plan.tmuxSessionName}`);
  }
}

export async function startSession(
  database: DatabaseSync,
  run: SessionRun,
  plan: StartPlan,
  config: OrchestratorConfig,
  apply: boolean,
): Promise<void> {
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, plan })}\n`,
    );
    return;
  }
  if (config.mode !== "live" || run.execution_mode !== "live") {
    fail(`Refusing session mutation outside live mode`);
  }
  const stateReady = plan.repair || plan.reviewFix
    ? run.run_state === "parked_review" && run.owner_state === "none"
    : run.run_state === "starting" && run.owner_state === "none";
  if (!stateReady || run.resource_state !== "provisioned") {
    fail(
      `Run is not ready for session start: state=${run.run_state}, resource=${run.resource_state}`,
    );
  }
  if (run.tmux_session_name) {
    fail(`Run already has tmux mapping: ${run.tmux_session_name}`);
  }
  if (tmuxSessionExists(plan.tmuxSessionName)) {
    fail(
      `tmux session already exists without this run mapping: ${plan.tmuxSessionName}`,
    );
  }
  const actualCount = managedTmuxSessionCount();
  if (actualCount >= config.limits.max_tmux_sessions_global) {
    fail(
      `managed tmux limit reached: ${actualCount}/${config.limits.max_tmux_sessions_global}`,
    );
  }

  if (plan.repair)
    claimRepairSession(
      database,
      run,
      plan,
      config.limits.max_tmux_sessions_global,
    );
  else if (plan.reviewFix)
    claimReviewFixSession(
      database,
      run,
      plan,
      config.limits.max_tmux_sessions_global,
    );
  else claimSession(database, run, plan, config.limits.max_tmux_sessions_global);
  let dispatchAttempted = false;
  try {
    if (plan.repair) recordRepairStarted(database, run, plan);
    else if (plan.reviewFix) recordReviewFixStarted(database, run, plan);
    const protocol = Boolean(plan.repair || plan.reviewFix);
    const taskId = protocol ? claimProtocolTask(database,run.run_id,plan.tmuxSessionName,
      plan.repair ? "ci_repair" : "review_fix",
      plan.repair?.attemptId ?? plan.reviewFix?.roundId ?? run.run_id) : null;
    await launchManagedTmux(run, plan, taskId, 60_000 * (plan.repair || plan.reviewFix ? config.limits.technical_worker_timeout_minutes ?? 90 : config.limits.main_writer_timeout_minutes ?? 240), () => { dispatchAttempted = true; });
    if (!taskId) recordStarted(database, run, plan);
    if (taskId && !tmuxSessionExists(plan.tmuxSessionName) && !taskForSession(database,plan.tmuxSessionName)?.stopped_at)
      fail("Protocol worker exited without a stop receipt");
  } catch (error) {
    const task = taskForSession(database,plan.tmuxSessionName);
    if (task && !dispatchAttempted) {
      database.prepare("UPDATE run_codex_tasks SET stopped_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),released_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),failure_code='protocol_launch_failed' WHERE task_id=?").run(task.task_id);
      recordStartFailure(database,run,plan,error);
      throw error;
    }
    if (task) {
      database.prepare("UPDATE runs SET state='needs_attention' WHERE run_id=? AND owner_state='cli'").run(run.run_id);
      throw error;
    }
    if (tmuxSessionExists(plan.tmuxSessionName))
      killTmuxSession(plan.tmuxSessionName);
    recordStartFailure(database, run, plan, error);
    throw error;
  }

  writeSync(1,
    `${JSON.stringify({ ok: true, apply: true, action: plan.repair ? "repair_started" : plan.reviewFix ? "review_fix_started" : "started", ...plan, ownerState: "cli", runState: plan.repair || plan.reviewFix ? "parked_review" : "running" })}\n`,
  );
}

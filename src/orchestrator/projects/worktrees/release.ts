import { completeSuccessions } from "../sessions/complete-successions.ts";
import { execFileSync, spawnSync } from "node:child_process";
import { readFile, realpath, rmdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { validateMergedDeliverySource } from "../ci/merged-delivery.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";

process.umask(0o077);

type ProjectConfig = {
  repository: string;
  workspace: {
    canonical_repository: string;
    worktree_root: string;
    base_branch: string;
  };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type RunResource = {
  run_id: string;
  project: string;
  run_state: string;
  owner_state: string;
  execution_mode: "dry_run" | "live";
  stop_reason: "cancelled" | "completed" | null;
  resource_state: string;
  base_sha: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  tmux_session_name: string | null;
  preview_id: string | null;
  active_preview_lease: number;
  merged_delivery_json: string | null;
};

type ReleasePlan = {
  runId: string;
  canonicalRepository: string;
  worktreePath: string;
  attemptDirectory: string;
  branchName: string;
  baseSha: string;
  worktreeExists: boolean;
  branchExists: boolean;
  clean: boolean;
  headSha: string;
  commitsAfterBase: number;
  remoteBaseRef: string;
  mergedIntoBase: boolean;
  completionVerified: boolean;
  mergeEvidence: "git_ancestry" | "github_pr" | null;
  mergedPullRequestNumber: number | null;
  mergedPullRequestUrl: string | null;
  mergeVerificationError: string | null;
  finalState: "cancelled" | "archived";
};

type PullRequestEvidence = {
  number: number;
  url: string;
  headRefOid: string;
  mergedAt: string | null;
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): { runId: string; apply: boolean } {
  const args = process.argv.slice(2);
  const runIndex = args.indexOf("--run-id");
  const runId = runIndex >= 0 ? args[runIndex + 1]?.trim() : undefined;
  const unknown = args.filter(
    (arg, index) =>
      arg !== "--apply" && arg !== "--run-id" && index !== runIndex + 1,
  );
  if (!runId || unknown.length > 0) {
    fail("Usage: release-worktree.ts --run-id <run_id> [--apply]");
  }
  return { runId, apply: args.includes("--apply") };
}

function runFile(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function git(repositoryPath: string, args: string[]): string {
  return runFile("git", ["-C", repositoryPath, ...args]);
}

function gitRefExists(repositoryPath: string, ref: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", repositoryPath, "show-ref", "--verify", "--quiet", ref],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail(result.stderr.trim() || `Failed to inspect Git ref: ${ref}`);
}

function verifyMergedPullRequest(
  repository: string,
  baseBranch: string,
  branchName: string,
  headSha: string,
  expected?: { number: number; url: string },
): {
  verified: boolean;
  number: number | null;
  url: string | null;
  error: string | null;
} {
  const result = spawnSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository,
      "--state",
      "merged",
      "--head",
      branchName,
      "--base",
      baseBranch,
      "--limit",
      "20",
      "--json",
      "number,url,headRefOid,mergedAt",
    ],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    },
  );
  if (result.status !== 0) {
    return {
      verified: false,
      number: null,
      url: null,
      error:
        result.error?.message ??
        result.stderr.trim() ??
        `gh pr list exited with status ${result.status ?? "unknown"}`,
    };
  }
  try {
    const candidates = JSON.parse(result.stdout) as PullRequestEvidence[];
    const merged = candidates.find(
      (pullRequest) =>
        pullRequest.mergedAt !== null && pullRequest.headRefOid === headSha &&
        (!expected || (pullRequest.number === expected.number && pullRequest.url === expected.url)),
    );
    return merged
      ? { verified: true, number: merged.number, url: merged.url, error: null }
      : { verified: false, number: null, url: null, error: null };
  } catch (error) {
    return {
      verified: false,
      number: null,
      url: null,
      error: `Invalid gh pr list response: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function loadRun(database: DatabaseSync, runId: string): RunResource {
  const row = database
    .prepare(`
      SELECT r.run_id, r.project, r.state AS run_state, r.owner_state,
             r.execution_mode, r.stop_reason, rr.resource_state, rr.base_sha,
             rr.worktree_path, rr.branch_name, rr.tmux_session_name,
             rr.preview_id,
             (SELECT h.details_json FROM run_state_history h WHERE h.run_id=r.run_id
              AND h.reason='merged_delivery_completion_requested'
              ORDER BY h.sequence DESC LIMIT 1) AS merged_delivery_json,
             EXISTS (
               SELECT 1 FROM preview_leases pl
               WHERE pl.run_id = r.run_id AND pl.state <> 'released'
             ) AS active_preview_lease
      FROM runs r
      JOIN run_resources rr USING (run_id)
      WHERE r.run_id = ?
    `)
    .get(runId) as RunResource | undefined;
  if (!row) fail(`Run or resource mapping not found: ${runId}`);
  return row;
}

function appendHistory(
  database: DatabaseSync,
  runId: string,
  fromState: string,
  toState: string,
  reason: string,
  details: unknown,
): void {
  database
    .prepare(`
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, details_json
      ) VALUES (?, ?, ?, ?, ?)
    `)
    .run(runId, fromState, toState, reason, JSON.stringify(details));
}

async function buildPlan(
  run: RunResource,
  registry: ProjectsRegistry,
  refreshRemote: boolean,
): Promise<ReleasePlan> {
  if (run.run_state !== "stopping" && run.run_state !== "needs_attention") {
    fail(`Run is not releasable: state=${run.run_state}`);
  }
  if (run.execution_mode !== "live") {
    fail(`Run is not live: execution_mode=${run.execution_mode}`);
  }
  if (run.tmux_session_name) {
    fail(`Run still has a tmux mapping: ${run.tmux_session_name}`);
  }
  if (run.preview_id || run.active_preview_lease !== 0) {
    fail(`Run still has an active preview; clean preview runtime before worktree release`);
  }
  if (!run.base_sha || !run.worktree_path || !run.branch_name) {
    fail(`Run has incomplete Git resource mapping`);
  }

  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  const canonicalRepository = resolve(project.workspace.canonical_repository);
  const remoteBaseRef = `refs/remotes/origin/${project.workspace.base_branch}`;
  if (refreshRemote) {
    git(canonicalRepository, ["fetch", "--prune", "origin", project.workspace.base_branch]);
  }
  if (!gitRefExists(canonicalRepository, remoteBaseRef)) {
    fail(`Remote base ref does not exist: ${remoteBaseRef}`);
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
  const repositoryDirectory = project.repository.split("/").at(-1);
  if (!repositoryDirectory || basename(worktreePath) !== repositoryDirectory) {
    fail(`Worktree does not use the canonical repository basename`);
  }
  const attemptDirectory = dirname(worktreePath);
  const attemptRelative = relative(worktreeRoot, attemptDirectory);
  if (!attemptRelative || attemptRelative.startsWith("..")) {
    fail(`Attempt directory escapes configured root: ${attemptDirectory}`);
  }

  const worktreeExists = await pathExists(worktreePath);
  const branchRef = `refs/heads/${run.branch_name}`;
  const branchExists = gitRefExists(canonicalRepository, branchRef);
  let clean = true;
  let headSha = run.base_sha;
  let commitsAfterBase = 0;

  if (worktreeExists) {
    if ((await realpath(worktreePath)) !== worktreePath) {
      fail(`Worktree path is not canonical: ${worktreePath}`);
    }
    if (git(worktreePath, ["rev-parse", "--show-toplevel"]) !== worktreePath) {
      fail(`Path is not the expected Git worktree: ${worktreePath}`);
    }
    const actualBranch = git(worktreePath, ["branch", "--show-current"]);
    if (actualBranch !== run.branch_name) {
      fail(`Branch mismatch: expected ${run.branch_name}, got ${actualBranch}`);
    }
    clean = git(worktreePath, ["status", "--porcelain"]) === "";
    headSha = git(worktreePath, ["rev-parse", "HEAD"]);
    commitsAfterBase = Number(
      git(worktreePath, ["rev-list", "--count", `${run.base_sha}..HEAD`]),
    );
  } else if (branchExists) {
    headSha = git(canonicalRepository, ["rev-parse", branchRef]);
    commitsAfterBase = Number(
      git(canonicalRepository, ["rev-list", "--count", `${run.base_sha}..${branchRef}`]),
    );
  }

  if (!clean) fail(`Worktree has uncommitted changes; refusing release`);
  const mergedIntoBase =
    spawnSync(
      "git",
      ["-C", canonicalRepository, "merge-base", "--is-ancestor", headSha, remoteBaseRef],
      { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    ).status === 0;
  let completionVerified = mergedIntoBase;
  let mergeEvidence: ReleasePlan["mergeEvidence"] = mergedIntoBase
    ? "git_ancestry"
    : null;
  let mergedPullRequestNumber: number | null = null;
  let mergedPullRequestUrl: string | null = null;
  let mergeVerificationError: string | null = null;
  const delivery = run.stop_reason === "completed" && run.merged_delivery_json
    ? JSON.parse(run.merged_delivery_json) as { number: number; url: string; headSha: string }
    : null;
  if (delivery && headSha !== delivery.headSha) fail("Merged delivery source changed; refusing release");
  if (refreshRemote && (!mergedIntoBase || delivery)) {
    const pullRequest = verifyMergedPullRequest(
      project.repository,
      project.workspace.base_branch,
      run.branch_name,
      headSha,
      delivery ?? undefined,
    );
    completionVerified = pullRequest.verified;
    mergeEvidence = pullRequest.verified ? "github_pr" : null;
    mergedPullRequestNumber = pullRequest.number;
    mergedPullRequestUrl = pullRequest.url;
    mergeVerificationError = pullRequest.error;
  }
  if (
    !completionVerified &&
    run.run_state !== "needs_attention" &&
    run.stop_reason !== "completed" &&
    (commitsAfterBase !== 0 || headSha !== run.base_sha)
  ) {
    fail(
      `Branch contains work beyond the recorded base without verified merge evidence: head=${headSha}, base=${run.base_sha}, commitsAfterBase=${commitsAfterBase}`,
    );
  }
  return {
    runId: run.run_id,
    canonicalRepository,
    worktreePath,
    attemptDirectory,
    branchName: run.branch_name,
    baseSha: run.base_sha,
    worktreeExists,
    branchExists,
    clean,
    headSha,
    commitsAfterBase,
    remoteBaseRef,
    mergedIntoBase,
    completionVerified,
    mergeEvidence,
    mergedPullRequestNumber,
    mergedPullRequestUrl,
    mergeVerificationError,
    // A cancellation must remain a cancellation even when its branch happens to
    // be an ancestor of the current base. Otherwise the release path archives
    // the run and bypasses the controller's cancelled-item Backlog writeback.
    finalState:
      run.stop_reason === "cancelled"
        ? "cancelled"
        : completionVerified
          ? "archived"
          : "cancelled",
  };
}

function claimRelease(database: DatabaseSync, run: RunResource, validate?: () => void): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (validate) validate();
    if (
      current.run_state !== run.run_state || current.stop_reason !== run.stop_reason ||
      !["provisioned", "partial", "releasing"].includes(current.resource_state) ||
      current.tmux_session_name !== null
    ) {
      fail(
        `Run changed before release: state=${current.run_state}, resource=${current.resource_state}, tmux=${current.tmux_session_name ?? "none"}`,
      );
    }
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'releasing',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      current.run_state,
      "worktree_release_started",
      { previousResourceState: current.resource_state },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordReleased(
  database: DatabaseSync,
  run: RunResource,
  plan: ReleasePlan,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (current.resource_state !== "releasing") {
      fail(`Resource is not releasing: ${current.resource_state}`);
    }
    database
      .prepare(`
        UPDATE runs
        SET state = ?, owner_state = 'none',
            archived_at = CASE WHEN ? = 'archived' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE archived_at END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(plan.finalState, plan.finalState, run.run_id);
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'released',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    completeSuccessions(database, run.run_id);
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      plan.finalState,
      plan.finalState === "archived"
        ? "merged_worktree_release_completed"
        : "clean_worktree_release_completed",
      {
        worktreePath: plan.worktreePath,
        branchName: plan.branchName,
        baseSha: plan.baseSha,
        headSha: plan.headSha,
        remoteBaseRef: plan.remoteBaseRef,
        mergedIntoBase: plan.mergedIntoBase,
        completionVerified: plan.completionVerified,
        mergeEvidence: plan.mergeEvidence,
        mergedPullRequestNumber: plan.mergedPullRequestNumber,
        mergedPullRequestUrl: plan.mergedPullRequestUrl,
      },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordFailure(
  database: DatabaseSync,
  run: RunResource,
  error: unknown,
): void {
  const message = error instanceof Error ? error.message : String(error);
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    database
      .prepare(`
        UPDATE runs
        SET state = 'needs_attention', owner_state = 'none',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'partial',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      "needs_attention",
      "worktree_release_failed",
      { error: message },
    );
    database.exec("COMMIT");
  } catch (recordError) {
    database.exec("ROLLBACK");
    const recordMessage =
      recordError instanceof Error ? recordError.message : String(recordError);
    throw new Error(`${message}; additionally failed to record state: ${recordMessage}`);
  }
}

function recordBlocked(
  database: DatabaseSync,
  run: RunResource,
  error: unknown,
  reason = "worktree_release_blocked",
): void {
  const message = error instanceof Error ? error.message : String(error);
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (current.run_state !== "stopping" || current.stop_reason !== run.stop_reason) {
      database.exec("ROLLBACK");
      return;
    }
    database
      .prepare(`
        UPDATE runs
        SET state = 'needs_attention', owner_state = 'none',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    appendHistory(
      database,
      run.run_id,
      "stopping",
      "needs_attention",
      reason,
      { error: message },
    );
    database.exec("COMMIT");
  } catch (recordError) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // Preserve the original safety failure when rollback is already complete.
    }
    const recordMessage =
      recordError instanceof Error ? recordError.message : String(recordError);
    throw new Error(`${message}; additionally failed to record blocked state: ${recordMessage}`);
  }
}

export async function runReleaseWorktreeCli(): Promise<void> {
  const { runId, apply } = parseArguments();
  const registry = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
  if (registry.version !== 1) fail(`Unsupported projects registry version`);

  const database = openOrchestratorDatabase(databasePath);
  try {
    const run = loadRun(database, runId);
    let plan: ReleasePlan;
    try {
      plan = await buildPlan(run, registry, apply);
    } catch (error) {
      if (apply) recordBlocked(database, run, error);
      throw error;
    }
    if (!apply) {
      process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
      return;
    }
    if (
      !plan.completionVerified &&
      (run.stop_reason === "completed" || run.run_state === "needs_attention")
    ) {
      if (run.stop_reason === "completed") {
        recordBlocked(
          database,
          run,
          "Done has no verified merge. Work is preserved; merge the pull request or cancel the run.",
          "completion_waiting_for_merge",
        );
      }
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          apply: true,
          action: "waiting_for_merge",
          runId: run.run_id,
          branchName: plan.branchName,
          headSha: plan.headSha,
          remoteBaseRef: plan.remoteBaseRef,
          mergeVerificationError: plan.mergeVerificationError,
        })}\n`,
      );
      return;
    }

    claimRelease(database, run, run.stop_reason === "completed" && run.merged_delivery_json
      ? () => validateMergedDeliverySource(database, registry.projects[run.project]!, run.run_id, plan.headSha)
      : undefined);
    try {
      if (plan.worktreeExists) {
        git(plan.canonicalRepository, ["worktree", "remove", plan.worktreePath]);
      }
      if (gitRefExists(plan.canonicalRepository, `refs/heads/${plan.branchName}`)) {
        git(plan.canonicalRepository, ["branch", "-D", plan.branchName]);
      }
      try {
        await rmdir(plan.attemptDirectory);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "ENOENT" && code !== "ENOTEMPTY") throw error;
      }
      recordReleased(database, run, plan);
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, action: "released", ...plan })}\n`,
      );
    } catch (error) {
      recordFailure(database, run, error);
      throw error;
    }
  } finally {
    database.close();
  }
}

if (import.meta.main) {
  runReleaseWorktreeCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}

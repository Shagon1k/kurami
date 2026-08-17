import { execFileSync, spawnSync } from "node:child_process";
import { realpath, rmdir, stat } from "node:fs/promises";
import { basename, dirname, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";

process.umask(0o077);

type ProjectConfig = {
  repository: string;
  workspace: {
    canonical_repository: string;
    worktree_root: string;
  };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type RunRow = {
  run_id: string;
  project: string;
  run_state: string;
  owner_state: string;
  stop_reason: string | null;
  resource_state: string;
  base_sha: string | null;
  worktree_path: string | null;
  branch_name: string | null;
  tmux_session_name: string | null;
  preview_id: string | null;
  active_preview_lease: number;
};

type DiscardPlan = {
  runId: string;
  eligible: boolean;
  blockers: string[];
  canonicalRepository: string;
  worktreePath: string;
  attemptDirectory: string;
  branchName: string;
  baseSha: string;
  headSha: string | null;
  changedFiles: string[];
  localBranchExists: boolean;
  remoteBranchExists: boolean | null;
};

type PullRequest = {
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  headRefOid: string;
  url: string;
  title: string;
};

type PublishedDiscardPlan = DiscardPlan & {
  repository: string;
  remoteHeadSha: string | null;
  pullRequest: PullRequest | null;
};

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): {
  command: "discard" | "discard-published";
  runId: string;
  apply: boolean;
} {
  const args = process.argv.slice(2);
  const command = args[0] as "discard" | "discard-published";
  const runId = args[1] === "--run-id" ? args[2]?.trim() : undefined;
  const apply = args[3] === "--apply";
  if (
    !["discard", "discard-published"].includes(command) ||
    !runId ||
    !/^r_[A-Za-z0-9_]+$/u.test(runId) ||
    !(
      (args.length === 3 && !apply) ||
      (args.length === 4 && apply)
    )
  ) {
    fail(
      "Usage: cancel-resolution.ts <discard|discard-published> --run-id <run_id> [--apply]",
    );
  }
  return { command, runId, apply };
}

function git(directory: string, args: string[]): string {
  return execFileSync("git", ["-C", directory, ...args], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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

function refExists(repository: string, ref: string): boolean {
  return (
    spawnSync("git", ["-C", repository, "show-ref", "--verify", "--quiet", ref], {
      env: process.env,
      stdio: "ignore",
    }).status === 0
  );
}

function remoteBranchState(
  repository: string,
  branchName: string,
): { exists: boolean | null; error?: string } {
  const result = spawnSync(
    "git",
    [
      "-C",
      repository,
      "ls-remote",
      "--exit-code",
      "--heads",
      "origin",
      `refs/heads/${branchName}`,
    ],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status === 0) return { exists: true };
  if (result.status === 2) return { exists: false };
  return {
    exists: null,
    error: `remote branch check failed: ${(result.stderr || result.stdout).trim() || `exit ${result.status ?? "unknown"}`}`,
  };
}

function remoteBranchHead(
  repository: string,
  branchName: string,
): { sha: string | null; error?: string } {
  const result = spawnSync(
    "git",
    ["-C", repository, "ls-remote", "--heads", "origin", branchName],
    { encoding: "utf8", env: process.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    return {
      sha: null,
      error: `remote branch head check failed: ${(result.stderr || result.stdout).trim() || `exit ${result.status ?? "unknown"}`}`,
    };
  }
  const line = result.stdout.trim().split("\n").filter(Boolean)[0];
  return { sha: line?.split(/\s+/u)[0] ?? null };
}

function matchingPullRequests(
  repository: string,
  branchName: string,
): PullRequest[] {
  const stdout = execFileSync(
    "gh",
    [
      "pr",
      "list",
      "--repo",
      repository,
      "--head",
      branchName,
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,state,isDraft,headRefOid,url,title",
    ],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(stdout) as PullRequest[];
}

function loadRun(database: DatabaseSync, runId: string): RunRow {
  const row = database
    .prepare(
      `
      SELECT r.run_id, r.project, r.state AS run_state, r.owner_state,
             r.stop_reason, rr.resource_state, rr.base_sha,
             rr.worktree_path, rr.branch_name, rr.tmux_session_name,
             rr.preview_id,
             EXISTS (
               SELECT 1 FROM preview_leases pl
               WHERE pl.run_id = r.run_id AND pl.state <> 'released'
             ) AS active_preview_lease
      FROM runs r
      JOIN run_resources rr USING (run_id)
      WHERE r.run_id = ?
    `,
    )
    .get(runId) as RunRow | undefined;
  if (!row) fail(`Run not found: ${runId}`);
  return row;
}

async function buildPlan(
  run: RunRow,
  registry: ProjectsRegistry,
): Promise<DiscardPlan> {
  const blockers: string[] = [];
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project: ${run.project}`);
  if (!run.worktree_path || !run.branch_name || !run.base_sha)
    fail("Run has incomplete Git resource mapping");

  if (run.run_state !== "needs_attention")
    blockers.push(`run state is ${run.run_state}, not needs_attention`);
  if (run.stop_reason !== "cancelled")
    blockers.push("run does not carry cancellation intent");
  if (run.owner_state !== "none")
    blockers.push(`run owner is ${run.owner_state}, not none`);
  if (run.tmux_session_name)
    blockers.push(`managed tmux is still mapped: ${run.tmux_session_name}`);
  if (run.preview_id || run.active_preview_lease !== 0)
    blockers.push("preview resources are still active");

  const canonicalRepository = resolve(project.workspace.canonical_repository);
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
  if (!repositoryDirectory || basename(worktreePath) !== repositoryDirectory)
    fail("Worktree does not use the configured repository basename");

  const attemptDirectory = dirname(worktreePath);
  const worktreeExists = await pathExists(worktreePath);
  const localBranchExists = refExists(
    canonicalRepository,
    `refs/heads/${run.branch_name}`,
  );
  let headSha: string | null = null;
  let changedFiles: string[] = [];

  if (!worktreeExists) {
    blockers.push("managed worktree is already absent");
  } else {
    if ((await realpath(worktreePath)) !== worktreePath)
      fail(`Worktree path is not canonical: ${worktreePath}`);
    if (git(worktreePath, ["rev-parse", "--show-toplevel"]) !== worktreePath)
      fail(`Path is not the expected Git worktree: ${worktreePath}`);
    const actualBranch = git(worktreePath, ["branch", "--show-current"]);
    if (actualBranch !== run.branch_name)
      fail(`Branch mismatch: expected ${run.branch_name}, got ${actualBranch}`);
    headSha = git(worktreePath, ["rev-parse", "HEAD"]);
    const tracked = git(worktreePath, ["diff", "--name-only", "HEAD"])
      .split("\n")
      .filter(Boolean);
    const untracked = git(worktreePath, ["ls-files", "--others", "--exclude-standard"])
      .split("\n")
      .filter(Boolean);
    changedFiles = [...new Set([...tracked, ...untracked])].sort();
    if (headSha !== run.base_sha)
      blockers.push("branch contains commits beyond the recorded base");
  }

  if (!localBranchExists) blockers.push("managed local branch is absent");
  const remote = remoteBranchState(canonicalRepository, run.branch_name);
  if (remote.error) blockers.push(remote.error);
  if (remote.exists) blockers.push("remote branch exists; published work is preserved");

  return {
    runId: run.run_id,
    eligible: blockers.length === 0,
    blockers,
    canonicalRepository,
    worktreePath,
    attemptDirectory,
    branchName: run.branch_name,
    baseSha: run.base_sha,
    headSha,
    changedFiles,
    localBranchExists,
    remoteBranchExists: remote.exists,
  };
}

async function buildPublishedPlan(
  run: RunRow,
  registry: ProjectsRegistry,
): Promise<PublishedDiscardPlan> {
  const base = await buildPlan(run, registry);
  const project = registry.projects[run.project]!;
  const blockers = base.blockers.filter(
    (blocker) =>
      blocker !== "branch contains commits beyond the recorded base" &&
      blocker !== "remote branch exists; published work is preserved",
  );
  if (base.changedFiles.length > 0)
    blockers.push("worktree contains unpublished changes");
  const remote = remoteBranchHead(base.canonicalRepository, base.branchName);
  if (remote.error) blockers.push(remote.error);
  if (!remote.sha) blockers.push("managed remote branch is absent");
  if (base.headSha && remote.sha && base.headSha !== remote.sha)
    blockers.push("local and remote branch heads do not match");

  let pullRequest: PullRequest | null = null;
  try {
    const exact = matchingPullRequests(project.repository, base.branchName).filter(
      (candidate) => candidate.headRefOid === base.headSha,
    );
    if (exact.length !== 1)
      blockers.push("exactly one pull request must match the managed branch head");
    else {
      pullRequest = exact[0]!;
      if (!pullRequest.isDraft) blockers.push("pull request is not a draft");
      if (!(["OPEN", "CLOSED"] as string[]).includes(pullRequest.state))
        blockers.push(`pull request state is ${pullRequest.state}`);
    }
  } catch (error) {
    blockers.push(
      `pull request verification failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    ...base,
    eligible: blockers.length === 0,
    blockers,
    repository: project.repository,
    remoteHeadSha: remote.sha,
    pullRequest,
  };
}

function finalizeCancellation(
  database: DatabaseSync,
  run: RunRow,
  reason: string,
  details: Record<string, unknown>,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== "needs_attention" ||
      current.stop_reason !== "cancelled" ||
      current.owner_state !== "none" ||
      current.tmux_session_name !== null ||
      current.preview_id !== null ||
      current.active_preview_lease !== 0
    ) {
      fail("Run changed before cancellation cleanup was recorded");
    }
    database
      .prepare(
        `UPDATE runs
         SET state = 'cancelled', owner_state = 'none',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ?`,
      )
      .run(run.run_id);
    database
      .prepare(
        `UPDATE run_resources
         SET resource_state = 'released',
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE run_id = ?`,
      )
      .run(run.run_id);
    database
      .prepare(
        `INSERT INTO run_state_history (
           run_id, from_state, to_state, reason, details_json
         ) VALUES (?, 'needs_attention', 'cancelled', ?, ?)`,
      )
      .run(run.run_id, reason, JSON.stringify(details));
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

async function discard(
  database: DatabaseSync,
  run: RunRow,
  plan: DiscardPlan,
): Promise<void> {
  git(plan.canonicalRepository, ["worktree", "remove", "--force", plan.worktreePath]);
  try {
    await rmdir(plan.attemptDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ENOTEMPTY")
      throw error;
  }
  if (refExists(plan.canonicalRepository, `refs/heads/${plan.branchName}`))
    git(plan.canonicalRepository, ["branch", "-D", plan.branchName]);

  finalizeCancellation(database, run, "cancelled_local_work_discarded", {
    worktreePath: plan.worktreePath,
    branchName: plan.branchName,
    baseSha: plan.baseSha,
    changedFiles: plan.changedFiles,
  });
}

async function discardPublished(
  database: DatabaseSync,
  run: RunRow,
  plan: PublishedDiscardPlan,
): Promise<void> {
  if (!plan.pullRequest) fail("Verified pull request is unavailable");
  if (plan.pullRequest.state === "OPEN") {
    execFileSync(
      "gh",
      [
        "pr",
        "close",
        String(plan.pullRequest.number),
        "--repo",
        plan.repository,
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
  }
  if (remoteBranchState(plan.canonicalRepository, plan.branchName).exists) {
    git(plan.canonicalRepository, ["push", "origin", "--delete", plan.branchName]);
  }
  const remoteAfter = remoteBranchState(plan.canonicalRepository, plan.branchName);
  if (remoteAfter.exists !== false)
    fail("Managed remote branch still exists after close operation");

  git(plan.canonicalRepository, ["worktree", "remove", plan.worktreePath]);
  try {
    await rmdir(plan.attemptDirectory);
  } catch (error) {
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" &&
      (error as NodeJS.ErrnoException).code !== "ENOTEMPTY"
    )
      throw error;
  }
  if (refExists(plan.canonicalRepository, `refs/heads/${plan.branchName}`))
    git(plan.canonicalRepository, ["branch", "-D", plan.branchName]);

  finalizeCancellation(database, run, "cancelled_published_work_discarded", {
    worktreePath: plan.worktreePath,
    branchName: plan.branchName,
    headSha: plan.headSha,
    pullRequestNumber: plan.pullRequest.number,
    pullRequestUrl: plan.pullRequest.url,
  });
}

async function main(): Promise<void> {
  const args = parseArguments();
  const registry = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects registry version");
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const run = loadRun(database, args.runId);
    const plan =
      args.command === "discard"
        ? await buildPlan(run, registry)
        : await buildPublishedPlan(run, registry);
    if (!args.apply) {
      process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
      return;
    }
    if (!plan.eligible) {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          apply: true,
          action: "preserved",
          runId: run.run_id,
          blockers: plan.blockers,
        })}\n`,
      );
      return;
    }
    if (args.command === "discard")
      await discard(database, run, plan as DiscardPlan);
    else
      await discardPublished(database, run, plan as PublishedDiscardPlan);
    process.stdout.write(
      `${JSON.stringify({
        ok: true,
        apply: true,
        action:
          args.command === "discard"
            ? "discarded_local_work"
            : "discarded_published_work",
        runId: run.run_id,
        changedFiles: plan.changedFiles,
      })}\n`,
    );
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});

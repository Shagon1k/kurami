import { execFileSync, spawnSync } from "node:child_process";
import { readFile, realpath, stat } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

type Run = {
  run_id: string;
  project: string;
  repository: string;
  issue_number: number;
  run_state: string;
  owner_state: string;
  execution_mode: "dry_run" | "live";
  resource_state: string;
  worktree_path: string | null;
  branch_name: string | null;
  tmux_session_name: string | null;
};

type Project = {
  repository: string;
  workspace: {
    worktree_root: string;
    base_branch: string;
    branch_prefix: string;
  };
};

type Registry = { version: number; projects: Record<string, Project> };
type Config = {
  version: number;
  mode: "dry_run" | "live";
  limits: { max_tmux_sessions_global: number };
};
type PullSummary = {
  number: number;
  url: string;
  title: string;
  headRefOid: string;
  headRefName: string;
  baseRefName: string;
};
type PullDetails = { base?: { sha?: string } };

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const launcherPath = resolve(import.meta.dirname, "../bin/launch-ai-review.sh");

function fail(message: string): never {
  throw new Error(message);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}

function parseArguments(): {
  runId: string;
  requestId: string;
  apply: boolean;
} {
  const args = process.argv.slice(2);
  const runId = valueAfter(args, "--run-id");
  const requestId = valueAfter(args, "--request-id");
  const known = new Set([
    "start",
    "--run-id",
    runId,
    "--request-id",
    requestId,
    "--apply",
  ]);
  if (
    args[0] !== "start" ||
    !runId ||
    !/^r_[A-Za-z0-9_]+$/u.test(runId) ||
    !requestId ||
    !/^rq_[a-f0-9]+$/u.test(requestId) ||
    args.some((arg) => !known.has(arg))
  )
    fail(
      "Usage: review-manager.ts start --run-id <run_id> --request-id <request_id> [--apply]",
    );
  return { runId, requestId, apply: args.includes("--apply") };
}

function runFile(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  }).trim();
}

function git(worktree: string, args: string[]): string {
  return runFile("git", ["-C", worktree, ...args]);
}

function gh(args: string[]): string {
  return runFile(process.env.GH_BIN?.trim() || "gh", args);
}

function tmuxExists(name: string): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", `=${name}`], {
    env: process.env,
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail("Failed to inspect tmux sessions");
}

function managedTmuxCount(): number {
  const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 1) return 0;
  if (result.status !== 0) fail(result.stderr.trim() || "Failed to list tmux sessions");
  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => /^(?:cx|rv)-[a-z0-9-]+$/u.test(value)).length;
}

function loadRun(database: DatabaseSync, runId: string): Run {
  const run = database
    .prepare(
      `SELECT r.run_id, r.project, r.repository, r.issue_number,
              r.state AS run_state, r.owner_state, r.execution_mode,
              rr.resource_state, rr.worktree_path, rr.branch_name,
              rr.tmux_session_name
       FROM runs r JOIN run_resources rr USING (run_id)
       WHERE r.run_id = ?`,
    )
    .get(runId) as Run | undefined;
  if (!run) fail(`Run not found: ${runId}`);
  return run;
}

function discoverPull(run: Run, project: Project): PullSummary & { baseSha: string } {
  const pulls = JSON.parse(
    gh([
      "pr",
      "list",
      "--repo",
      run.repository,
      "--head",
      run.branch_name!,
      "--state",
      "open",
      "--limit",
      "2",
      "--json",
      "number,url,title,headRefOid,headRefName,baseRefName",
    ]),
  ) as PullSummary[];
  if (pulls.length !== 1) fail("AI review requires exactly one open managed pull request");
  const pull = pulls[0]!;
  if (
    pull.headRefName !== run.branch_name ||
    pull.baseRefName !== project.workspace.base_branch
  )
    fail("Pull request branch or base branch does not match project configuration");
  const details = JSON.parse(
    gh(["api", `repos/${run.repository}/pulls/${pull.number}`]),
  ) as PullDetails;
  const baseSha = details.base?.sha;
  if (!baseSha || !/^[a-f0-9]{7,64}$/u.test(baseSha))
    fail("GitHub returned no valid pull request base SHA");
  return { ...pull, baseSha };
}

async function main(): Promise<void> {
  const args = parseArguments();
  const [config, registry] = (await Promise.all([
    readFile(configPath, "utf8"),
    readFile(projectsPath, "utf8"),
  ])).map((content) => parse(content)) as [Config, Registry];
  if (config.version !== 1 || registry.version !== 1) fail("Unsupported configuration version");
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  try {
    const run = loadRun(database, args.runId);
    const project = registry.projects[run.project];
    if (!project || project.repository.toLowerCase() !== run.repository.toLowerCase())
      fail("Run repository does not match project configuration");
    if (
      run.run_state !== "parked_review" ||
      run.owner_state !== "none" ||
      run.execution_mode !== "live" ||
      run.resource_state !== "provisioned" ||
      run.tmux_session_name !== null ||
      !run.worktree_path ||
      !run.branch_name
    )
      fail("Run is not in a stable AI-reviewable state");
    const request = database
      .prepare(
        `SELECT 1 FROM run_control_requests
         WHERE request_id = ? AND run_id = ? AND action = 'ai_review'
           AND request_state = 'pending'`,
      )
      .get(args.requestId, run.run_id);
    if (!request) fail("AI review request is no longer pending");
    if (
      database
        .prepare(
          `SELECT 1 FROM run_ai_reviews
           WHERE run_id = ? AND review_state = 'running'`,
        )
        .get(run.run_id)
    )
      fail("An AI review is already running");

    const worktreeRoot = resolve(project.workspace.worktree_root);
    const worktree = resolve(run.worktree_path);
    const relativePath = relative(worktreeRoot, worktree);
    if (
      !relativePath ||
      relativePath.startsWith("..") ||
      resolve(worktreeRoot, relativePath) !== worktree ||
      (await realpath(worktree)) !== worktree ||
      !(await stat(worktree)).isDirectory()
    )
      fail("Managed worktree path is invalid");
    if (git(worktree, ["status", "--porcelain"]))
      fail("AI review requires a clean managed worktree");
    const pull = discoverPull(run, project);
    const head = git(worktree, ["rev-parse", "HEAD"]);
    if (head !== pull.headRefOid)
      fail(`AI review exact SHA mismatch: worktree=${head}, pull=${pull.headRefOid}`);
    if (
      database
        .prepare(
          `SELECT 1 FROM run_ai_reviews
           WHERE run_id = ? AND head_sha = ? AND review_state = 'ready'`,
        )
        .get(run.run_id, head)
    )
      fail("This exact pull request SHA already has a ready AI review");

    const reviewNumber = Number(
      (
        database
          .prepare(
            `SELECT COUNT(*) AS count FROM run_ai_reviews WHERE run_id = ?`,
          )
          .get(run.run_id) as { count: number }
      ).count,
    ) + 1;
    const reviewId = `air_${args.requestId.replace(/^rq_/u, "")}`;
    const prefix = project.workspace.branch_prefix.toLowerCase();
    const shortRun = run.run_id.replace(/^r_/u, "").slice(0, 6).toLowerCase();
    const tmuxSessionName = `rv-${prefix}-${run.issue_number}-${shortRun}-${reviewNumber}`;
    if (!/^[a-z0-9-]+$/u.test(tmuxSessionName)) fail("Generated unsafe review session name");
    const plan = {
      reviewId,
      runId: run.run_id,
      requestId: args.requestId,
      reviewNumber,
      pullRequestNumber: pull.number,
      pullRequestUrl: pull.url,
      baseRef: pull.baseRefName,
      baseSha: pull.baseSha,
      headSha: head,
      tmuxSessionName,
      worktree,
    };
    if (!args.apply) {
      process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
      return;
    }
    if (config.mode !== "live") fail(`Refusing review mutation in mode=${config.mode}`);
    if (managedTmuxCount() >= config.limits.max_tmux_sessions_global)
      fail("Managed tmux session limit reached");
    if (tmuxExists(tmuxSessionName)) fail("Review tmux session already exists");

    database
      .prepare(
        `INSERT INTO run_ai_reviews (
           review_id, run_id, request_id, review_number, review_state,
           repository, pull_request_number, pull_request_url,
           base_ref, base_sha, head_sha, tmux_session_name
         ) VALUES (?, ?, ?, ?, 'running', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        reviewId,
        run.run_id,
        args.requestId,
        reviewNumber,
        run.repository,
        pull.number,
        pull.url,
        pull.baseRefName,
        pull.baseSha,
        head,
        tmuxSessionName,
      );
    try {
      runFile("tmux", [
        "new-session",
        "-d",
        "-s",
        tmuxSessionName,
        "-c",
        worktree,
        "-e",
        `ORCHESTRATOR_HOME=${orchestratorHome}`,
        "-e",
        `KURAMI_REVIEW_ID=${reviewId}`,
        "-e",
        `NODE_BIN=${process.execPath}`,
        launcherPath,
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      database
        .prepare(
          `UPDATE run_ai_reviews SET review_state='failed', failure_reason=?,
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
           WHERE review_id=? AND review_state='running'`,
        )
        .run(message.slice(0, 500), reviewId);
      throw error;
    }
    process.stdout.write(`${JSON.stringify({ ok: true, apply: true, action: "ai_review_started", ...plan })}\n`);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});

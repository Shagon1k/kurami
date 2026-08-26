import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

type ProjectConfig = {
  repository: string;
  workspace: {
    canonical_repository: string;
    worktree_root: string;
    base_branch: string;
    branch_prefix: string;
  };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type RunResource = {
  run_id: string;
  trigger_event_id: string;
  project: string;
  issue_number: number;
  run_state: string;
  execution_mode: "dry_run" | "live";
  resource_state: string;
  worktree_path: string | null;
  branch_name: string | null;
  base_sha: string | null;
};

type ProvisionPlan = {
  runId: string;
  project: string;
  repository: string;
  canonicalRepository: string;
  baseRef: string;
  worktreePath: string;
  branchName: string;
  executionMode: "dry_run" | "live";
};

const orchestratorHome = resolve(
  process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
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
    fail("Usage: provision-worktree.ts --run-id <run_id> [--apply]");
  }
  return { runId, apply: args.includes("--apply") };
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function gitRefExists(cwd: string, ref: string): boolean {
  const result = spawnSync("git", ["show-ref", "--verify", "--quiet", ref], {
    cwd,
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail(
    `Failed to inspect Git ref ${ref}: ${result.stderr.trim() || `exit ${result.status ?? "unknown"}`}`,
  );
}

function normalizeGitHubRepository(remote: string): string | null {
  const value = remote.trim().replace(/\.git$/u, "");
  const match = value.match(
    /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https?:\/\/github\.com\/)([^/]+\/[^/]+)$/iu,
  );
  return match?.[1] ?? null;
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

function loadRun(database: DatabaseSync, runId: string): RunResource {
  const row = database
    .prepare(`
      SELECT r.run_id, r.trigger_event_id, r.project, r.issue_number,
             r.state AS run_state, r.execution_mode,
             rr.resource_state, rr.worktree_path, rr.branch_name, rr.base_sha
      FROM runs r
      JOIN run_resources rr USING (run_id)
      WHERE r.run_id = ?
    `)
    .get(runId) as RunResource | undefined;
  if (!row) fail(`Run or resource mapping not found: ${runId}`);
  return row;
}

async function buildPlan(
  run: RunResource,
  registry: ProjectsRegistry,
): Promise<ProvisionPlan> {
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  if (!run.worktree_path || !run.branch_name) {
    fail(`Run has no planned worktree/branch mapping: ${run.run_id}`);
  }

  const canonicalRepository = resolve(project.workspace.canonical_repository);
  const worktreeRoot = resolve(project.workspace.worktree_root);
  const worktreePath = resolve(run.worktree_path);
  const relativePath = relative(worktreeRoot, worktreePath);
  if (!relativePath || relativePath.startsWith("..") || resolve(worktreeRoot, relativePath) !== worktreePath) {
    fail(`Worktree path escapes configured root: ${worktreePath}`);
  }
  if (!(await pathExists(canonicalRepository))) {
    fail(`Canonical repository does not exist: ${canonicalRepository}`);
  }
  if (git(canonicalRepository, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    fail(`Canonical repository is not a Git worktree: ${canonicalRepository}`);
  }

  const remote = git(canonicalRepository, ["remote", "get-url", "origin"]);
  const actualRepository = normalizeGitHubRepository(remote);
  if (actualRepository?.toLowerCase() !== project.repository.toLowerCase()) {
    fail(
      `Origin repository mismatch: expected ${project.repository}, got ${actualRepository ?? "unsupported remote"}`,
    );
  }

  return {
    runId: run.run_id,
    project: run.project,
    repository: project.repository,
    canonicalRepository,
    baseRef: `origin/${project.workspace.base_branch}`,
    worktreePath,
    branchName: run.branch_name,
    executionMode: run.execution_mode,
  };
}

function claimProvisioning(database: DatabaseSync, run: RunResource): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== "admission_pending" ||
      current.resource_state !== "planned"
    ) {
      fail(
        `Run is not claimable: state=${current.run_state}, resource=${current.resource_state}`,
      );
    }
    database
      .prepare(`
        UPDATE runs
        SET state = 'starting', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'provisioning',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(run.run_id);
    appendHistory(
      database,
      run.run_id,
      "admission_pending",
      "starting",
      "worktree_provisioning_started",
      { resourceState: "provisioning" },
    );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordProvisioned(
  database: DatabaseSync,
  run: RunResource,
  baseSha: string,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'provisioned', base_sha = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND resource_state = 'provisioning'
      `)
      .run(baseSha, run.run_id);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function recordFailure(database: DatabaseSync, run: RunResource, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    database
      .prepare(`
        UPDATE runs
        SET state = 'needs_attention',
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
      "worktree_provisioning_failed",
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

async function main(): Promise<void> {
  const { runId, apply } = parseArguments();
  const registry = parse(await readFile(projectsPath, "utf8")) as ProjectsRegistry;
  if (registry.version !== 1) fail("Unsupported projects registry version");

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const run = loadRun(database, runId);
    const plan = await buildPlan(run, registry);

    if (!apply) {
      process.stdout.write(`${JSON.stringify({ ok: true, apply: false, plan })}\n`);
      return;
    }
    if (run.execution_mode !== "live") {
      fail(`Refusing mutation for execution_mode=${run.execution_mode}`);
    }
    if (await pathExists(plan.worktreePath)) {
      fail(`Worktree path already exists: ${plan.worktreePath}`);
    }
    if (
      gitRefExists(
        plan.canonicalRepository,
        `refs/heads/${plan.branchName}`,
      )
    ) {
      fail(`Local branch already exists: ${plan.branchName}`);
    }

    claimProvisioning(database, run);
    try {
      const project = registry.projects[run.project];
      await mkdir(dirname(plan.worktreePath), {
        recursive: true,
        mode: 0o700,
      });
      git(plan.canonicalRepository, [
        "fetch",
        "--prune",
        "origin",
        project.workspace.base_branch,
      ]);
      const baseSha = git(plan.canonicalRepository, ["rev-parse", plan.baseRef]);
      git(plan.canonicalRepository, [
        "worktree",
        "add",
        "-b",
        plan.branchName,
        plan.worktreePath,
        baseSha,
      ]);
      recordProvisioned(database, run, baseSha);
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, ...plan, baseSha })}\n`,
      );
    } catch (error) {
      recordFailure(database, run, error);
      throw error;
    }
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});

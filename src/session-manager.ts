import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { findAndNameThread } from "./codex-app-server.ts";

process.umask(0o077);

type Action =
  | "start"
  | "sync"
  | "inspect"
  | "park"
  | "handoff"
  | "finalize-stop";

type Arguments = {
  action: Action;
  runId: string;
  apply: boolean;
};

type OrchestratorConfig = {
  version: number;
  mode: "dry_run" | "live";
  limits: {
    max_tmux_sessions_global: number;
  };
};

type ProjectConfig = {
  repository: string;
  workspace: {
    canonical_repository: string;
    worktree_root: string;
    branch_prefix: string;
  };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type SessionRun = {
  run_id: string;
  project: string;
  repository: string;
  issue_number: number;
  issue_title: string | null;
  issue_url: string | null;
  interaction_policy: "autonomous" | "human_control";
  run_state: string;
  owner_state: string;
  execution_mode: "dry_run" | "live";
  resource_state: string;
  worktree_path: string | null;
  branch_name: string | null;
  base_sha: string | null;
  tmux_session_name: string | null;
  codex_thread_id: string | null;
};

type StartPlan = {
  runId: string;
  project: string;
  repository: string;
  issueNumber: number;
  worktreePath: string;
  branchName: string;
  tmuxSessionName: string;
  launcherPath: string;
  codexBin: string;
  codexTitle: string;
  initialPrompt: string;
};

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const launcherPath = resolve(
  import.meta.dirname,
  "../bin/launch-codex-session.sh",
);

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): Arguments {
  const args = process.argv.slice(2);
  const action = args[0] as Action | undefined;
  const runIndex = args.indexOf("--run-id");
  const runId = runIndex >= 0 ? args[runIndex + 1]?.trim() : undefined;
  const known = new Set([action, "--run-id", runId, "--apply"]);
  const unknown = args.filter((arg) => !known.has(arg));

  if (
    (action !== "start" &&
      action !== "sync" &&
      action !== "inspect" &&
      action !== "park" &&
      action !== "handoff" &&
      action !== "finalize-stop") ||
    !runId ||
    unknown.length > 0 ||
    (action === "inspect" && args.includes("--apply"))
  ) {
    fail(
      "Usage: session-manager.ts <start|sync|inspect|park|handoff|finalize-stop> --run-id <run_id> [--apply]",
    );
  }
  return { action, runId, apply: args.includes("--apply") };
}

function loadRun(database: DatabaseSync, runId: string): SessionRun {
  const row = database
    .prepare(
      `
      SELECT r.run_id, r.project, r.repository, r.issue_number,
             pe.title AS issue_title, pe.url AS issue_url,
             r.interaction_policy, r.state AS run_state,
             r.owner_state, r.execution_mode,
             rr.resource_state, rr.worktree_path, rr.branch_name, rr.base_sha,
             rr.tmux_session_name, rr.codex_thread_id
      FROM runs r
      JOIN run_resources rr USING (run_id)
      JOIN project_events pe ON pe.event_id = r.trigger_event_id
      WHERE r.run_id = ?
    `,
    )
    .get(runId) as SessionRun | undefined;
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
    .prepare(
      `
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, details_json
      ) VALUES (?, ?, ?, ?, ?)
    `,
    )
    .run(runId, fromState, toState, reason, JSON.stringify(details));
}

function runFile(command: string, args: string[]): string {
  return execFileSync(command, args, {
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

function tmuxSessionExists(name: string): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", `=${name}`], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail(result.stderr.trim() || "Failed to inspect tmux session");
}

function managedTmuxSessionCount(): number {
  const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 1) return 0;
  if (result.status !== 0) {
    fail(result.stderr.trim() || "Failed to list tmux sessions");
  }
  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("cx-")).length;
}

function git(worktreePath: string, args: string[]): string {
  return runFile("git", ["-C", worktreePath, ...args]);
}

function gitIsAncestor(worktreePath: string, ancestor: string): boolean {
  const result = spawnSync(
    "git",
    ["-C", worktreePath, "merge-base", "--is-ancestor", ancestor, "HEAD"],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail(result.stderr.trim() || "Failed to validate recorded base SHA");
}

function sessionName(run: SessionRun, project: ProjectConfig): string {
  const prefix = project.workspace.branch_prefix.toLowerCase();
  const shortRunId = run.run_id.replace(/^r_/u, "").slice(0, 6).toLowerCase();
  const value = `cx-${prefix}-${run.issue_number}-${shortRunId}`;
  if (!/^[a-z0-9-]+$/u.test(value)) fail("Generated unsafe tmux session name");
  return value;
}

function cleanIssueTitle(title: string | null): string {
  const cleaned = title?.replace(/^\s*\[[^\]]+\]\s*:\s*/u, "").trim();
  return cleaned || `Issue ${title ?? "task"}`;
}

function codexTitle(run: SessionRun, project: ProjectConfig): string {
  return `[${project.workspace.branch_prefix}-${run.issue_number}]: ${cleanIssueTitle(run.issue_title)}`;
}

function initialPrompt(run: SessionRun): string {
  const policy =
    run.interaction_policy === "human_control"
      ? "Human-control: inspect and prepare, then stop before modifying files or external state until Alex explicitly approves the implementation."
      : "Autonomous: after the read-only preparation, proceed within repository instructions and the issue scope; stop for dramatic or destructive changes, merge, production deployment, secrets, billing, or permission changes.";
  return [
    `Initialize the engineering run for ${run.repository} issue #${run.issue_number}.`,
    run.issue_url ? `Issue: ${run.issue_url}` : "",
    `Run ID: ${run.run_id}. Interaction policy: ${run.interaction_policy}.`,
    "Read the GitHub issue, applicable AGENTS.md files, and relevant repository documentation. Confirm the repository, working directory, branch, issue scope, acceptance criteria, and verification plan.",
    "GH_TOKEN is already injected by the managed launcher. A GitHub CLI authentication or credential error observed inside the Codex sandbox is inconclusive when network access or DNS may be restricted. Do not run `gh auth login`, replace credentials, or modify authentication configuration. For an important safe read-only check or an already-authorized GitHub operation, retry with narrowly scoped escalated network permission, and distinguish network reachability, credential validity, and authorization scopes.",
    policy,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function validateAndPlan(
  run: SessionRun,
  registry: ProjectsRegistry,
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
    branchName: run.branch_name,
    tmuxSessionName: run.tmux_session_name ?? sessionName(run, project),
    launcherPath,
    codexBin,
    codexTitle: codexTitle(run, project),
    initialPrompt: initialPrompt(run),
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
    if (
      current.run_state !== "starting" ||
      current.owner_state !== "none" ||
      current.resource_state !== "provisioned" ||
      current.tmux_session_name !== null
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
    database
      .prepare(
        `
        UPDATE run_resources
        SET tmux_session_name = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND tmux_session_name IS NULL
      `,
      )
      .run(plan.tmuxSessionName, run.run_id);
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
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      "needs_attention",
      "codex_tmux_start_failed",
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

async function startSession(
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
  if (run.run_state !== "starting" || run.resource_state !== "provisioned") {
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

  claimSession(database, run, plan, config.limits.max_tmux_sessions_global);
  try {
    runFile("tmux", [
      "new-session",
      "-d",
      "-s",
      plan.tmuxSessionName,
      "-c",
      plan.worktreePath,
      "-e",
      `ORCHESTRATOR_HOME=${orchestratorHome}`,
      "-e",
      `HERMES_RUN_ID=${run.run_id}`,
      "-e",
      `HERMES_REPOSITORY=${run.repository}`,
      "-e",
      `HERMES_ISSUE_NUMBER=${run.issue_number}`,
      "-e",
      `HERMES_WORKTREE_PATH=${plan.worktreePath}`,
      "-e",
      `HERMES_INITIAL_PROMPT_B64=${Buffer.from(plan.initialPrompt, "utf8").toString("base64")}`,
      "-e",
      `CODEX_BIN=${plan.codexBin}`,
      plan.launcherPath,
    ]);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
    if (!tmuxSessionExists(plan.tmuxSessionName)) {
      fail(`tmux session exited during startup: ${plan.tmuxSessionName}`);
    }
  } catch (error) {
    recordStartFailure(database, run, plan, error);
    throw error;
  }

  recordStarted(database, run, plan);
  process.stdout.write(
    `${JSON.stringify({ ok: true, apply: true, action: "started", ...plan, ownerState: "cli", runState: "running" })}\n`,
  );
}

function capturePane(sessionNameValue: string): string {
  return runFile("tmux", [
    "capture-pane",
    "-p",
    "-J",
    "-t",
    `${sessionNameValue}:0.0`,
    "-S",
    "-200",
  ]);
}

function sendTmuxKeys(sessionNameValue: string, keys: string[]): void {
  runFile("tmux", ["send-keys", "-t", `${sessionNameValue}:0.0`, ...keys]);
}

async function syncSession(
  database: DatabaseSync,
  run: SessionRun,
  registry: ProjectsRegistry,
  apply: boolean,
): Promise<void> {
  const project = registry.projects[run.project];
  if (!project) fail(`Unknown project in run: ${run.project}`);
  if (!run.tmux_session_name || !tmuxSessionExists(run.tmux_session_name)) {
    fail(`Managed tmux session is not alive for run: ${run.run_id}`);
  }
  const title = codexTitle(run, project);
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
      !["starting", "running"].includes(current.run_state) ||
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
        SET state = 'running', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(run.run_id);
    database
      .prepare(
        `
        UPDATE run_resources
        SET codex_thread_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(threadId, run.run_id);
    appendHistory(
      database,
      run.run_id,
      current.run_state,
      "running",
      "codex_thread_synchronized",
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

async function leaveCliSession(
  database: DatabaseSync,
  run: SessionRun,
  apply: boolean,
  targetOwner: "none" | "remote",
): Promise<void> {
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
  if (
    !["running", "parked_review", "stopping"].includes(run.run_state) ||
    run.owner_state !== "cli"
  ) {
    fail(
      `Run is not CLI-owned and handoff-ready: state=${run.run_state}, owner=${run.owner_state}`,
    );
  }
  if (!run.codex_thread_id) fail(`Run has no synchronized Codex thread ID`);
  const tmuxAlive = run.tmux_session_name
    ? tmuxSessionExists(run.tmux_session_name)
    : false;
  const transcript =
    tmuxAlive && run.tmux_session_name
      ? capturePane(run.tmux_session_name)
      : "";
  const tail = transcript.slice(-1_500);
  const waitingOnApproval =
    /Would you like to run|Requested permission|Press enter to confirm|Allow .+\?/iu.test(
      tail,
    );
  const busy = /Working \(|esc to interrupt|Booting MCP server/iu.test(
    transcript.slice(-700),
  );
  const tailDirectory = resolve(orchestratorHome, "logs/session-handoffs");
  const tailPath = resolve(tailDirectory, `${run.run_id}.txt`);
  const targetState =
    targetOwner === "remote" && run.run_state === "running"
      ? "remote_owned"
      : run.run_state;
  const plan = {
    runId: run.run_id,
    fromState: run.run_state,
    toState: targetState,
    fromOwner: run.owner_state,
    toOwner: targetOwner,
    tmuxSessionName: run.tmux_session_name,
    tmuxAlive,
    codexThreadId: run.codex_thread_id,
    busy,
    waitingOnApproval,
    tailPath,
  };
  if (waitingOnApproval)
    fail(`Codex is waiting for approval; resolve it before handoff`);
  if (busy) fail(`Codex turn is still active; handoff is not safe yet`);
  if (!apply) {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, plan })}\n`,
    );
    return;
  }
  if (run.execution_mode !== "live") {
    fail(`Refusing handoff for execution_mode=${run.execution_mode}`);
  }

  await mkdir(tailDirectory, { recursive: true, mode: 0o700 });
  await writeFile(tailPath, `${transcript}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });

  if (tmuxAlive && run.tmux_session_name) {
    sendTmuxKeys(run.tmux_session_name, ["C-u"]);
    sendTmuxKeys(run.tmux_session_name, ["C-d"]);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      if (!tmuxSessionExists(run.tmux_session_name)) break;
      if (attempt === 11 || attempt === 23) {
        sendTmuxKeys(run.tmux_session_name, ["C-d"]);
      }
    }
    if (tmuxSessionExists(run.tmux_session_name)) {
      fail(`Codex/tmux did not exit within the bounded handoff window`);
    }
  }

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadRun(database, run.run_id);
    if (
      current.run_state !== run.run_state ||
      current.owner_state !== "cli" ||
      current.tmux_session_name !== run.tmux_session_name
    ) {
      fail(
        `Run changed during handoff: state=${current.run_state}, owner=${current.owner_state}, tmux=${current.tmux_session_name ?? "none"}`,
      );
    }
    database
      .prepare(
        `
        UPDATE runs
        SET state = ?, owner_state = ?,
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `,
      )
      .run(plan.toState, targetOwner, run.run_id);
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
      plan.toState,
      targetOwner === "remote"
        ? "codex_cli_handoff_completed"
        : "codex_cli_park_completed",
      {
        codexThreadId: run.codex_thread_id,
        previousTmuxSessionName: run.tmux_session_name,
        terminalTailPath: tailPath,
        recoveredAfterTmuxExit: !tmuxAlive,
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

async function finalizeStop(
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

async function main(): Promise<void> {
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

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (args.action === "inspect") {
      inspectSession(database, args.runId);
      return;
    }
    const run = loadRun(database, args.runId);
    if (args.action === "sync") {
      await syncSession(database, run, registry, args.apply);
      return;
    }
    if (args.action === "park") {
      await leaveCliSession(database, run, args.apply, "none");
      return;
    }
    if (args.action === "handoff") {
      await leaveCliSession(database, run, args.apply, "remote");
      return;
    }
    if (args.action === "finalize-stop") {
      await finalizeStop(database, run, registry, args.apply);
      return;
    }
    const plan = await validateAndPlan(run, registry);
    await startSession(database, run, plan, config, args.apply);
  } finally {
    database.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});

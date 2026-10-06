import { execFileSync, spawnSync } from "node:child_process";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import type { SessionRun } from "./session-types.ts";

export const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../../.."),
);
export const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
export const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");
export const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
export const launcherPath = resolve(
  import.meta.dirname,
  "../../../../bin/launch-codex-session.sh",
);
/** Development work runs through this wrapper: kurami-dev.slice limits and low priority (dev-resources.ts). */
export const devRunPath = resolve(import.meta.dirname, "../../../../bin/kurami-dev-run");

export function fail(message: string): never {
  throw new Error(message);
}

export function loadRun(database: DatabaseSync, runId: string): SessionRun {
  const row = database
    .prepare(
      `
      SELECT r.run_id, r.project, r.repository, r.issue_number,
             pe.title AS issue_title, pe.url AS issue_url,
             r.interaction_policy, r.state AS run_state, r.stop_reason,
             r.owner_state, r.execution_mode,
             rr.resource_state, rr.worktree_path, rr.branch_name, rr.base_sha,
             rr.tmux_session_name, rr.codex_thread_id,
             rr.previous_codex_thread_id,
             pi.status AS project_item_status,
             EXISTS (
               SELECT 1 FROM run_autonomous_successions successor_active
               WHERE successor_active.run_id = r.run_id
                 AND successor_active.succession_state IN ('starting','running')
             ) AS autonomous_successor_active
      FROM runs r
      JOIN run_resources rr USING (run_id)
      JOIN project_events pe ON pe.event_id = r.trigger_event_id
      LEFT JOIN project_items pi
        ON pi.project = r.project AND pi.item_id = r.item_id
      WHERE r.run_id = ?
    `,
    )
    .get(runId) as SessionRun | undefined;
  if (!row) fail(`Run or resource mapping not found: ${runId}`);
  return row;
}

export function appendHistory(
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

export function runFile(command: string, args: string[]): string {
  return execFileSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export function gitRefExists(repositoryPath: string, ref: string): boolean {
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

export function tmuxSessionExists(name: string): boolean {
  const result = spawnSync("tmux", ["has-session", "-t", `=${name}`], {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  fail(result.stderr.trim() || "Failed to inspect tmux session");
}

export function managedTmuxSessionCount(): number {
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
    .filter((value) => /^(?:cx|rv)-[a-z0-9-]+$/u.test(value)).length;
}

export function git(worktreePath: string, args: string[]): string {
  return runFile("git", ["-C", worktreePath, ...args]);
}

export function gitIsAncestor(worktreePath: string, ancestor: string): boolean {
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

export function capturePane(sessionNameValue: string): string {
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

export function sendTmuxKeys(sessionNameValue: string, keys: string[]): void {
  runFile("tmux", ["send-keys", "-t", `${sessionNameValue}:0.0`, ...keys]);
}

export function sendTmuxLiteral(sessionNameValue: string, value: string): void {
  runFile("tmux", [
    "send-keys",
    "-t",
    `${sessionNameValue}:0.0`,
    "-l",
    "--",
    value,
  ]);
}

export function killTmuxSession(sessionNameValue: string): void {
  if (!/^cx-[a-z0-9-]+$/u.test(sessionNameValue)) {
    fail(`Refusing to kill an unsafe tmux session name: ${sessionNameValue}`);
  }
  const result = spawnSync(
    "tmux",
    ["kill-session", "-t", `=${sessionNameValue}`],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status !== 0 && tmuxSessionExists(sessionNameValue)) {
    fail(result.stderr.trim() || `Failed to stop tmux session: ${sessionNameValue}`);
  }
}

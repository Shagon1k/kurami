import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

type Action = "take_control" | "preview_start" | "preview_stop" | "stop";
type Command = "status" | "request" | "controls";
type RequestSource = "telegram" | "discord" | "cli";

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");

type ProjectsRegistry = {
  projects: Record<string, { preview?: Record<string, unknown> }>;
};

function projectSupportsPreview(project: string): boolean {
  const registry = parse(
    readFileSync(projectsPath, "utf8"),
  ) as ProjectsRegistry;
  return Boolean(registry.projects?.[project]?.preview);
}

function fail(message: string): never {
  throw new Error(message);
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1]?.trim() : undefined;
}

function parseArguments(): {
  command: Command;
  runId?: string;
  action?: Action;
  via: RequestSource;
  project?: string;
  issue?: number;
  discordThreadId?: string;
  apply: boolean;
} {
  const args = process.argv.slice(2);
  const command = args[0] as Command | undefined;
  const runId = valueAfter(args, "--run-id");
  const action = valueAfter(args, "--action") as Action | undefined;
  const via = (valueAfter(args, "--via") ?? "cli") as RequestSource;
  const project = valueAfter(args, "--project");
  const issueValue = valueAfter(args, "--issue");
  const issue = issueValue ? Number(issueValue) : undefined;
  const discordThreadId = valueAfter(args, "--discord-thread-id");
  const apply = args.includes("--apply");
  if (!command || !["status", "request", "controls"].includes(command)) {
    fail(
      "Usage: run-controls.ts <status|request|controls> [--run-id <run_id>] [--action <take_control|preview_start|preview_stop|stop>] [--via <telegram|discord|cli>] [--project <project>] [--issue <number>] [--discord-thread-id <id>] [--apply]",
    );
  }
  if (command !== "controls" && !runId) fail(`${command} requires --run-id`);
  if (runId && !/^r_[a-zA-Z0-9_]+$/u.test(runId)) fail("Invalid run ID");
  if (command === "status" && (action || apply || args.includes("--via"))) {
    fail("status accepts only --run-id");
  }
  if (
    command === "request" &&
    (!action ||
      !["take_control", "preview_start", "preview_stop", "stop"].includes(
        action,
      ))
  ) {
    fail("request requires a supported --action");
  }
  if (!(["telegram", "discord", "cli"] as string[]).includes(via))
    fail("Unsupported request source");
  if (command === "controls") {
    if (runId || action || apply || args.includes("--via"))
      fail("controls accepts only --project, --issue, or --discord-thread-id");
    if (project && !/^[a-z0-9_-]+$/u.test(project)) fail("Invalid project");
    if (issue !== undefined && (!Number.isInteger(issue) || issue <= 0))
      fail("Invalid issue number");
    if (discordThreadId && !/^\d+$/u.test(discordThreadId))
      fail("Invalid Discord thread ID");
  } else if (project || issue !== undefined || discordThreadId) {
    fail(`${command} does not accept controls lookup filters`);
  }
  return {
    command,
    runId,
    action,
    via,
    project,
    issue,
    discordThreadId,
    apply,
  };
}

function status(
  database: DatabaseSync,
  runId: string,
): Record<string, unknown> {
  const run = database
    .prepare(
      `
    SELECT r.run_id, r.project, r.repository, r.issue_number,
           pe.title, pe.url AS issue_url, r.interaction_policy,
           r.state, r.owner_state, r.stop_reason,
           rr.resource_state, rr.branch_name, rr.worktree_path,
           rr.codex_thread_id, rr.tmux_session_name, rr.preview_id,
           ps.hostname AS preview_hostname,
           pl.state AS preview_state
    FROM runs r
    JOIN run_resources rr USING (run_id)
    JOIN project_events pe ON pe.event_id = r.trigger_event_id
    LEFT JOIN preview_leases pl
      ON pl.run_id = r.run_id AND pl.state <> 'released'
    LEFT JOIN preview_slots ps USING (slot_number)
    WHERE r.run_id = ?
  `,
    )
    .get(runId) as Record<string, unknown> | undefined;
  if (!run) fail(`Run not found: ${runId}`);
  const requests = database
    .prepare(
      `
    SELECT request_id, action, request_state, requested_via, result_json,
           created_at, completed_at
    FROM run_control_requests
    WHERE run_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `,
    )
    .all(runId);
  return {
    ...run,
    preview_url: run.preview_hostname
      ? `https://${String(run.preview_hostname)}`
      : null,
    requests,
  };
}

function request(
  database: DatabaseSync,
  runId: string,
  action: Action,
  via: RequestSource,
  apply: boolean,
): Record<string, unknown> {
  database.exec("BEGIN IMMEDIATE");
  try {
    const run = database
      .prepare(
        `
      SELECT project, state, owner_state FROM runs WHERE run_id = ?
    `,
      )
      .get(runId) as
      | { project: string; state: string; owner_state: string }
      | undefined;
    if (!run) fail(`Run not found: ${runId}`);
    if (["rejected", "cancelled", "archived"].includes(run.state)) {
      fail(`Run is terminal: ${run.state}`);
    }
    if (
      ["preview_start", "preview_stop"].includes(action) &&
      !projectSupportsPreview(run.project)
    ) {
      fail(`Preview is not configured for project: ${run.project}`);
    }
    if (
      action === "preview_start" &&
      !(
        run.owner_state === "none" &&
        ["parked_review", "waiting_human"].includes(run.state)
      )
    ) {
      fail(
        "Preview can start only after autonomous work reaches a stable review state",
      );
    }
    const existing = database
      .prepare(
        `
      SELECT request_id, request_state
      FROM run_control_requests
      WHERE run_id = ? AND action = ?
        AND request_state IN ('pending', 'processing')
      ORDER BY created_at DESC LIMIT 1
    `,
      )
      .get(runId, action) as
      | { request_id: string; request_state: string }
      | undefined;
    if (existing) {
      database.exec("COMMIT");
      return {
        action: "existing",
        runId,
        requestedAction: action,
        ...existing,
      };
    }

    const idempotencyKey = `${via}:${runId}:${action}:${randomUUID()}`;
    const plan = {
      requestId: `rq_${randomUUID().replaceAll("-", "")}`,
      runId,
      requestedAction: action,
      via,
      idempotencyKey,
    };
    if (!apply) {
      database.exec("ROLLBACK");
      return { action: "create", ...plan };
    }
    database
      .prepare(
        `
      INSERT INTO run_control_requests (
        request_id, run_id, action, requested_via, idempotency_key
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO NOTHING
    `,
      )
      .run(plan.requestId, runId, action, via, idempotencyKey);
    const stored = database
      .prepare(
        `
      SELECT request_id, request_state FROM run_control_requests
      WHERE idempotency_key = ?
    `,
      )
      .get(idempotencyKey) as { request_id: string; request_state: string };
    database.exec("COMMIT");
    return {
      action: stored.request_id === plan.requestId ? "created" : "existing",
      runId,
      requestedAction: action,
      requestId: stored.request_id,
      requestState: stored.request_state,
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function controls(
  database: DatabaseSync,
  filters: {
    project?: string;
    issue?: number;
    discordThreadId?: string;
  },
): Record<string, unknown> {
  const conditions = [
    "r.state NOT IN ('rejected', 'cancelled', 'archived', 'failed')",
  ];
  const parameters: Array<string | number> = [];
  if (filters.project) {
    conditions.push("r.project = ?");
    parameters.push(filters.project);
  }
  if (filters.issue !== undefined) {
    conditions.push("r.issue_number = ?");
    parameters.push(filters.issue);
  }
  if (filters.discordThreadId) {
    conditions.push("ds.thread_id = ?");
    parameters.push(filters.discordThreadId);
  }
  const rows = database
    .prepare(
      `
      SELECT r.run_id
      FROM runs r
      LEFT JOIN run_discord_surfaces ds USING (run_id)
      WHERE ${conditions.join(" AND ")}
      ORDER BY r.created_at DESC, r.run_id DESC
      LIMIT 2
    `,
    )
    .all(...parameters) as Array<{ run_id: string }>;
  if (rows.length === 0)
    fail("No eligible nonterminal run matches the filters");
  if (rows.length > 1)
    fail(
      "Multiple eligible runs match; provide project, issue, or Discord thread",
    );
  const selected = status(database, rows[0]!.run_id);
  const runState = String(selected.state);
  const ownerState = String(selected.owner_state);
  const threadReady = Boolean(selected.codex_thread_id);
  const previewState = selected.preview_state
    ? String(selected.preview_state)
    : null;
  const availableActions = ["status"];
  if (
    threadReady &&
    (ownerState === "cli" ||
      (ownerState === "none" &&
        ["parked_review", "waiting_human"].includes(runState)))
  )
    availableActions.push("take_control");
  if (projectSupportsPreview(String(selected.project))) {
    if (previewState) availableActions.push("preview_stop");
    else if (
      ownerState === "none" &&
      ["parked_review", "waiting_human"].includes(runState)
    )
      availableActions.push("preview_start");
  }
  availableActions.push("stop");
  return { ...selected, available_actions: availableActions };
}

function main(): void {
  const args = parseArguments();
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    const result =
      args.command === "status"
        ? status(database, args.runId!)
        : args.command === "controls"
          ? controls(database, {
              project: args.project,
              issue: args.issue,
              discordThreadId: args.discordThreadId,
            })
          : request(database, args.runId!, args.action!, args.via, args.apply);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } finally {
    database.close();
  }
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
}

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

process.umask(0o077);

type OrchestratorConfig = {
  version: number;
  mode: "dry_run" | "live";
  limits: { max_llm_running_global: number };
};

type RunRow = {
  run_id: string;
  project: string;
  issue_number: number;
  interaction_policy: "autonomous" | "human_control";
  run_state: string;
  owner_state: string;
  resource_state: string;
  tmux_session_name: string | null;
  codex_thread_id: string | null;
  preview_id: string | null;
  preview_lease_id: string | null;
  preview_lease_state: string | null;
};

type RequestRow = RunRow & {
  request_id: string;
  requested_action: "take_control" | "preview_start" | "preview_stop" | "stop";
};

type ControllerAction =
  | "provision"
  | "start"
  | "sync"
  | "park"
  | "handoff"
  | "claim_remote"
  | "preview_allocate"
  | "preview_up"
  | "preview_down"
  | "request_stop"
  | "request_complete"
  | "request_reject"
  | "release";

type PlannedAction = {
  action: ControllerAction;
  runId: string;
  project: string;
  issueNumber: number;
  requestId?: string;
  command?: string;
  reason?: string;
};

type ProgressRow = RunRow & {
  title: string | null;
};

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");
const provisionerPath = resolve(import.meta.dirname, "provision-worktree.ts");
const sessionManagerPath = resolve(import.meta.dirname, "session-manager.ts");
const releaserPath = resolve(import.meta.dirname, "release-worktree.ts");
const previewManagerPath = resolve(import.meta.dirname, "preview-manager.ts");
const previewRuntimePath = resolve(import.meta.dirname, "preview-runtime.ts");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): { apply: boolean } {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) {
    fail("Usage: controller.ts [--apply]");
  }
  return { apply: args.includes("--apply") };
}

function baseRunSelect(): string {
  return `
    SELECT r.run_id, r.project, r.issue_number, r.interaction_policy,
           r.state AS run_state, r.owner_state,
           rr.resource_state, rr.tmux_session_name, rr.codex_thread_id,
           rr.preview_id, pl.lease_id AS preview_lease_id,
           pl.state AS preview_lease_state
    FROM runs r
    JOIN run_resources rr USING (run_id)
    LEFT JOIN preview_leases pl
      ON pl.run_id = r.run_id AND pl.state <> 'released'
  `;
}

function runningLlmCount(database: DatabaseSync): number {
  return Number(
    (
      database
        .prepare(
          `
      SELECT COUNT(*) AS count FROM runs
      WHERE owner_state = 'cli'
        AND state IN ('starting', 'running', 'handoff_pending', 'parked_review', 'stopping')
    `,
        )
        .get() as { count: number }
    ).count,
  );
}

function externalCommand(
  action: ControllerAction,
  runId: string,
): string[] | null {
  switch (action) {
    case "provision":
      return [provisionerPath, "--run-id", runId, "--apply"];
    case "start":
      return [sessionManagerPath, "start", "--run-id", runId, "--apply"];
    case "sync":
      return [sessionManagerPath, "sync", "--run-id", runId, "--apply"];
    case "park":
      return [sessionManagerPath, "park", "--run-id", runId, "--apply"];
    case "handoff":
      return [sessionManagerPath, "handoff", "--run-id", runId, "--apply"];
    case "preview_allocate":
      return [previewManagerPath, "allocate", "--run-id", runId, "--apply"];
    case "preview_up":
      return [previewRuntimePath, "up", "--run-id", runId, "--apply"];
    case "preview_down":
      return [previewRuntimePath, "down", "--run-id", runId, "--apply"];
    case "release":
      return [releaserPath, "--run-id", runId, "--apply"];
    default:
      return null;
  }
}

function planForRequest(request: RequestRow): PlannedAction {
  const base = {
    runId: request.run_id,
    project: request.project,
    issueNumber: request.issue_number,
    requestId: request.request_id,
  };
  switch (request.requested_action) {
    case "take_control":
      if (request.owner_state === "remote") {
        return {
          ...base,
          action: "request_complete",
          reason: "already_remote_owned",
        };
      }
      if (!request.codex_thread_id) {
        return {
          ...base,
          action: "request_reject",
          reason: "codex_thread_not_ready",
        };
      }
      if (request.owner_state === "cli" && request.tmux_session_name) {
        return { ...base, action: "handoff" };
      }
      if (
        request.owner_state === "none" &&
        request.tmux_session_name === null &&
        ["parked_review", "waiting_human"].includes(request.run_state)
      ) {
        return { ...base, action: "claim_remote" };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "run_not_takeover_eligible",
      };

    case "preview_start":
      if (
        !["running", "remote_owned", "parked_review", "waiting_human"].includes(
          request.run_state,
        )
      ) {
        return {
          ...base,
          action: "request_reject",
          reason: "run_not_preview_eligible",
        };
      }
      if (!request.preview_lease_id && request.preview_id === null) {
        return { ...base, action: "preview_allocate" };
      }
      if (request.preview_lease_state === "leased") {
        return { ...base, action: "preview_up" };
      }
      if (request.preview_lease_state === "running") {
        return {
          ...base,
          action: "request_complete",
          reason: "preview_already_running",
        };
      }
      return {
        ...base,
        action: "request_reject",
        reason: "preview_in_transitional_state",
      };

    case "preview_stop":
      if (!request.preview_lease_id) {
        return {
          ...base,
          action: "request_complete",
          reason: "preview_already_absent",
        };
      }
      return { ...base, action: "preview_down" };

    case "stop":
      return { ...base, action: "request_stop" };
  }
}

function planAutomatic(run: RunRow): PlannedAction | null {
  const base = {
    runId: run.run_id,
    project: run.project,
    issueNumber: run.issue_number,
  };
  if (
    run.run_state === "admission_pending" &&
    run.resource_state === "planned"
  ) {
    return { ...base, action: "provision" };
  }
  if (
    run.run_state === "starting" &&
    run.owner_state === "none" &&
    run.resource_state === "provisioned" &&
    !run.tmux_session_name
  ) {
    return { ...base, action: "start" };
  }
  if (
    run.run_state === "running" &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    !run.codex_thread_id
  ) {
    return { ...base, action: "sync" };
  }
  if (
    run.run_state === "running" &&
    run.interaction_policy === "human_control" &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id
  ) {
    return { ...base, action: "handoff" };
  }
  if (
    run.run_state === "parked_review" &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id
  ) {
    return { ...base, action: "park" };
  }
  if (
    run.run_state === "stopping" &&
    run.owner_state === "cli" &&
    run.tmux_session_name &&
    run.codex_thread_id
  ) {
    return { ...base, action: "park" };
  }
  if (
    run.run_state === "stopping" &&
    run.tmux_session_name === null &&
    run.preview_lease_id
  ) {
    return { ...base, action: "preview_down" };
  }
  if (
    run.run_state === "stopping" &&
    run.tmux_session_name === null &&
    !run.preview_lease_id &&
    ["provisioned", "partial", "releasing"].includes(run.resource_state)
  ) {
    return { ...base, action: "release" };
  }
  return null;
}

function buildPlans(database: DatabaseSync): PlannedAction[] {
  const requests = database
    .prepare(
      `
    SELECT base.*, q.request_id, q.action AS requested_action
    FROM (${baseRunSelect()}) AS base
    JOIN run_control_requests q ON q.run_id = base.run_id
    WHERE q.request_state = 'pending'
    ORDER BY q.created_at, q.request_id
  `,
    )
    .all() as RequestRow[];
  const requestedRuns = new Set(requests.map((row) => row.run_id));
  const automatic = database
    .prepare(
      `
    ${baseRunSelect()}
    WHERE r.state NOT IN ('rejected', 'cancelled', 'archived', 'failed', 'needs_attention')
    ORDER BY r.created_at, r.run_id
  `,
    )
    .all() as RunRow[];
  const plans = requests.map(planForRequest);
  for (const run of automatic) {
    if (requestedRuns.has(run.run_id)) continue;
    const plan = planAutomatic(run);
    if (plan) plans.push(plan);
  }
  return plans.map((plan) => {
    const command = externalCommand(plan.action, plan.runId);
    return command ? { ...plan, command: command.join(" ") } : plan;
  });
}

function ensureControlEvents(database: DatabaseSync): void {
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_review_' || COALESCE((
             SELECT MAX(h.sequence) FROM run_state_history h
             WHERE h.run_id = r.run_id
               AND h.reason = 'codex_cli_park_completed'
           ), 0),
           r.run_id, 'review_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number)
    FROM runs r
    JOIN run_resources rr USING (run_id)
    WHERE r.state = 'parked_review' AND r.owner_state = 'none'
      AND rr.tmux_session_name IS NULL AND rr.codex_thread_id IS NOT NULL
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_human_' || COALESCE((
             SELECT MAX(h.sequence) FROM run_state_history h
             WHERE h.run_id = r.run_id
               AND h.reason = 'codex_cli_handoff_completed'
           ), 0),
           r.run_id,
           'human_control_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number)
    FROM runs r
    JOIN run_resources rr USING (run_id)
    WHERE r.interaction_policy = 'human_control'
      AND r.state = 'remote_owned' AND r.owner_state = 'remote'
      AND rr.tmux_session_name IS NULL AND rr.codex_thread_id IS NOT NULL
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_preview_' || pl.lease_id || '_ready',
           r.run_id, 'preview_ready',
           json_object('project', r.project, 'issueNumber', r.issue_number,
                       'leaseId', pl.lease_id, 'slotNumber', pl.slot_number)
    FROM runs r
    JOIN preview_leases pl ON pl.run_id = r.run_id
    WHERE pl.state = 'running'
  `,
    )
    .run();
  database
    .prepare(
      `
    INSERT OR IGNORE INTO run_control_events (
      event_id, run_id, event_kind, payload_json
    )
    SELECT 'ce_' || r.run_id || '_preview_' || pl.lease_id || '_failed',
           r.run_id, 'preview_failed',
           json_object('project', r.project, 'issueNumber', r.issue_number,
                       'leaseId', pl.lease_id, 'slotNumber', pl.slot_number)
    FROM runs r
    JOIN preview_leases pl ON pl.run_id = r.run_id
    WHERE pl.state = 'failed'
  `,
    )
    .run();
}

function progressFor(run: ProgressRow): { stage: string; detail: string } {
  if (run.preview_lease_state === "failed") {
    return {
      stage: "needs_attention",
      detail: "Preview failed; inspect the preview runtime logs.",
    };
  }
  if (run.preview_lease_state === "running") {
    return {
      stage: "preview_ready",
      detail: "Preview is running and ready to open.",
    };
  }
  if (run.preview_lease_state === "provisioning") {
    return {
      stage: "preview_building",
      detail: "Building and health-checking the requested preview.",
    };
  }
  if (run.preview_lease_state === "leased") {
    return {
      stage: "preview_queued",
      detail: "Preview slot allocated; build is queued.",
    };
  }
  if (run.run_state === "admission_pending") {
    return {
      stage: "preparing",
      detail: "Run accepted; preparing an isolated worktree.",
    };
  }
  if (run.run_state === "starting") {
    return {
      stage: "starting",
      detail: "Worktree is ready; starting the managed Codex task.",
    };
  }
  if (run.run_state === "running" && run.owner_state === "cli") {
    return {
      stage: "working",
      detail: "Codex is working autonomously in the isolated worktree.",
    };
  }
  if (run.run_state === "remote_owned") {
    return {
      stage: "human_control",
      detail: "The existing Codex task is under human control.",
    };
  }
  if (run.run_state === "parked_review" && run.owner_state === "cli") {
    return {
      stage: "finalizing_review",
      detail:
        "GitHub is in Human Review; waiting for the active Codex turn to finish before releasing CLI ownership.",
    };
  }
  if (run.run_state === "parked_review" && run.owner_state === "none") {
    return {
      stage: "review_ready",
      detail: "Autonomous work is parked and ready for review.",
    };
  }
  if (run.run_state === "waiting_human") {
    return {
      stage: "waiting_human",
      detail: "The run is waiting for Alex's decision.",
    };
  }
  if (run.run_state === "stopping") {
    return {
      stage: "stopping",
      detail: "Stopping active resources and checking cleanup safety.",
    };
  }
  if (run.run_state === "archived") {
    return {
      stage: "completed",
      detail: "Run completed and managed resources were released.",
    };
  }
  if (run.run_state === "cancelled") {
    return {
      stage: "cancelled",
      detail: "Run was cancelled and is no longer active.",
    };
  }
  if (["failed", "needs_attention"].includes(run.run_state)) {
    return {
      stage: "needs_attention",
      detail: "The run needs attention before it can continue.",
    };
  }
  return { stage: run.run_state, detail: `Run state: ${run.run_state}.` };
}

function reconcileProgressCards(database: DatabaseSync): void {
  const runs = database
    .prepare(
      `
    SELECT base.*, pe.title
    FROM (${baseRunSelect()}) AS base
    JOIN runs r ON r.run_id = base.run_id
    JOIN project_events pe ON pe.event_id = r.trigger_event_id
    WHERE base.run_state NOT IN ('rejected', 'archived', 'cancelled')
       OR EXISTS (
         SELECT 1 FROM run_progress_cards pc WHERE pc.run_id = base.run_id
       )
  `,
    )
    .all() as ProgressRow[];
  const upsert = database.prepare(`
    INSERT INTO run_progress_cards (run_id, stage, detail, content_digest)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(run_id) DO UPDATE SET
      stage = excluded.stage,
      detail = excluded.detail,
      content_digest = excluded.content_digest,
      delivery_state = CASE
        WHEN run_progress_cards.content_digest = excluded.content_digest
          THEN run_progress_cards.delivery_state
        ELSE 'pending'
      END,
      last_error = CASE
        WHEN run_progress_cards.content_digest = excluded.content_digest
          THEN run_progress_cards.last_error
        ELSE NULL
      END,
      updated_at = CASE
        WHEN run_progress_cards.content_digest = excluded.content_digest
          THEN run_progress_cards.updated_at
        ELSE strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      END
  `);
  const heartbeatStages = new Set([
    "preparing",
    "starting",
    "working",
    "finalizing_review",
    "preview_queued",
    "preview_building",
    "stopping",
  ]);
  const heartbeatBucket = Math.floor(Date.now() / (5 * 60 * 1_000));
  for (const run of runs) {
    const progress = progressFor(run);
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          stage: progress.stage,
          detail: progress.detail,
          heartbeat: heartbeatStages.has(progress.stage)
            ? heartbeatBucket
            : null,
        }),
      )
      .digest("hex");
    upsert.run(run.run_id, progress.stage, progress.detail, digest);
  }
}

function completeRequest(
  database: DatabaseSync,
  requestId: string,
  state: "applied" | "rejected" | "failed",
  result: unknown,
): void {
  database
    .prepare(
      `
    UPDATE run_control_requests
    SET request_state = ?, result_json = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE request_id = ? AND request_state = 'pending'
  `,
    )
    .run(state, JSON.stringify(result), requestId);
}

function applyInternal(database: DatabaseSync, plan: PlannedAction): unknown {
  if (!plan.requestId) fail(`Internal action requires a request ID`);
  database.exec("BEGIN IMMEDIATE");
  try {
    let result: Record<string, unknown>;
    if (plan.action === "claim_remote") {
      const changed = database
        .prepare(
          `
        UPDATE runs SET owner_state = 'remote',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND owner_state = 'none'
          AND state IN ('parked_review', 'waiting_human')
      `,
        )
        .run(plan.runId);
      if (changed.changes !== 1) fail("Run changed before Remote claim");
      result = { action: "remote_claimed" };
      completeRequest(database, plan.requestId, "applied", result);
    } else if (plan.action === "request_stop") {
      const current = database
        .prepare(`SELECT state FROM runs WHERE run_id = ?`)
        .get(plan.runId) as { state: string };
      const changed = database
        .prepare(
          `
        UPDATE runs SET state = 'stopping', stop_reason = 'cancelled',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND state NOT IN ('rejected', 'cancelled', 'archived', 'stopping')
      `,
        )
        .run(plan.runId);
      if (changed.changes !== 1 && current.state !== "stopping")
        fail("Run changed before stop request");
      result = { action: "stopping", previousState: current.state };
      completeRequest(database, plan.requestId, "applied", result);
    } else {
      result = { action: plan.reason ?? plan.action };
      completeRequest(
        database,
        plan.requestId,
        plan.action === "request_reject" ? "rejected" : "applied",
        result,
      );
    }
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function runExternal(plan: PlannedAction): unknown {
  const args = externalCommand(plan.action, plan.runId);
  if (!args) fail(`No external command for ${plan.action}`);
  const stdout = execFileSync(process.execPath, args, {
    encoding: "utf8",
    env: { ...process.env, ORCHESTRATOR_HOME: orchestratorHome },
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const lastLine = stdout.split("\n").filter(Boolean).at(-1);
  return lastLine ? JSON.parse(lastLine) : null;
}

async function main(): Promise<void> {
  const { apply } = parseArguments();
  const config = parse(
    await readFile(configPath, "utf8"),
  ) as OrchestratorConfig;
  if (config.version !== 1) fail("Unsupported orchestrator config version");
  if (config.mode !== "live" && apply)
    fail(`Refusing mutation in mode=${config.mode}`);

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  let llmCount = runningLlmCount(database);
  if (apply) {
    ensureControlEvents(database);
    reconcileProgressCards(database);
  }
  const plans = buildPlans(database);

  if (!apply) {
    database.close();
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: false, activeLlm: llmCount, plans })}\n`,
    );
    return;
  }

  const results: Array<
    PlannedAction & {
      status: "applied" | "deferred";
      result?: unknown;
      reason?: string;
    }
  > = [];
  for (const plan of plans) {
    if (
      plan.action === "start" &&
      llmCount >= config.limits.max_llm_running_global
    ) {
      results.push({ ...plan, status: "deferred", reason: "LLM cap reached" });
      continue;
    }
    try {
      const internal = [
        "claim_remote",
        "request_stop",
        "request_complete",
        "request_reject",
      ].includes(plan.action);
      const result = internal
        ? applyInternal(database, plan)
        : runExternal(plan);
      if (
        plan.requestId &&
        ["handoff", "preview_up", "preview_down"].includes(plan.action)
      ) {
        completeRequest(database, plan.requestId, "applied", result);
      }
      results.push({ ...plan, status: "applied", result });
      if (plan.action === "start") llmCount += 1;
      reconcileProgressCards(database);
      ensureControlEvents(database);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({ ...plan, status: "deferred", reason });
    }
  }
  ensureControlEvents(database);
  reconcileProgressCards(database);
  database.close();

  if (process.env.CONTROLLER_QUIET !== "1") {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, activeLlm: llmCount, results })}\n`,
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
  process.exitCode = 1;
});

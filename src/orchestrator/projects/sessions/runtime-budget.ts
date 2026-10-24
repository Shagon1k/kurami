import { transcriptHasCompletedTurn } from "../../runtime/codex-terminal.ts";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { resolveKuramiHome } from "../../../core/kurami-home.ts";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { taskForSession, markTaskFailure } from "../../integrations/codex/task-store.ts";
import { stopProtocolTask, releaseProtocolTask } from "./protocol-session.ts";
import { openOrchestratorDatabase } from "../../state/database.ts";

process.umask(0o077);

export type RuntimeBudgetConfig = {
  version: number;
  mode: "dry_run" | "live";
  limits: {
    main_writer_timeout_minutes: number;
    technical_worker_timeout_minutes: number;
  };
};

export type RuntimeBudgetKind =
  | "main_writer"
  | "ci_repair"
  | "review_fix"
  | "ai_review";

export type RuntimeBudgetPlan = {
  kind: RuntimeBudgetKind;
  id: string;
  runId: string;
  tmuxSessionName: string;
  startedAt: string;
  timeoutMinutes: number;
  elapsedMinutes: number;
  successionId?: string;
};

type RuntimeRow = {
  kind: RuntimeBudgetKind;
  id: string;
  run_id: string;
  tmux_session_name: string;
  started_at: string | null;
  succession_id: string | null;
};

export type RuntimeBudgetInspection = {
  plans: RuntimeBudgetPlan[];
  warnings: string[];
};

export type StopEvidence = {
  tmuxAliveAtStart: boolean;
  forced: boolean;
  transcript: string;
};

const orchestratorHome = resolveKuramiHome(
  resolve(import.meta.dirname, "../../../../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const configPath = resolve(orchestratorHome, "config/orchestrator.yaml");

function fail(message: string): never {
  throw new Error(message);
}

function parseArguments(): { apply: boolean } {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply"))
    fail("Usage: runtime-budget.ts [--apply]");
  return { apply: args.includes("--apply") };
}

export function validateRuntimeBudgetConfig(
  config: RuntimeBudgetConfig,
): void {
  const main = config.limits.main_writer_timeout_minutes;
  const technical = config.limits.technical_worker_timeout_minutes;
  if (!Number.isInteger(main) || main < 30 || main > 24 * 60)
    fail("Invalid main_writer_timeout_minutes");
  if (!Number.isInteger(technical) || technical < 15 || technical > 12 * 60)
    fail("Invalid technical_worker_timeout_minutes");
}

function activeRows(database: DatabaseSync): RuntimeRow[] {
  const technical = database
    .prepare(
      `
      SELECT 'ci_repair' AS kind, a.attempt_id AS id, a.run_id,
             rr.tmux_session_name, a.created_at AS started_at,
             NULL AS succession_id
      FROM run_ci_repair_attempts a
      JOIN runs r USING (run_id)
      JOIN run_resources rr USING (run_id)
      WHERE a.attempt_state='running' AND r.owner_state='cli'
        AND rr.tmux_session_name IS NOT NULL
      UNION ALL
      SELECT 'review_fix' AS kind, f.round_id AS id, f.run_id,
             rr.tmux_session_name, f.created_at AS started_at,
             NULL AS succession_id
      FROM run_review_fix_rounds f
      JOIN runs r USING (run_id)
      JOIN run_resources rr USING (run_id)
      WHERE f.round_state='running' AND r.owner_state='cli'
        AND rr.tmux_session_name IS NOT NULL
      UNION ALL
      SELECT 'ai_review' AS kind, ar.review_id AS id, ar.run_id,
             ar.tmux_session_name, ar.created_at AS started_at,
             NULL AS succession_id
      FROM run_ai_reviews ar
      WHERE ar.review_state='running'
      `,
    )
    .all() as RuntimeRow[];
  const writers = database
    .prepare(
      `
      SELECT 'main_writer' AS kind, r.run_id AS id, r.run_id,
             rr.tmux_session_name,
             COALESCE(
               successor.created_at,
               (SELECT h.occurred_at FROM run_state_history h
                WHERE h.run_id=r.run_id
                  AND h.reason IN (
                    'codex_initial_turn_started',
                    'autonomous_successor_claimed'
                  )
                ORDER BY h.sequence DESC LIMIT 1)
             ) AS started_at,
             successor.succession_id
      FROM runs r
      JOIN run_resources rr USING (run_id)
      LEFT JOIN run_autonomous_successions successor
        ON successor.run_id=r.run_id
       AND successor.succession_state IN ('starting','running')
      WHERE r.owner_state='cli' AND rr.tmux_session_name IS NOT NULL
        AND r.state IN ('starting','running','handoff_pending','parked_review')
        AND NOT EXISTS (
          SELECT 1 FROM run_ci_repair_attempts a
          WHERE a.run_id=r.run_id AND a.attempt_state='running'
        )
        AND NOT EXISTS (
          SELECT 1 FROM run_review_fix_rounds f
          WHERE f.run_id=r.run_id AND f.round_state='running'
        )
      `,
    )
    .all() as RuntimeRow[];
  return [...technical, ...writers];
}

export function inspectRuntimeBudgets(
  database: DatabaseSync,
  config: RuntimeBudgetConfig,
  nowMs = Date.now(),
): RuntimeBudgetInspection {
  validateRuntimeBudgetConfig(config);
  const plans: RuntimeBudgetPlan[] = [];
  const warnings: string[] = [];
  for (const row of activeRows(database)) {
    const task = row.kind === "ci_repair" || row.kind === "review_fix"
      ? taskForSession(database, row.tmux_session_name) : null;
    const startedAt = task && task.run_id === row.run_id && task.kind === row.kind &&
      task.context_id === row.id && task.released_at === null ? task.created_at : row.started_at;
    if (!startedAt) {
      warnings.push(`${row.kind}:${row.id}:missing_start_timestamp`);
      continue;
    }
    const startedMs = Date.parse(startedAt);
    if (!Number.isFinite(startedMs) || startedMs > nowMs) {
      warnings.push(`${row.kind}:${row.id}:invalid_start_timestamp`);
      continue;
    }
    const timeoutMinutes =
      row.kind === "main_writer"
        ? config.limits.main_writer_timeout_minutes
        : config.limits.technical_worker_timeout_minutes;
    const elapsedMinutes = Math.floor((nowMs - startedMs) / 60_000);
    if (elapsedMinutes < timeoutMinutes) continue;
    plans.push({
      kind: row.kind,
      id: row.id,
      runId: row.run_id,
      tmuxSessionName: row.tmux_session_name,
      startedAt,
      timeoutMinutes,
      elapsedMinutes,
      ...(row.succession_id ? { successionId: row.succession_id } : {}),
    });
  }
  plans.sort(
    (left, right) =>
      left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id),
  );
  return { plans, warnings };
}

function tmuxExists(name: string): boolean {
  return (
    spawnSync("tmux", ["has-session", "-t", `=${name}`], {
      env: process.env,
      stdio: ["ignore", "ignore", "ignore"],
    }).status === 0
  );
}

function tmux(args: string[]): string {
  const result = spawnSync("tmux", args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0)
    fail(result.stderr.trim() || `tmux command failed: ${args.join(" ")}`);
  return result.stdout;
}

async function waitForExit(name: string, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    if (!tmuxExists(name)) return true;
  }
  return false;
}

export async function stopManagedRuntime(
  plan: RuntimeBudgetPlan,
): Promise<StopEvidence> {
  const allowed =
    plan.kind === "ai_review"
      ? /^rv-[a-z0-9-]+$/u
      : /^cx-[a-z0-9-]+$/u;
  if (!allowed.test(plan.tmuxSessionName))
    fail(`Refusing unsafe runtime session: ${plan.tmuxSessionName}`);
  const tmuxAliveAtStart = tmuxExists(plan.tmuxSessionName);
  let transcript = "";
  if (tmuxAliveAtStart) {
    try {
      transcript = tmux([
        "capture-pane",
        "-p",
        "-J",
        "-t",
        `${plan.tmuxSessionName}:0.0`,
        "-S",
        "-200",
      ]);
    } catch (error) {
      if (tmuxExists(plan.tmuxSessionName)) throw error;
    }
  }
  if (tmuxExists(plan.tmuxSessionName)) {
    tmux(["send-keys", "-t", `${plan.tmuxSessionName}:0.0`, "Escape"]);
    await waitForExit(plan.tmuxSessionName, 8);
  }
  if (tmuxExists(plan.tmuxSessionName)) {
    if (plan.kind === "ai_review") {
      tmux(["send-keys", "-t", `${plan.tmuxSessionName}:0.0`, "C-c"]);
    } else {
      tmux(["send-keys", "-t", `${plan.tmuxSessionName}:0.0`, "C-u"]);
      tmux([
        "send-keys",
        "-t",
        `${plan.tmuxSessionName}:0.0`,
        "-l",
        "--",
        "/exit",
      ]);
      tmux(["send-keys", "-t", `${plan.tmuxSessionName}:0.0`, "Enter"]);
    }
    await waitForExit(plan.tmuxSessionName, 20);
  }
  let forced = false;
  if (tmuxExists(plan.tmuxSessionName)) {
    forced = true;
    tmux(["kill-session", "-t", `=${plan.tmuxSessionName}`]);
  }
  if (tmuxExists(plan.tmuxSessionName))
    fail(`Runtime session is still alive: ${plan.tmuxSessionName}`);
  return { tmuxAliveAtStart, forced, transcript };
}

function historyReason(kind: RuntimeBudgetKind): string {
  return `${kind}_runtime_budget_exceeded`;
}

export function recordRuntimeTimeout(
  database: DatabaseSync,
  plan: RuntimeBudgetPlan,
  evidence: Omit<StopEvidence, "transcript"> & { terminalTailPath: string },
): void {
  const reason = "runtime_budget_exceeded";
  database.exec("BEGIN IMMEDIATE");
  try {
    const current = database
      .prepare(
        `SELECT r.state, r.owner_state, rr.tmux_session_name
         FROM runs r JOIN run_resources rr USING (run_id)
         WHERE r.run_id=?`,
      )
      .get(plan.runId) as
      | { state: string; owner_state: string; tmux_session_name: string | null }
      | undefined;
    if (!current) fail(`Run disappeared before timeout recording: ${plan.runId}`);

    let workerChanged = 1;
    if (plan.kind === "ci_repair")
      workerChanged = Number(
        database
          .prepare(
            `UPDATE run_ci_repair_attempts
           SET attempt_state='needs_attention', failure_reason=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE attempt_id=? AND run_id=? AND attempt_state='running'`,
          )
          .run(reason, plan.id, plan.runId).changes,
      );
    else if (plan.kind === "review_fix")
      workerChanged = Number(
        database
          .prepare(
            `UPDATE run_review_fix_rounds
           SET round_state='needs_attention', failure_reason=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE round_id=? AND run_id=? AND round_state='running'`,
          )
          .run(reason, plan.id, plan.runId).changes,
      );
    else if (plan.kind === "ai_review")
      workerChanged = Number(
        database
          .prepare(
            `UPDATE run_ai_reviews
           SET review_state='failed', failure_reason=?,
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE review_id=? AND run_id=? AND review_state='running'`,
          )
          .run(reason, plan.id, plan.runId).changes,
      );
    if (workerChanged !== 1)
      fail(`Runtime changed before timeout recording: ${plan.kind}:${plan.id}`);

    if (plan.kind !== "ai_review") {
      if (
        current.owner_state !== "cli" ||
        current.tmux_session_name !== plan.tmuxSessionName
      )
        fail(`Run ownership changed before timeout recording: ${plan.runId}`);
      const resourceChanged = database
        .prepare(
          `UPDATE run_resources SET tmux_session_name=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE run_id=? AND tmux_session_name=?`,
        )
        .run(plan.runId, plan.tmuxSessionName);
      if (resourceChanged.changes !== 1)
        fail(`Runtime mapping changed before timeout recording: ${plan.runId}`);
    }

    const runChanged = database
      .prepare(
        `UPDATE runs SET state='needs_attention', owner_state='none',
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE run_id=? AND state NOT IN ('cancelled','archived')`,
      )
      .run(plan.runId);
    if (runChanged.changes !== 1)
      fail(`Run became terminal before timeout recording: ${plan.runId}`);

    if (plan.successionId) {
      if (
        database
          .prepare(
            `UPDATE run_autonomous_successions
           SET succession_state='failed', failure_reason=?, tmux_session_name=NULL,
               completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),
               updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE succession_id=? AND succession_state IN ('starting','running')`,
          )
          .run(reason, plan.successionId).changes !== 1
      )
        fail(`Successor changed before timeout recording: ${plan.successionId}`);
    }

    database
      .prepare(
        `INSERT INTO run_state_history (
           run_id, from_state, to_state, reason, details_json
         ) VALUES (?, ?, 'needs_attention', ?, ?)`,
      )
      .run(
        plan.runId,
        current.state,
        historyReason(plan.kind),
        JSON.stringify({
          runtimeKind: plan.kind,
          runtimeId: plan.id,
          startedAt: plan.startedAt,
          timeoutMinutes: plan.timeoutMinutes,
          elapsedMinutes: plan.elapsedMinutes,
          tmuxSessionName: plan.tmuxSessionName,
          terminalTailPath: evidence.terminalTailPath,
          tmuxAliveAtStart: evidence.tmuxAliveAtStart,
          forced: evidence.forced,
          preserved: ["worktree", "branch", "codex_thread"],
        }),
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function shouldDeferCompletedMainWriter(
  plan: RuntimeBudgetPlan,
  transcript: string,
): boolean {
  return plan.kind === "main_writer" && transcriptHasCompletedTurn(transcript);
}

async function applyPlan(
  database: DatabaseSync,
  plan: RuntimeBudgetPlan,
): Promise<object> {
  const task = taskForSession(database,plan.tmuxSessionName);
  if (task) {
    if (task.turn_status || task.failure_code)
      return {...plan,action:"protocol_terminal_deferred_to_controller"};
    const stopped = await stopProtocolTask(database,task,"timeout");
    markTaskFailure(database,task.task_id,"runtime_budget_exceeded");
    releaseProtocolTask(database,taskForSession(database,task.session_name)!,"needs_attention",`${plan.kind}_runtime_budget_exceeded`);
    return {...plan,action:"protocol_runtime_stopped_needs_attention",turnId:stopped.turn_id};
  }
  // The controller owns normal terminal completion. Never let a timeout race
  // reclassify a finished main writer as an attention incident.
  if (plan.kind === "main_writer" && tmuxExists(plan.tmuxSessionName)) {
    const transcript = tmux([
      "capture-pane",
      "-p",
      "-J",
      "-t",
      `${plan.tmuxSessionName}:0.0`,
      "-S",
      "-200",
    ]);
    if (shouldDeferCompletedMainWriter(plan, transcript)) {
      return {
        ...plan,
        action: "completed_turn_deferred_to_controller",
      };
    }
  }
  const evidence = await stopManagedRuntime(plan);
  if (!evidence.tmuxAliveAtStart)
    return {
      ...plan,
      action: "runtime_already_exited_deferred_to_controller",
    };
  const safeId = plan.id.replace(/[^a-zA-Z0-9_-]/gu, "_");
  const tailDirectory = resolve(orchestratorHome, "logs/runtime-timeouts");
  const tailPath = resolve(tailDirectory, `${plan.kind}-${safeId}.txt`);
  await mkdir(tailDirectory, { recursive: true, mode: 0o700 });
  await writeFile(tailPath, `${evidence.transcript}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  recordRuntimeTimeout(database, plan, {
    tmuxAliveAtStart: evidence.tmuxAliveAtStart,
    forced: evidence.forced,
    terminalTailPath: tailPath,
  });
  return {
    ...plan,
    action: "runtime_stopped_needs_attention",
    tmuxAliveAtStart: evidence.tmuxAliveAtStart,
    forced: evidence.forced,
    terminalTailPath: tailPath,
  };
}

export async function runRuntimeBudgetCli(): Promise<void> {
  const { apply } = parseArguments();
  const config = parse(await readFile(configPath, "utf8")) as RuntimeBudgetConfig;
  if (config.version !== 1) fail("Unsupported orchestrator config version");
  validateRuntimeBudgetConfig(config);
  if (apply && config.mode !== "live")
    fail(`Refusing runtime mutation in mode=${config.mode}`);
  const database = openOrchestratorDatabase(databasePath);
  try {
    const inspection = inspectRuntimeBudgets(database, config);
    if (!apply) {
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: false, ...inspection })}\n`,
      );
      return;
    }
    const results = [];
    for (const plan of inspection.plans)
      results.push(await applyPlan(database, plan));
    if (
      process.env.RUNTIME_BUDGET_QUIET !== "1" ||
      inspection.warnings.length > 0 ||
      results.length > 0
    )
      process.stdout.write(
        `${JSON.stringify({ ok: true, apply: true, warnings: inspection.warnings, results })}\n`,
      );
  } finally {
    database.close();
  }
}

if (import.meta.main)
  runRuntimeBudgetCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });

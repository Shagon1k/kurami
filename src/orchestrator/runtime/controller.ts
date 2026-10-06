import { spawnSync } from "node:child_process";
import { transcriptHasCompletedTurn } from "./codex-terminal.ts";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { loadEffectiveOrchestratorConfig } from "../settings/runtime-settings.ts";
import { taskForSession, protocolTurnSucceeded } from "../integrations/codex/task-store.ts";
import { reconcileProtocolTasks } from "../projects/sessions/protocol-session.ts";
import { planAutomatic } from "./automatic-plan.ts";
import { baseRunSelect, type RunRow } from "./run-read-model.ts";
import { planForRequest, type PlannedAction, type RequestRow } from "./request-plan.ts";
import { previewExpired } from "./run-predicates.ts";
import { databasePath, fail, orchestratorHome, projectsPath } from "./controller-context.ts";
import { ControllerFailureLedger, controllerFailuresPath } from "./controller-failures.ts";
import type { OrchestratorConfig, ProjectsRegistry } from "./controller-types.ts";
import {
  completeRequest,
  executePlannedAction,
  externalCommand,
  hasReconcilableReviewFixOperation,
} from "./controller-execution.ts";
import {
  reconcileAfterAppliedAction,
  reconcileAfterCycle,
  reconcileBeforePlanning,
} from "./controller-cycle.ts";

process.umask(0o077);

function parseArguments(): { apply: boolean } {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--apply")) {
    fail("Usage: controller.ts [--apply]");
  }
  return { apply: args.includes("--apply") };
}

function runningLlmCount(database: DatabaseSync): number {
  const owned = Number(
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
  const reviews = Number(
    (
      database
        .prepare(
          `SELECT COUNT(*) AS count FROM run_ai_reviews
           WHERE review_state = 'running'`,
        )
        .get() as { count: number }
    ).count,
  );
  return owned + reviews;
}

function managedCliTurnCompleted(sessionName: string): boolean {
  if (!/^cx-[a-z0-9-]+$/u.test(sessionName)) return false;
  const result = spawnSync(
    "tmux",
    [
      "capture-pane",
      "-p",
      "-J",
      "-t",
      `${sessionName}:0.0`,
      "-S",
      "-200",
    ],
    {
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return result.status === 0 && transcriptHasCompletedTurn(result.stdout);
}

function buildPlans(
  database: DatabaseSync,
  registry: ProjectsRegistry,
  config: OrchestratorConfig,
): PlannedAction[] {
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
  const requestedRuns = new Set(
    requests
      .filter((row) => row.stop_reason !== "cancelled")
      .map((row) => row.run_id),
  );
  const automatic = database
    .prepare(
      `
    ${baseRunSelect()}
    WHERE r.state NOT IN ('rejected', 'failed')
      AND (r.state <> 'needs_attention'
           OR rr.previous_codex_thread_id IS NOT NULL
           OR (pl.state = 'running'
               AND pl.expires_at IS NOT NULL
               AND pl.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
           OR (r.stop_reason = 'cancelled'
               AND (SELECT reason FROM run_state_history attention_latest
                    WHERE attention_latest.run_id = r.run_id
                      AND attention_latest.to_state = 'needs_attention'
                    ORDER BY attention_latest.sequence DESC LIMIT 1) = 'worktree_release_blocked')
           OR (r.stop_reason = 'completed'
               AND (SELECT reason FROM run_state_history attention_latest
                    WHERE attention_latest.run_id = r.run_id
                      AND attention_latest.to_state = 'needs_attention'
                    ORDER BY attention_latest.sequence DESC LIMIT 1) = 'completion_waiting_for_merge'))
      AND (r.state <> 'archived'
           OR rr.previous_codex_thread_id IS NOT NULL)
    ORDER BY r.created_at, r.run_id
  `,
    )
    .all() as RunRow[];
  const plans: PlannedAction[] = [];
  const expiryPlanned = new Set<string>();
  for (const request of requests) {
    if (previewExpired(request)) {
      if (expiryPlanned.has(request.run_id)) continue;
      expiryPlanned.add(request.run_id);
      const pendingPreviewAction = ["preview_start", "preview_stop"].includes(
        request.requested_action,
      );
      plans.push({
        runId: request.run_id,
        project: request.project,
        issueNumber: request.issue_number,
        action: "preview_expire",
        requestId: pendingPreviewAction ? request.request_id : undefined,
        requestOutcome:
          request.requested_action === "preview_start"
            ? "rejected"
            : request.requested_action === "preview_stop"
              ? "applied"
              : undefined,
        reason: "preview_ttl_expired",
      });
    } else {
      plans.push(planForRequest(request, config));
    }
  }
  for (const run of automatic) {
    if (requestedRuns.has(run.run_id)) continue;
    const plan = planAutomatic(run, registry, (session) => taskForSession(database,session) ? protocolTurnSucceeded(database,session) : managedCliTurnCompleted(session));
    if (plan) plans.push(plan);
  }
  return plans.map((plan) => {
    const command = externalCommand(plan.action, plan.runId, plan.requestId, plan.roundId);
    return command ? { ...plan, command: command.join(" ") } : plan;
  });
}

export async function runOrchestratorControllerCli(): Promise<void> {
  const { apply } = parseArguments();
  const config = await loadEffectiveOrchestratorConfig<OrchestratorConfig>(
    orchestratorHome,
  );
  const registry = parse(
    await readFile(projectsPath, "utf8"),
  ) as ProjectsRegistry;
  if (config.version !== 1) fail("Unsupported orchestrator config version");
  if (
    !Number.isInteger(config.limits.preview_expiry_warning_hours) ||
    config.limits.preview_expiry_warning_hours < 1 ||
    config.limits.preview_expiry_warning_hours > 24 * 7
  )
    fail("Invalid preview_expiry_warning_hours");
  if (
    !Number.isInteger(config.limits.main_writer_timeout_minutes) ||
    config.limits.main_writer_timeout_minutes < 30 ||
    config.limits.main_writer_timeout_minutes > 24 * 60
  )
    fail("Invalid main_writer_timeout_minutes");
  if (
    !Number.isInteger(config.limits.technical_worker_timeout_minutes) ||
    config.limits.technical_worker_timeout_minutes < 15 ||
    config.limits.technical_worker_timeout_minutes > 12 * 60
  )
    fail("Invalid technical_worker_timeout_minutes");
  if (registry.version !== 1) fail("Unsupported projects registry version");
  if (config.mode !== "live" && apply)
    fail(`Refusing mutation in mode=${config.mode}`);

  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (apply) {
    await reconcileProtocolTasks(database);
    reconcileBeforePlanning(database, config);
  }
  let llmCount = runningLlmCount(database);
  const plans = buildPlans(database, registry, config);

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
  // Automatic actions that keep failing back off; owner requests (requestId) always run.
  const ledger = new ControllerFailureLedger(controllerFailuresPath(orchestratorHome));
  for (const plan of plans) {
    const backingOff = plan.requestId ? null : ledger.backingOff(plan);
    if (backingOff) {
      results.push({ ...plan, status: "deferred", reason: `backoff after ${backingOff.count} failures until ${backingOff.nextAt}` });
      continue;
    }
    if (
      ["start", "successor_start", "repair_start", "review_start", "review_fix_start"].includes(plan.action) &&
      llmCount >= config.limits.max_llm_running_global
    ) {
      results.push({ ...plan, status: "deferred", reason: "LLM cap reached" });
      continue;
    }
    try {
      const result = executePlannedAction(database, plan);
      if (!plan.requestId) ledger.recordSuccess(plan);
      results.push({ ...plan, status: "applied", result });
      if (["start", "successor_start", "repair_start", "review_start", "review_fix_start"].includes(plan.action))
        llmCount += 1;
      reconcileAfterAppliedAction(database, config);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (plan.requestId && reason.includes("protocol_remote_handoff_unverified"))
        completeRequest(database,plan.requestId,"failed",{
          action:"protocol_remote_handoff_unverified",reason,
        });
      const failure = plan.requestId ? null : ledger.recordFailure(plan, reason);
      if (process.env.CONTROLLER_QUIET === "1") {
        // One line per failure, with time and level: "wait" for an expected wait (the Codex turn is still
        // running), "error" otherwise; count and nextAt show the backoff.
        process.stderr.write(
          `${JSON.stringify({
            ts: new Date().toISOString(),
            level: failure?.kind ?? "error",
            ok: false,
            runId: plan.runId,
            project: plan.project,
            issueNumber: plan.issueNumber,
            action: plan.action,
            ...(failure ? { count: failure.count, nextAt: failure.nextAt } : {}),
            reason,
          })}\n`,
        );
      }
      if (
        ["successor_start", "review_start", "review_fix_start", "recover_managed_task"].includes(
          plan.action,
        ) &&
        plan.requestId &&
        !hasReconcilableReviewFixOperation(database, plan)
      ) {
        completeRequest(database, plan.requestId, "failed", {
          action:
            plan.action === "successor_start"
              ? "autonomous_successor_start_failed"
              : plan.action === "review_start"
              ? "ai_review_start_failed"
              : plan.action === "review_fix_start"
                ? "review_fix_start_failed"
                : "managed_task_recovery_failed",
          reason,
        });
      }
      results.push({ ...plan, status: "deferred", reason });
    }
  }
  reconcileAfterCycle(database, config);
  database.close();
  ledger.forgetStale();
  await ledger.save();

  if (process.env.CONTROLLER_QUIET !== "1") {
    process.stdout.write(
      `${JSON.stringify({ ok: true, apply: true, activeLlm: llmCount, results })}\n`,
    );
  }
}

if (import.meta.main) {
  runOrchestratorControllerCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: "error", ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}

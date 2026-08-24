import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  applyAssessmentPlan,
  maximumProposalBatchIssues,
  planProjectAssessment,
  type AssessmentPlan,
} from "./metadata-proposal-manager.ts";
import { loadEffectiveOrchestratorConfig } from "./runtime-settings.ts";

process.umask(0o077);

export type DailyProposalPlan =
  | {
      project: string;
      action: "create";
      assessment: Extract<AssessmentPlan, { action: "create" }>;
    }
  | {
      project: string;
      action: "resume";
      batchId: string;
    }
  | {
      project: string;
      action: "recover";
      batchId: string;
      reason: "stale_running_batch";
    }
  | {
      project: string;
      action: "cursor";
      assessment: Extract<AssessmentPlan, { action: "cursor" }>;
    }
  | {
      project: string;
      action: "disabled" | "unchanged" | "daily_limit" | "active" | "capacity";
      reason: string;
      batchId?: string;
    };

export type ProposalWorker = (batchId: string) => unknown;

function fail(message: string): never {
  throw new Error(message);
}

function validDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

function admittedOnDate(
  database: DatabaseSync,
  project: string,
  admissionDate: string,
): boolean {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM project_metadata_daily_admissions
       WHERE project=? AND admission_date=?`,
    )
    .get(project, admissionDate) as { count: number };
  return row.count > 0;
}

function activeBatchUpdatedAt(
  database: DatabaseSync,
  batchId: string,
): string {
  const row = database
    .prepare(
      `SELECT updated_at FROM project_metadata_proposal_batches WHERE batch_id=?`,
    )
    .get(batchId) as { updated_at: string } | undefined;
  if (!row) fail(`Active metadata batch disappeared: ${batchId}`);
  return row.updated_at;
}

function managedLlmCount(database: DatabaseSync): number {
  const runs = database
    .prepare(
      `SELECT COUNT(*) AS count FROM runs
       WHERE owner_state='cli'
         AND state IN ('starting','running','handoff_pending','parked_review','stopping')`,
    )
    .get() as { count: number };
  const reviews = database
    .prepare(
      `SELECT COUNT(*) AS count FROM run_ai_reviews WHERE review_state='running'`,
    )
    .get() as { count: number };
  return Number(runs.count) + Number(reviews.count);
}

function admit(
  database: DatabaseSync,
  project: string,
  admissionDate: string,
  batchId: string,
  admissionKind: "create" | "resume" | "recover",
): void {
  const existing = database
    .prepare(
      `SELECT batch_id FROM project_metadata_daily_admissions
       WHERE project=? AND admission_date=?`,
    )
    .get(project, admissionDate) as { batch_id: string } | undefined;
  if (existing) {
    if (existing.batch_id !== batchId)
      fail(`Automatic metadata admission already used for ${project} on ${admissionDate}`);
    return;
  }
  database
    .prepare(
      `INSERT INTO project_metadata_daily_admissions (
         project, admission_date, batch_id, admission_kind
       ) VALUES (?, ?, ?, ?)`,
    )
    .run(project, admissionDate, batchId, admissionKind);
}

function recoverStaleRunningBatch(
  database: DatabaseSync,
  batchId: string,
  admissionDate: string,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const changed = database
      .prepare(
        `UPDATE project_metadata_proposal_batches
         SET batch_state='failed',
             failure_reason='Automatic metadata worker did not finish before the next daily admission',
             completed_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE batch_id=? AND batch_state='running'`,
      )
      .run(batchId);
    if (changed.changes !== 1)
      fail(`Stale metadata batch is no longer recoverable: ${batchId}`);
    database
      .prepare(
        `INSERT INTO project_metadata_proposal_events (
           event_id, batch_id, event_type, actor, details_json
         ) VALUES (?, ?, 'automatic_recovery', 'kurami', ?)`,
      )
      .run(
        `pme_${randomUUID().replaceAll("-", "")}`,
        batchId,
        JSON.stringify({ admissionDate, reason: "stale_running_batch" }),
      );
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function planDailyProjectAssessment(
  database: DatabaseSync,
  project: string,
  admissionDate: string,
  dailyLimit = maximumProposalBatchIssues,
): DailyProposalPlan {
  if (!validDate(admissionDate)) fail(`Invalid admission date: ${admissionDate}`);
  const assessment = planProjectAssessment(database, project, dailyLimit);
  if (assessment.action === "disabled")
    return { project, action: "disabled", reason: assessment.reason };
  if (assessment.action === "active") {
    if (assessment.batchState === "planned")
      return { project, action: "resume", batchId: assessment.batchId };
    if (
      assessment.batchState === "running" &&
      activeBatchUpdatedAt(database, assessment.batchId).slice(0, 10) < admissionDate
    )
      return {
        project,
        action: "recover",
        batchId: assessment.batchId,
        reason: "stale_running_batch",
      };
    return {
      project,
      action: "active",
      batchId: assessment.batchId,
      reason: `active_${assessment.batchState}`,
    };
  }
  if (assessment.action === "unchanged")
    return { project, action: "unchanged", reason: "facts_unchanged" };
  if (assessment.action === "cursor")
    return { project, action: "cursor", assessment };
  if (admittedOnDate(database, project, admissionDate))
    return { project, action: "daily_limit", reason: "batch_already_created_today" };
  return { project, action: "create", assessment };
}

function selectedProjects(
  database: DatabaseSync,
  selectedProject: string | null,
): string[] {
  const rows = database
    .prepare(
      `SELECT project FROM project_triage_state
       WHERE (? IS NULL OR project=?) ORDER BY project`,
    )
    .all(selectedProject, selectedProject) as Array<{ project: string }>;
  if (selectedProject && rows.length === 0)
    fail(`No Projects Digest facts found for project: ${selectedProject}`);
  return rows.map(({ project }) => project);
}

export function runDailyProposalCycle(
  database: DatabaseSync,
  admissionDate: string,
  apply: boolean,
  worker: ProposalWorker,
  selectedProject: string | null = null,
  maxActiveLlm = 1,
  dailyLimit = maximumProposalBatchIssues,
): {
  ok: boolean;
  apply: boolean;
  admissionDate: string;
  results: Array<Record<string, unknown>>;
  failures: number;
} {
  const initialPlans = selectedProjects(database, selectedProject).map((project) =>
    planDailyProjectAssessment(database, project, admissionDate, dailyLimit),
  );
  const activeLlm = managedLlmCount(database);
  const plans = initialPlans.map<DailyProposalPlan>((plan) =>
    ["create", "resume", "recover"].includes(plan.action) && activeLlm >= maxActiveLlm
      ? {
          project: plan.project,
          action: "capacity",
          reason: `managed_llm_capacity_${activeLlm}_of_${maxActiveLlm}`,
          batchId: "batchId" in plan ? plan.batchId : undefined,
        }
      : plan,
  );
  if (!apply)
    return {
      ok: true,
      apply: false,
      admissionDate,
      results: plans,
      failures: 0,
    };

  let failures = 0;
  const results = plans.map<Record<string, unknown>>((plan) => {
    let batchId: string | null = null;
    let admissionKind: "create" | "resume" | "recover" = "create";
    if (plan.action === "create") {
      const created = applyAssessmentPlan(database, plan.assessment) as {
        batchId: string;
        batchNumber: number;
      };
      batchId = created.batchId;
    } else if (plan.action === "resume") {
      batchId = plan.batchId;
      admissionKind = "resume";
    } else if (plan.action === "recover") {
      recoverStaleRunningBatch(database, plan.batchId, admissionDate);
      const replacement = planProjectAssessment(database, plan.project, dailyLimit);
      if (replacement.action !== "create")
        fail(`Stale metadata recovery did not produce a replacement batch: ${replacement.action}`);
      const created = applyAssessmentPlan(database, replacement) as { batchId: string };
      batchId = created.batchId;
      admissionKind = "recover";
    } else if (plan.action === "cursor") {
      return applyAssessmentPlan(database, plan.assessment);
    } else {
      return plan;
    }

    admit(database, plan.project, admissionDate, batchId, admissionKind);

    try {
      return {
        project: plan.project,
        action:
          plan.action === "create"
            ? "created"
            : plan.action === "recover"
              ? "recovered"
              : "resumed",
        batchId,
        worker: worker(batchId),
      };
    } catch (error) {
      failures += 1;
      return {
        project: plan.project,
        action: "worker_failed",
        batchId,
        error: error instanceof Error ? error.message.slice(0, 500) : String(error),
      };
    }
  });
  return {
    ok: failures === 0,
    apply: true,
    admissionDate,
    results,
    failures,
  };
}

function parseArguments(args: string[]): {
  project: string | null;
  apply: boolean;
  admissionDate: string;
} {
  const projectIndex = args.indexOf("--project");
  const project = projectIndex === -1 ? null : args[projectIndex + 1]?.trim() ?? "";
  const dateIndex = args.indexOf("--date");
  const admissionDate =
    dateIndex === -1
      ? new Date().toISOString().slice(0, 10)
      : args[dateIndex + 1]?.trim() ?? "";
  const known = new Set(["--project", project, "--date", admissionDate, "--apply"]);
  if (
    (projectIndex !== -1 && (!project || project.startsWith("--"))) ||
    (dateIndex !== -1 && !validDate(admissionDate)) ||
    args.some((arg) => !known.has(arg))
  )
    fail(
      "Usage: metadata-proposal-scheduler.ts [--project <project>] [--date YYYY-MM-DD] [--apply]",
    );
  return { project: project || null, apply: args.includes("--apply"), admissionDate };
}

function workerRunner(orchestratorHome: string): ProposalWorker {
  return (batchId) => {
    const output = execFileSync(
      process.execPath,
      [resolve(orchestratorHome, "app/src/metadata-proposal-worker.ts"), "--batch-id", batchId, "--apply"],
      {
        encoding: "utf8",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20 * 60 * 1_000,
      },
    ).trim();
    return JSON.parse(output) as unknown;
  };
}

async function main(): Promise<void> {
  const { project, apply, admissionDate } = parseArguments(process.argv.slice(2));
  const orchestratorHome = resolve(
    process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const config = await loadEffectiveOrchestratorConfig(orchestratorHome);
  const maxActiveLlm = config.limits?.max_llm_running_global;
  const dailyLimit = config.limits?.ai_triage_daily;
  if (
    config.version !== 1 ||
    !Number.isInteger(maxActiveLlm) ||
    (maxActiveLlm ?? 0) < 1 ||
    !Number.isInteger(dailyLimit) ||
    (dailyLimit ?? -1) < 0 ||
    (dailyLimit ?? 41) > 40
  )
    fail("Invalid orchestrator AI capacity configuration");
  const database = new DatabaseSync(resolve(orchestratorHome, "state/orchestrator.db"), {
    timeout: 5_000,
  });
  database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  try {
    const result = runDailyProposalCycle(
      database,
      admissionDate,
      apply,
      workerRunner(orchestratorHome),
      project,
      maxActiveLlm,
      dailyLimit,
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!result.ok) process.exitCode = 1;
  } finally {
    database.close();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : null;
if (invokedPath === import.meta.url)
  main().catch((error: unknown) => {
    process.stderr.write(
      `${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`,
    );
    process.exitCode = 1;
  });

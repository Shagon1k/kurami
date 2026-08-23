import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import {
  inspectResourceGuard,
  reconcileResourceQuarantines,
  validateResourceGuardLimits,
  type ResourceGuardAnalysis,
  type ResourceGuardLimits,
} from "./resource-guard.ts";
import {
  effectiveOrchestratorConfig,
  projectWipLimit,
  type RuntimeSettingsBaseConfig,
} from "./runtime-settings.ts";

process.umask(0o077);

type ProjectConfig = {
  repository: string;
  human_control_label: string;
  statuses: {
    backlog: string;
    active: string;
    review: string;
    done: string;
    deferred: string;
  };
  workspace: {
    canonical_repository: string;
    worktree_root: string;
    branch_prefix: string;
  };
  preview?: {
    required_label?: string;
  };
};

type ProjectsRegistry = {
  version: number;
  projects: Record<string, ProjectConfig>;
};

type OrchestratorConfig = RuntimeSettingsBaseConfig & {
  limits: RuntimeSettingsBaseConfig["limits"] & {
    max_active_global: number;
    max_active_per_project: number;
    max_active_by_project?: Record<string, number>;
  } & ResourceGuardLimits;
};

type EventRow = {
  event_id: string;
  observed_at: string;
  project: string;
  item_id: string;
  content_id: string | null;
  content_type: string;
  repository: string | null;
  issue_number: number | null;
  title: string | null;
  from_status: string | null;
  to_status: string | null;
  payload_json: string;
};

type LiveRun = {
  run_id: string;
  state: string;
  stop_reason: "cancelled" | "completed" | null;
  execution_mode: "dry_run" | "live";
  resource_state: string | null;
  preview_required: number;
  preview_required_label: string | null;
  completion_requested_at: string | null;
  ci_head_sha: string | null;
  preview_lease_id: string | null;
  preview_lease_state: string | null;
  preview_verified_head_sha: string | null;
  preview_reviewed_at: string | null;
};

type EventResult = {
  eventId: string;
  action: "created" | "cancelled" | "stopping" | "rejected" | "ignored";
  runId?: string;
  reason?: string;
};

const orchestratorHome = resolve(
  process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
);
const databasePath = resolve(orchestratorHome, "state/orchestrator.db");
const projectsPath = resolve(orchestratorHome, "config/projects.yaml");
const orchestratorConfigPath = resolve(
  orchestratorHome,
  "config/orchestrator.yaml",
);

const ACTIVE_STATES = [
  "admission_pending",
  "starting",
  "running",
  "handoff_pending",
  "waiting_human",
  "remote_owned",
  "failed",
  "stopping",
  "needs_attention",
] as const;
const ACTIVE_STATE_PARAMETERS = ACTIVE_STATES.map(() => "?").join(", ");
const LIVE_STATES = [...ACTIVE_STATES, "parked_review"] as const;
const LIVE_STATE_PARAMETERS = LIVE_STATES.map(() => "?").join(", ");

function fail(message: string): never {
  throw new Error(message);
}

async function loadYaml<T>(path: string): Promise<T> {
  return parse(await readFile(path, "utf8")) as T;
}

function parseEventMetadata(payloadJson: string): {
  issueState: string | null;
  labels: string[];
  hasDescription: boolean;
} {
  const payload = JSON.parse(payloadJson) as {
    issueState?: unknown;
    labels?: unknown;
    hasDescription?: unknown;
  };
  return {
    issueState: typeof payload.issueState === "string" ? payload.issueState : null,
    labels: Array.isArray(payload.labels)
      ? payload.labels.filter((label): label is string => typeof label === "string")
      : [],
    hasDescription: payload.hasDescription === true,
  };
}

function makeRunId(eventId: string): string {
  const fingerprint = createHash("sha256").update(eventId).digest("hex").slice(0, 20);
  return `r_${fingerprint}`;
}

function makeTitleHint(title: string | null): string | null {
  const match = title?.match(/^\s*\[[^\]]+\]\s*:\s*(.+)$/u);
  if (!match) return null;

  const words = match[1]
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean)
    .filter((word) => !["a", "an", "the", "to", "for", "of", "and"].includes(word))
    .slice(0, 6);
  return words.join("-").slice(0, 48).replace(/-+$/u, "") || null;
}

function planResourceNames(
  database: DatabaseSync,
  project: ProjectConfig,
  issueNumber: number,
  title: string | null,
): { branchName: string; worktreePath: string } {
  const hint = makeTitleHint(title);
  const baseName = `${project.workspace.branch_prefix}-${issueNumber}${hint ? `_${hint}` : ""}`;
  const repositoryDirectory = project.repository.split("/").at(-1);
  if (!repositoryDirectory) fail(`Invalid repository name: ${project.repository}`);
  const exists = database.prepare(`
    SELECT 1
    FROM run_resources
    WHERE branch_name = ? OR worktree_path = ?
    LIMIT 1
  `);
  let branchName = baseName;
  let retry = 2;

  while (
    exists.get(
      branchName,
      resolve(project.workspace.worktree_root, branchName, repositoryDirectory),
    )
  ) {
    branchName = `${baseName}_retry-${retry}`;
    retry += 1;
  }

  return {
    branchName,
    // Keep the unique attempt directory in the parent while giving Codex a
    // stable repository basename for Remote project presentation.
    worktreePath: resolve(
      project.workspace.worktree_root,
      branchName,
      repositoryDirectory,
    ),
  };
}

function activeCount(database: DatabaseSync, project?: string): number {
  const projectClause = project ? " AND project = ?" : "";
  const row = database
    .prepare(`
      SELECT COUNT(*) AS count
      FROM runs
      WHERE state IN (${ACTIVE_STATE_PARAMETERS})${projectClause}
    `)
    .get(...ACTIVE_STATES, ...(project ? [project] : [])) as { count: number };
  return row.count;
}

function markEvent(
  database: DatabaseSync,
  eventId: string,
  state: "processed" | "ignored" | "failed",
  note: string,
): void {
  database
    .prepare(`
      UPDATE project_events
      SET processing_state = ?,
          processed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
          processing_note = ?,
          processing_error = CASE WHEN ? = 'failed' THEN ? ELSE NULL END
      WHERE event_id = ?
    `)
    .run(state, note, state, note, eventId);
}

function appendHistory(
  database: DatabaseSync,
  runId: string,
  fromState: string | null,
  toState: string,
  reason: string,
  eventId: string,
  details: unknown,
): void {
  database
    .prepare(`
      INSERT INTO run_state_history (
        run_id, from_state, to_state, reason, source_event_id, details_json
      ) VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(runId, fromState, toState, reason, eventId, JSON.stringify(details));
}

function latestRun(
  database: DatabaseSync,
  project: string,
  itemId: string,
): LiveRun | undefined {
  return database
    .prepare(`
      SELECT r.run_id, r.state, r.stop_reason, r.execution_mode, rr.resource_state,
             r.preview_required, r.preview_required_label,
             r.completion_requested_at,
             ci.head_sha AS ci_head_sha,
             pl.lease_id AS preview_lease_id,
             pl.state AS preview_lease_state,
             pl.verified_head_sha AS preview_verified_head_sha,
             pl.reviewed_at AS preview_reviewed_at
      FROM runs r
      LEFT JOIN run_resources rr USING (run_id)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      LEFT JOIN preview_leases pl
        ON pl.run_id = r.run_id AND pl.state <> 'released'
      WHERE r.project = ? AND r.item_id = ?
      ORDER BY r.created_at DESC
      LIMIT 1
    `)
    .get(project, itemId) as LiveRun | undefined;
}

function liveRun(
  database: DatabaseSync,
  project: string,
  itemId: string,
): LiveRun | undefined {
  return database
    .prepare(`
      SELECT r.run_id, r.state, r.stop_reason, r.execution_mode, rr.resource_state,
             r.preview_required, r.preview_required_label,
             r.completion_requested_at,
             ci.head_sha AS ci_head_sha,
             pl.lease_id AS preview_lease_id,
             pl.state AS preview_lease_state,
             pl.verified_head_sha AS preview_verified_head_sha,
             pl.reviewed_at AS preview_reviewed_at
      FROM runs r
      LEFT JOIN run_resources rr USING (run_id)
      LEFT JOIN run_ci_snapshots ci USING (run_id)
      LEFT JOIN preview_leases pl
        ON pl.run_id = r.run_id AND pl.state <> 'released'
      WHERE r.project = ?
        AND r.item_id = ?
        AND r.state IN (${LIVE_STATE_PARAMETERS})
      ORDER BY r.created_at DESC
      LIMIT 1
    `)
    .get(project, itemId, ...LIVE_STATES) as LiveRun | undefined;
}

function createRun(
  database: DatabaseSync,
  event: EventRow,
  project: ProjectConfig,
  config: OrchestratorConfig,
  resourceGuard: ResourceGuardAnalysis,
): EventResult {
  if (
    event.content_type !== "Issue" ||
    event.content_id === null ||
    event.issue_number === null ||
    event.repository !== project.repository
  ) {
    const reason = "Event is not an allowlisted GitHub Issue";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }

  const metadata = parseEventMetadata(event.payload_json);
  if (metadata.issueState !== "OPEN" || !metadata.hasDescription) {
    const reason =
      metadata.issueState !== "OPEN"
        ? "Issue is not open or readiness metadata is missing"
        : "Issue description is empty";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }

  const existing = liveRun(database, event.project, event.item_id);
  if (existing) {
    const reason = `Live run already exists: ${existing.run_id}`;
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }

  const globalActive = activeCount(database);
  const projectActive = activeCount(database, event.project);
  const projectLimit = projectWipLimit(config.limits, event.project);
  const wipRejected =
    globalActive >= config.limits.max_active_global ||
    projectActive >= projectLimit;
  const rejected = wipRejected || resourceGuard.admissionBlocked;
  const runId = makeRunId(event.event_id);
  const previousRun = latestRun(database, event.project, event.item_id);
  const interactionPolicy = metadata.labels.includes(project.human_control_label)
    ? "human_control"
    : "autonomous";
  const previewRequiredLabel = project.preview?.required_label?.trim() || null;
  const previewRequired =
    previewRequiredLabel !== null && metadata.labels.includes(previewRequiredLabel);
  const state = rejected ? "rejected" : "admission_pending";
  const rejectionReason = wipRejected
    ? `WIP limit reached: global ${globalActive}/${config.limits.max_active_global}, project ${projectActive}/${projectLimit}`
    : resourceGuard.admissionBlocked
      ? `Resource guard blocked admission: ${resourceGuard.blockReasons.join("; ")}`
      : null;

  database
    .prepare(`
      INSERT INTO runs (
        run_id, trigger_event_id, project, item_id, content_id, repository,
        issue_number, interaction_policy, state, owner_state,
        rejection_reason, execution_mode, previous_run_id,
        preview_required, preview_required_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, ?, ?, ?, ?)
    `)
    .run(
      runId,
      event.event_id,
      event.project,
      event.item_id,
      event.content_id,
      event.repository,
      event.issue_number,
      interactionPolicy,
      state,
      rejectionReason,
      config.mode,
      previousRun?.run_id ?? null,
      previewRequired ? 1 : 0,
      previewRequired ? previewRequiredLabel : null,
    );

  if (!rejected) {
    const { branchName, worktreePath } = planResourceNames(
      database,
      project,
      event.issue_number,
      event.title,
    );

    database
      .prepare(`
        INSERT INTO run_resources (
          run_id, resource_state, worktree_path, branch_name
        ) VALUES (?, 'planned', ?, ?)
      `)
      .run(runId, worktreePath, branchName);
  }

  appendHistory(
    database,
    runId,
    null,
    state,
    rejected
      ? wipRejected
        ? "wip_limit_rejected"
        : "resource_guard_rejected"
      : "activation_event_admitted",
    event.event_id,
    {
      globalActiveBefore: globalActive,
      projectActiveBefore: projectActive,
      executionMode: config.mode,
      previewRequired,
      previewRequiredLabel: previewRequired ? previewRequiredLabel : null,
      resourceGuard: {
        disk: resourceGuard.disk,
        worktrees: resourceGuard.worktrees,
        observations: resourceGuard.observations.length,
        quarantines: resourceGuard.quarantines,
      },
    },
  );
  markEvent(
    database,
    event.event_id,
    "processed",
    rejected
      ? wipRejected
        ? "Rejected by WIP gate"
        : "Rejected by resource guard"
      : `${config.mode === "dry_run" ? "Dry-run" : "Live run"} created`,
  );

  return {
    eventId: event.event_id,
    action: rejected ? "rejected" : "created",
    runId,
    reason: rejectionReason ?? undefined,
  };
}

function cancelRun(
  database: DatabaseSync,
  event: EventRow,
): EventResult {
  const current = liveRun(database, event.project, event.item_id);
  if (!current) {
    const reason = "No live run exists for cancellation";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }

  const nextState =
    current.execution_mode === "dry_run" || current.resource_state === "planned"
      ? "cancelled"
      : "stopping";
  database
    .prepare(`
      UPDATE runs
      SET state = ?,
          stop_reason = CASE WHEN ? = 'stopping' THEN 'cancelled' ELSE stop_reason END,
          owner_state = CASE WHEN ? = 'cancelled' THEN 'none' ELSE owner_state END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ?
    `)
    .run(nextState, nextState, nextState, current.run_id);

  if (nextState === "cancelled") {
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'released',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND resource_state = 'planned'
      `)
      .run(current.run_id);
  }

  appendHistory(
    database,
    current.run_id,
    current.state,
    nextState,
    "owner_moved_item_out_of_active",
    event.event_id,
    { fromStatus: event.from_status, toStatus: event.to_status },
  );
  markEvent(database, event.event_id, "processed", `Run moved to ${nextState}`);

  return {
    eventId: event.event_id,
    action: nextState === "cancelled" ? "cancelled" : "stopping",
    runId: current.run_id,
  };
}

function parkForReview(database: DatabaseSync, event: EventRow): EventResult {
  const current = liveRun(database, event.project, event.item_id);
  if (!current) {
    const reason = "No live run exists for Human Review";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }
  if (current.stop_reason === "cancelled") {
    const reason = "Cancellation already requested; Human Review cannot revive the run";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", runId: current.run_id, reason };
  }
  if (current.state === "parked_review") {
    const reason = "Run is already parked for Human Review";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }
  database
    .prepare(`
      UPDATE runs
      SET state = 'parked_review',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ?
    `)
    .run(current.run_id);
  appendHistory(
    database,
    current.run_id,
    current.state,
    "parked_review",
    "owner_moved_item_to_human_review",
    event.event_id,
    { fromStatus: event.from_status, toStatus: event.to_status },
  );
  markEvent(database, event.event_id, "processed", "Run parked for Human Review");
  return { eventId: event.event_id, action: "ignored", runId: current.run_id, reason: "parked_review" };
}

function completeRun(database: DatabaseSync, event: EventRow): EventResult {
  const current = liveRun(database, event.project, event.item_id);
  if (!current) {
    const reason = "No live run exists for completion";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", reason };
  }
  if (current.stop_reason === "cancelled") {
    const reason = "Cancellation already requested; Done cannot replace cancellation intent";
    markEvent(database, event.event_id, "ignored", reason);
    return { eventId: event.event_id, action: "ignored", runId: current.run_id, reason };
  }
  const previewEvidenceSatisfied =
    current.preview_required === 1 &&
    current.preview_lease_state === "running" &&
    current.preview_lease_id !== null &&
    current.preview_reviewed_at !== null &&
    current.ci_head_sha !== null &&
    current.preview_verified_head_sha === current.ci_head_sha;
  if (current.preview_required === 1 && !previewEvidenceSatisfied) {
    database
      .prepare(`
        UPDATE runs
        SET completion_requested_at = COALESCE(
              completion_requested_at,
              strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ),
            completion_source_event_id = COALESCE(completion_source_event_id, ?),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ?
      `)
      .run(event.event_id, current.run_id);
    appendHistory(
      database,
      current.run_id,
      current.state,
      current.state,
      "completion_deferred_preview_required",
      event.event_id,
      {
        label: current.preview_required_label,
        currentHeadSha: current.ci_head_sha,
        previewLeaseId: current.preview_lease_id,
        previewState: current.preview_lease_state,
        previewHeadSha: current.preview_verified_head_sha,
        reviewed: current.preview_reviewed_at !== null,
      },
    );
    markEvent(
      database,
      event.event_id,
      "processed",
      "Completion deferred until exact preview is reviewed",
    );
    return {
      eventId: event.event_id,
      action: "ignored",
      runId: current.run_id,
      reason: "preview_required",
    };
  }
  const nextState =
    current.execution_mode === "dry_run" || current.resource_state === "planned"
      ? "archived"
      : "stopping";
  database
    .prepare(`
      UPDATE runs
      SET state = ?, stop_reason = 'completed',
          preview_requirement_satisfied_at = CASE
            WHEN preview_required = 1 THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
            ELSE preview_requirement_satisfied_at
          END,
          preview_requirement_lease_id = CASE
            WHEN preview_required = 1 THEN ? ELSE preview_requirement_lease_id
          END,
          owner_state = CASE WHEN ? = 'archived' THEN 'none' ELSE owner_state END,
          archived_at = CASE WHEN ? = 'archived' THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE archived_at END,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE run_id = ?
    `)
    .run(
      nextState,
      previewEvidenceSatisfied ? current.preview_lease_id : null,
      nextState,
      nextState,
      current.run_id,
    );
  if (nextState === "archived") {
    database
      .prepare(`
        UPDATE run_resources
        SET resource_state = 'released',
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE run_id = ? AND resource_state = 'planned'
      `)
      .run(current.run_id);
  }
  appendHistory(
    database,
    current.run_id,
    current.state,
    nextState,
    "owner_moved_item_to_done",
    event.event_id,
    { fromStatus: event.from_status, toStatus: event.to_status },
  );
  markEvent(database, event.event_id, "processed", `Run moved to ${nextState}`);
  return {
    eventId: event.event_id,
    action: nextState === "stopping" ? "stopping" : "ignored",
    runId: current.run_id,
    reason: nextState === "archived" ? "completed_without_resources" : undefined,
  };
}

async function main(): Promise<void> {
  const [projects, baseConfig] = await Promise.all([
    loadYaml<ProjectsRegistry>(projectsPath),
    loadYaml<OrchestratorConfig>(orchestratorConfigPath),
  ]);

  if (projects.version !== 1 || baseConfig.version !== 1) {
    fail("Unsupported projects or orchestrator config version");
  }
  validateResourceGuardLimits(baseConfig.limits);
  const database = new DatabaseSync(databasePath, { timeout: 5_000 });
  const results: EventResult[] = [];

  try {
    database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    database.exec("BEGIN IMMEDIATE");
    try {
      const config = effectiveOrchestratorConfig(
        database,
        baseConfig,
        Object.keys(projects.projects),
      );
      const maximumProjectWip = Math.max(
        ...Object.values(config.limits.max_active_by_project),
      );
      if (
        config.limits.max_managed_worktrees_global < config.limits.max_active_global ||
        config.limits.max_managed_worktrees_per_project < maximumProjectWip
      ) {
        fail("Managed worktree limits cannot be lower than active-run limits");
      }
      let resourceGuard = inspectResourceGuard(
        database,
        projects,
        config.limits,
        orchestratorHome,
      );
      reconcileResourceQuarantines(
        database,
        resourceGuard.observations,
        config.limits,
      );
      resourceGuard = inspectResourceGuard(
        database,
        projects,
        config.limits,
        orchestratorHome,
      );
      const events = database
        .prepare(`
          SELECT event_id, observed_at, project, item_id, content_id,
                 content_type, repository, issue_number, title, from_status,
                 to_status, payload_json
          FROM project_events
          WHERE processing_state = 'pending'
          ORDER BY observed_at, created_at, event_id
        `)
        .all() as EventRow[];

      for (const event of events) {
        const project = projects.projects[event.project];
        if (!project) {
          const reason = `Unknown project: ${event.project}`;
          markEvent(database, event.event_id, "ignored", reason);
          results.push({ eventId: event.event_id, action: "ignored", reason });
          continue;
        }

        if (
          event.to_status === project.statuses.active &&
          event.from_status !== project.statuses.active
        ) {
          results.push(
            createRun(database, event, project, config, resourceGuard),
          );
        } else if (event.to_status === project.statuses.review) {
          results.push(parkForReview(database, event));
        } else if (event.to_status === project.statuses.done) {
          results.push(completeRun(database, event));
        } else if (
          (event.from_status === project.statuses.active ||
            event.from_status === project.statuses.review) &&
          (event.to_status === project.statuses.backlog ||
            event.to_status === project.statuses.deferred)
        ) {
          results.push(cancelRun(database, event));
        } else {
          const reason = `Transition is outside Phase 2 activation/cancellation scope: ${event.from_status ?? "none"} -> ${event.to_status ?? "none"}`;
          markEvent(database, event.event_id, "ignored", reason);
          results.push({ eventId: event.event_id, action: "ignored", reason });
        }
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }

    if (process.env.CONSUMER_QUIET !== "1") {
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          mode: baseConfig.mode,
          processed: results.length,
          results,
          activeGlobal: activeCount(database),
        })}\n`,
      );
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

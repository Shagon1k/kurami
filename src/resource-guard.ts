import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  statfsSync,
} from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

export type ResourceGuardLimits = {
  max_managed_worktrees_global: number;
  max_managed_worktrees_per_project: number;
  disk_warning_percent: number;
  disk_admission_block_percent: number;
  disk_emergency_percent: number;
  orphan_grace_minutes: number;
  quarantine_review_after_days: number;
  max_delivery_attempts: number;
};

export type ResourceGuardProjects = {
  version: number;
  projects: Record<
    string,
    {
      workspace: { worktree_root: string };
    }
  >;
};

export type ResourceObservation = {
  resourceType: "worktree" | "tmux";
  resourceKey: string;
  project: string | null;
  runId: string | null;
  reason: string;
  evidence: Record<string, unknown>;
};

type ActiveQuarantine = {
  quarantine_state: "observed" | "quarantined";
  quarantined_at: string | null;
};

export type ResourceGuardInventory = {
  diskUsedPercent: number;
  diskAvailableGiB: number;
  worktreesByProject: Record<string, number>;
  observations: ResourceObservation[];
  activeQuarantines: ActiveQuarantine[];
};

export type ResourceGuardAnalysis = {
  disk: {
    usedPercent: number;
    availableGiB: number;
    state: "normal" | "warning" | "blocked" | "emergency";
  };
  worktrees: {
    global: number;
    byProject: Record<string, number>;
    maxGlobal: number;
    maxPerProject: number;
  };
  observations: ResourceObservation[];
  quarantines: {
    observed: number;
    quarantined: number;
    reviewDue: number;
  };
  admissionBlocked: boolean;
  blockReasons: string[];
  warnings: string[];
};

type ResourceRow = {
  run_id: string;
  project: string;
  run_state: string;
  owner_state: string;
  resource_state: string;
  worktree_path: string | null;
  tmux_session_name: string | null;
  updated_at: string;
};

type QuarantineRow = {
  quarantine_id: string;
  resource_type: "worktree" | "tmux";
  resource_key: string;
  project: string | null;
  run_id: string | null;
  quarantine_state: "observed" | "quarantined" | "resolved";
  reason: string;
  first_observed_at: string;
  quarantined_at: string | null;
};

type ResourceGuardEventKind =
  | "observed"
  | "quarantined"
  | "review_due"
  | "resolved";

const gibibyte = 1024 ** 3;
const managedTmuxPattern = /^cx-[a-z0-9-]+$/u;

function fail(message: string): never {
  throw new Error(message);
}

export function validateResourceGuardLimits(
  limits: ResourceGuardLimits,
): void {
  const integers: Array<[string, number, number, number]> = [
    ["max_managed_worktrees_global", limits.max_managed_worktrees_global, 1, 100],
    [
      "max_managed_worktrees_per_project",
      limits.max_managed_worktrees_per_project,
      1,
      100,
    ],
    ["orphan_grace_minutes", limits.orphan_grace_minutes, 5, 1440],
    ["quarantine_review_after_days", limits.quarantine_review_after_days, 1, 90],
    ["max_delivery_attempts", limits.max_delivery_attempts, 1, 5],
  ];
  for (const [name, value, minimum, maximum] of integers) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      fail(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
  }
  if (
    !Number.isInteger(limits.disk_warning_percent) ||
    !Number.isInteger(limits.disk_admission_block_percent) ||
    !Number.isInteger(limits.disk_emergency_percent) ||
    limits.disk_warning_percent < 1 ||
    limits.disk_warning_percent >= limits.disk_admission_block_percent ||
    limits.disk_admission_block_percent >= limits.disk_emergency_percent ||
    limits.disk_emergency_percent > 99
  ) {
    fail("Disk thresholds must be ordered integers: warning < block < emergency <= 99");
  }
  if (
    limits.max_managed_worktrees_per_project >
    limits.max_managed_worktrees_global
  ) {
    fail("Per-project worktree limit cannot exceed the global limit");
  }
}

function rounded(value: number): number {
  return Math.round(value * 10) / 10;
}

export function analyzeResourceGuard(
  inventory: ResourceGuardInventory,
  limits: ResourceGuardLimits,
  nowMs = Date.now(),
): ResourceGuardAnalysis {
  validateResourceGuardLimits(limits);
  const globalWorktrees = Object.values(inventory.worktreesByProject).reduce(
    (sum, count) => sum + count,
    0,
  );
  const blockReasons: string[] = [];
  const warnings: string[] = [];
  let diskState: ResourceGuardAnalysis["disk"]["state"] = "normal";
  if (inventory.diskUsedPercent >= limits.disk_emergency_percent) {
    diskState = "emergency";
    warnings.push(`Disk emergency threshold reached: ${rounded(inventory.diskUsedPercent)}%`);
  } else if (
    inventory.diskUsedPercent >= limits.disk_admission_block_percent
  ) {
    diskState = "blocked";
  } else if (inventory.diskUsedPercent >= limits.disk_warning_percent) {
    diskState = "warning";
  }
  if (diskState !== "normal") {
    warnings.push(`Disk usage is ${rounded(inventory.diskUsedPercent)}%`);
  }
  if (["blocked", "emergency"].includes(diskState)) {
    blockReasons.push(
      `Disk admission threshold reached: ${rounded(inventory.diskUsedPercent)}% >= ${limits.disk_admission_block_percent}%`,
    );
  }
  if (globalWorktrees >= limits.max_managed_worktrees_global) {
    blockReasons.push(
      `Managed worktree cap reached: ${globalWorktrees}/${limits.max_managed_worktrees_global}`,
    );
  }
  for (const [project, count] of Object.entries(inventory.worktreesByProject)) {
    if (count >= limits.max_managed_worktrees_per_project) {
      blockReasons.push(
        `Managed worktree cap reached for ${project}: ${count}/${limits.max_managed_worktrees_per_project}`,
      );
    }
  }
  if (inventory.observations.length > 0) {
    blockReasons.push(
      `Unresolved resource ambiguity: ${inventory.observations.length} observation(s)`,
    );
    warnings.push(
      ...inventory.observations.map(
        (observation) =>
          `${observation.resourceType}:${observation.resourceKey}: ${observation.reason}`,
      ),
    );
  }
  const observed = inventory.activeQuarantines.filter(
    (row) => row.quarantine_state === "observed",
  ).length;
  const quarantined = inventory.activeQuarantines.filter(
    (row) => row.quarantine_state === "quarantined",
  ).length;
  const reviewAfterMs = limits.quarantine_review_after_days * 86_400_000;
  const reviewDue = inventory.activeQuarantines.filter(
    (row) =>
      row.quarantine_state === "quarantined" &&
      row.quarantined_at !== null &&
      nowMs - Date.parse(row.quarantined_at) >= reviewAfterMs,
  ).length;
  if (quarantined > 0 && inventory.observations.length === 0) {
    blockReasons.push(`Active resource quarantines: ${quarantined}`);
  }
  if (reviewDue > 0) warnings.push(`Resource quarantines due for owner review: ${reviewDue}`);

  return {
    disk: {
      usedPercent: rounded(inventory.diskUsedPercent),
      availableGiB: rounded(inventory.diskAvailableGiB),
      state: diskState,
    },
    worktrees: {
      global: globalWorktrees,
      byProject: inventory.worktreesByProject,
      maxGlobal: limits.max_managed_worktrees_global,
      maxPerProject: limits.max_managed_worktrees_per_project,
    },
    observations: inventory.observations,
    quarantines: { observed, quarantined, reviewDue },
    admissionBlocked: blockReasons.length > 0,
    blockReasons,
    warnings,
  };
}

function directoryNames(path: string): string[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function tmuxSessions(): string[] {
  const result = spawnSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return [];
    if (result.stderr.includes("no server running")) return [];
    fail(result.stderr.trim() || "Cannot list tmux sessions");
  }
  return result.stdout
    .split("\n")
    .map((value) => value.trim())
    .filter((value) => managedTmuxPattern.test(value))
    .sort();
}

function activeQuarantines(database: DatabaseSync): ActiveQuarantine[] {
  return database
    .prepare(
      `SELECT quarantine_state, quarantined_at
       FROM resource_quarantines
       WHERE quarantine_state <> 'resolved'
       ORDER BY resource_type, resource_key`,
    )
    .all() as ActiveQuarantine[];
}

function inventory(
  database: DatabaseSync,
  projects: ResourceGuardProjects,
  limits: ResourceGuardLimits,
  orchestratorHome: string,
  nowMs: number,
): ResourceGuardInventory {
  const rows = database
    .prepare(
      `SELECT rr.run_id, r.project, r.state AS run_state, r.owner_state,
              rr.resource_state, rr.worktree_path, rr.tmux_session_name,
              rr.updated_at
       FROM run_resources rr
       JOIN runs r USING (run_id)
       WHERE rr.resource_state NOT IN ('released', 'not_required')`,
    )
    .all() as ResourceRow[];
  const observations: ResourceObservation[] = [];
  const worktreesByProject: Record<string, number> = {};

  for (const [project, config] of Object.entries(projects.projects)) {
    const root = resolve(config.workspace.worktree_root);
    const actualParents = directoryNames(root).map((name) => resolve(root, name));
    worktreesByProject[project] = actualParents.length;
    const expectedParents = new Set(
      rows
        .filter((row) => row.project === project && row.worktree_path !== null)
        .map((row) => dirname(resolve(row.worktree_path!)))
        .filter((path) => {
          const child = relative(root, path);
          return child !== "" && !child.startsWith("..") && resolve(root, child) === path;
        }),
    );
    for (const path of actualParents) {
      if (!expectedParents.has(path)) {
        observations.push({
          resourceType: "worktree",
          resourceKey: path,
          project,
          runId: null,
          reason: "unmapped_worktree_directory",
          evidence: { root, path },
        });
      }
    }
  }

  const graceMs = limits.orphan_grace_minutes * 60_000;
  for (const row of rows) {
    if (!row.worktree_path) continue;
    const updatedMs = Date.parse(row.updated_at);
    const oldEnough = Number.isFinite(updatedMs) && nowMs - updatedMs >= graceMs;
    const shouldExist =
      ["provisioned", "partial", "releasing"].includes(row.resource_state) ||
      (row.resource_state === "provisioning" && oldEnough);
    if (shouldExist && !existsSync(resolve(row.worktree_path))) {
      observations.push({
        resourceType: "worktree",
        resourceKey: resolve(row.worktree_path),
        project: row.project,
        runId: row.run_id,
        reason: "mapped_worktree_missing",
        evidence: { resourceState: row.resource_state, updatedAt: row.updated_at },
      });
    }
  }

  const expectedTmux = new Set(
    rows.map((row) => row.tmux_session_name).filter((name): name is string => Boolean(name)),
  );
  for (const session of tmuxSessions()) {
    if (!expectedTmux.has(session)) {
      observations.push({
        resourceType: "tmux",
        resourceKey: session,
        project: null,
        runId: null,
        reason: "unmapped_managed_tmux_session",
        evidence: { session },
      });
    }
  }

  const filesystem = statfsSync(resolve(orchestratorHome));
  const totalBytes = filesystem.blocks * filesystem.bsize;
  const availableBytes = filesystem.bavail * filesystem.bsize;
  return {
    diskUsedPercent: totalBytes === 0 ? 100 : ((totalBytes - availableBytes) / totalBytes) * 100,
    diskAvailableGiB: availableBytes / gibibyte,
    worktreesByProject,
    observations: observations.sort((left, right) =>
      `${left.resourceType}:${left.resourceKey}`.localeCompare(
        `${right.resourceType}:${right.resourceKey}`,
      ),
    ),
    activeQuarantines: activeQuarantines(database),
  };
}

export function inspectResourceGuard(
  database: DatabaseSync,
  projects: ResourceGuardProjects,
  limits: ResourceGuardLimits,
  orchestratorHome: string,
  nowMs = Date.now(),
): ResourceGuardAnalysis {
  validateResourceGuardLimits(limits);
  return analyzeResourceGuard(
    inventory(database, projects, limits, orchestratorHome, nowMs),
    limits,
    nowMs,
  );
}

function quarantineId(resourceType: string, resourceKey: string): string {
  return `rq_${createHash("sha256")
    .update(`${resourceType}\0${resourceKey}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function resourceGuardEventId(
  quarantineIdValue: string,
  lifecycleStartedAt: string,
  eventKind: ResourceGuardEventKind,
): string {
  return `rge_${createHash("sha256")
    .update(`${quarantineIdValue}\0${lifecycleStartedAt}\0${eventKind}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function recordResourceGuardEvent(
  database: DatabaseSync,
  source: {
    quarantineId: string;
    lifecycleStartedAt: string;
    resourceType: "worktree" | "tmux";
    resourceKey: string;
    project: string | null;
    runId: string | null;
    reason: string;
  },
  eventKind: ResourceGuardEventKind,
  eventAt: string,
): void {
  database
    .prepare(
      `INSERT OR IGNORE INTO resource_guard_events (
         event_id, quarantine_id, lifecycle_started_at, event_kind,
         resource_type, resource_key, project, run_id, reason, event_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      resourceGuardEventId(
        source.quarantineId,
        source.lifecycleStartedAt,
        eventKind,
      ),
      source.quarantineId,
      source.lifecycleStartedAt,
      eventKind,
      source.resourceType,
      source.resourceKey,
      source.project,
      source.runId,
      source.reason,
      eventAt,
    );
}

function recordActiveLifecycleEvents(
  database: DatabaseSync,
  source: Parameters<typeof recordResourceGuardEvent>[1],
  quarantineState: "observed" | "quarantined",
  quarantinedAt: string | null,
  limits: ResourceGuardLimits,
  nowMs: number,
): void {
  recordResourceGuardEvent(
    database,
    source,
    "observed",
    source.lifecycleStartedAt,
  );
  if (quarantineState !== "quarantined" || quarantinedAt === null) return;
  recordResourceGuardEvent(database, source, "quarantined", quarantinedAt);
  const reviewAtMs =
    Date.parse(quarantinedAt) +
    limits.quarantine_review_after_days * 86_400_000;
  if (Number.isFinite(reviewAtMs) && nowMs >= reviewAtMs) {
    recordResourceGuardEvent(
      database,
      source,
      "review_due",
      new Date(reviewAtMs).toISOString(),
    );
  }
}

export function reconcileResourceQuarantines(
  database: DatabaseSync,
  observations: ResourceObservation[],
  limits: ResourceGuardLimits,
  nowMs = Date.now(),
): void {
  validateResourceGuardLimits(limits);
  const now = new Date(nowMs).toISOString();
  const graceMs = limits.orphan_grace_minutes * 60_000;
  const currentKeys = new Set(
    observations.map(
      (observation) => `${observation.resourceType}\0${observation.resourceKey}`,
    ),
  );
  const select = database.prepare(
    `SELECT quarantine_id, resource_type, resource_key, project, run_id,
            quarantine_state, reason, first_observed_at, quarantined_at
     FROM resource_quarantines
     WHERE resource_type = ? AND resource_key = ?`,
  );
  for (const observation of observations) {
    const existing = select.get(
      observation.resourceType,
      observation.resourceKey,
    ) as QuarantineRow | undefined;
    if (!existing || existing.quarantine_state === "resolved") {
      const quarantineIdValue = quarantineId(
        observation.resourceType,
        observation.resourceKey,
      );
      database
        .prepare(
          `INSERT INTO resource_quarantines (
             quarantine_id, resource_type, resource_key, project, run_id,
             quarantine_state, reason, evidence_json,
             first_observed_at, last_observed_at
           ) VALUES (?, ?, ?, ?, ?, 'observed', ?, ?, ?, ?)
           ON CONFLICT(resource_type, resource_key) DO UPDATE SET
             project=excluded.project, run_id=excluded.run_id,
             quarantine_state='observed', reason=excluded.reason,
             evidence_json=excluded.evidence_json,
             first_observed_at=excluded.first_observed_at,
             last_observed_at=excluded.last_observed_at,
             quarantined_at=NULL, resolved_at=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        )
        .run(
          quarantineIdValue,
          observation.resourceType,
          observation.resourceKey,
          observation.project,
          observation.runId,
          observation.reason,
          JSON.stringify(observation.evidence),
          now,
          now,
        );
      recordActiveLifecycleEvents(
        database,
        {
          quarantineId: quarantineIdValue,
          lifecycleStartedAt: now,
          resourceType: observation.resourceType,
          resourceKey: observation.resourceKey,
          project: observation.project,
          runId: observation.runId,
          reason: observation.reason,
        },
        "observed",
        null,
        limits,
        nowMs,
      );
      continue;
    }
    const firstMs = Date.parse(existing.first_observed_at);
    const shouldQuarantine =
      existing.quarantine_state === "quarantined" ||
      (Number.isFinite(firstMs) && nowMs - firstMs >= graceMs);
    database
      .prepare(
        `UPDATE resource_quarantines
         SET project=?, run_id=?, quarantine_state=?, reason=?, evidence_json=?,
             last_observed_at=?,
             quarantined_at=CASE
               WHEN ?='quarantined' THEN COALESCE(quarantined_at, ?)
               ELSE NULL
             END,
             resolved_at=NULL,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE quarantine_id=?`,
      )
      .run(
        observation.project,
        observation.runId,
        shouldQuarantine ? "quarantined" : "observed",
        observation.reason,
        JSON.stringify(observation.evidence),
        now,
        shouldQuarantine ? "quarantined" : "observed",
        now,
        existing.quarantine_id,
      );
    const quarantineState = shouldQuarantine ? "quarantined" : "observed";
    const quarantinedAt = shouldQuarantine
      ? existing.quarantined_at ?? now
      : null;
    recordActiveLifecycleEvents(
      database,
      {
        quarantineId: existing.quarantine_id,
        lifecycleStartedAt: existing.first_observed_at,
        resourceType: observation.resourceType,
        resourceKey: observation.resourceKey,
        project: observation.project,
        runId: observation.runId,
        reason: observation.reason,
      },
      quarantineState,
      quarantinedAt,
      limits,
      nowMs,
    );
  }

  const active = database
    .prepare(
      `SELECT quarantine_id, resource_type, resource_key, project, run_id,
              quarantine_state, reason, first_observed_at, quarantined_at
       FROM resource_quarantines
       WHERE quarantine_state <> 'resolved'`,
    )
    .all() as QuarantineRow[];
  const resolveStatement = database.prepare(
    `UPDATE resource_quarantines
     SET quarantine_state='resolved', resolved_at=?, last_observed_at=?,
         updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
     WHERE quarantine_id=? AND quarantine_state <> 'resolved'`,
  );
  for (const row of active) {
    if (!currentKeys.has(`${row.resource_type}\0${row.resource_key}`)) {
      if (row.quarantine_state === "resolved") {
        fail(`Resolved quarantine returned as active: ${row.quarantine_id}`);
      }
      resolveStatement.run(now, now, row.quarantine_id);
      const source = {
        quarantineId: row.quarantine_id,
        lifecycleStartedAt: row.first_observed_at,
        resourceType: row.resource_type,
        resourceKey: row.resource_key,
        project: row.project,
        runId: row.run_id,
        reason: row.reason,
      };
      recordActiveLifecycleEvents(
        database,
        source,
        row.quarantine_state,
        row.quarantined_at,
        limits,
        nowMs,
      );
      recordResourceGuardEvent(database, source, "resolved", now);
    }
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  if (args.some((arg) => arg !== "--apply")) {
    fail("Usage: resource-guard.ts [--apply]");
  }
  const orchestratorHome = resolve(
    process.env.KURAMI_HOME ?? process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const [projects, config] = await Promise.all([
    readFile(resolve(orchestratorHome, "config/projects.yaml"), "utf8").then(
      (content) => parse(content) as ResourceGuardProjects,
    ),
    readFile(resolve(orchestratorHome, "config/orchestrator.yaml"), "utf8").then(
      (content) => parse(content) as { version: number; limits: ResourceGuardLimits },
    ),
  ]);
  if (projects.version !== 1 || config.version !== 1) fail("Unsupported config version");
  validateResourceGuardLimits(config.limits);
  const database = new DatabaseSync(resolve(orchestratorHome, "state/orchestrator.db"), {
    timeout: 5_000,
  });
  try {
    database.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    let result = inspectResourceGuard(
      database,
      projects,
      config.limits,
      orchestratorHome,
    );
    if (apply) {
      database.exec("BEGIN IMMEDIATE");
      try {
        reconcileResourceQuarantines(
          database,
          result.observations,
          config.limits,
        );
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      result = inspectResourceGuard(
        database,
        projects,
        config.limits,
        orchestratorHome,
      );
    }
    process.stdout.write(`${JSON.stringify({ ok: true, apply, ...result })}\n`);
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}

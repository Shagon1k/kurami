import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";

export type RuntimeSettings = {
  version: 1;
  max_llm_running_global: number;
  max_active_global: number;
  project_wip: Record<string, number>;
  max_previews_global: number;
  max_preview_builds_global: number;
  preview_ttl_hours: number;
};

export type RuntimeSettingsBaseConfig = {
  version: number;
  mode: "dry_run" | "live";
  limits: {
    max_llm_running_global: number;
    max_active_global: number;
    max_active_per_project: number;
    max_tmux_sessions_global: number;
    max_managed_worktrees_global: number;
    max_managed_worktrees_per_project: number;
    max_previews_global: number;
    max_preview_builds_global: number;
    preview_ttl_hours: number;
    preview_expiry_warning_hours: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type RuntimeSettingsProjects = {
  version: number;
  projects: Record<string, unknown>;
};

export type EffectiveRuntimeLimits = {
  max_llm_running_global: number;
  max_active_global: number;
  max_active_by_project: Record<string, number>;
  max_previews_global: number;
  max_preview_builds_global: number;
  preview_ttl_hours: number;
};

export type RuntimeSettingsSnapshot = {
  revision: number;
  settings: RuntimeSettings;
  defaults: RuntimeSettings;
  source: "defaults" | "runtime_override";
  appliedAt: string | null;
  actorId: string | null;
  action: "apply" | "reset" | "rollback" | null;
};

export type SettingsIdleInspection = {
  idle: boolean;
  reasons: string[];
  counts: {
    nonTerminalRuns: number;
    liveResources: number;
    activePreviews: number;
    pendingControls: number;
    pendingEvents: number;
    activeAiReviews: number;
    activeCiRepairs: number;
    activeReviewFixes: number;
    activeMetadataWorkers: number;
    activeSuccessions: number;
    managedTmuxSessions: number;
  };
};

type RevisionRow = {
  revision: number;
  action: "apply" | "reset" | "rollback";
  settings_json: string;
  previous_settings_json: string;
  settings_sha256: string;
  actor_id: string;
  applied_at: string;
};

function fail(message: string): never {
  throw new Error(message);
}

function integer(value: unknown, name: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    fail(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return Number(value);
}

function sortedProjectNames(projectNames: readonly string[]): string[] {
  const names = [...new Set(projectNames)].sort();
  if (names.length === 0 || names.some((name) => !/^[a-z0-9-]+$/u.test(name))) {
    fail("Projects registry contains no valid projects");
  }
  return names;
}

export function canonicalRuntimeSettings(settings: RuntimeSettings): string {
  return JSON.stringify({
    version: 1,
    max_llm_running_global: settings.max_llm_running_global,
    max_active_global: settings.max_active_global,
    project_wip: Object.fromEntries(
      Object.entries(settings.project_wip).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    max_previews_global: settings.max_previews_global,
    max_preview_builds_global: settings.max_preview_builds_global,
    preview_ttl_hours: settings.preview_ttl_hours,
  });
}

export function runtimeSettingsHash(settingsJson: string): string {
  return createHash("sha256").update(settingsJson).digest("hex");
}

export function defaultRuntimeSettings(
  base: RuntimeSettingsBaseConfig,
  projectNames: readonly string[],
): RuntimeSettings {
  const names = sortedProjectNames(projectNames);
  return {
    version: 1,
    max_llm_running_global: base.limits.max_llm_running_global,
    max_active_global: base.limits.max_active_global,
    project_wip: Object.fromEntries(
      names.map((name) => [name, base.limits.max_active_per_project]),
    ),
    max_previews_global: base.limits.max_previews_global,
    max_preview_builds_global: base.limits.max_preview_builds_global,
    preview_ttl_hours: base.limits.preview_ttl_hours,
  };
}

export function normalizeRuntimeSettings(
  value: unknown,
  base: RuntimeSettingsBaseConfig,
  projectNames: readonly string[],
): RuntimeSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("Runtime settings must be an object");
  }
  const raw = value as Record<string, unknown>;
  if (raw.version !== 1) fail("Unsupported runtime settings version");
  const projectWip = raw.project_wip;
  if (!projectWip || typeof projectWip !== "object" || Array.isArray(projectWip)) {
    fail("project_wip must be an object");
  }
  const names = sortedProjectNames(projectNames);
  const settings: RuntimeSettings = {
    version: 1,
    max_llm_running_global: integer(raw.max_llm_running_global, "max_llm_running_global", 1, 3),
    max_active_global: integer(raw.max_active_global, "max_active_global", 1, 6),
    project_wip: Object.fromEntries(
      names.map((name) => [
        name,
        integer(
          (projectWip as Record<string, unknown>)[name],
          `project_wip.${name}`,
          1,
          3,
        ),
      ]),
    ),
    max_previews_global: integer(raw.max_previews_global, "max_previews_global", 1, 6),
    max_preview_builds_global: integer(
      raw.max_preview_builds_global,
      "max_preview_builds_global",
      1,
      2,
    ),
    preview_ttl_hours: integer(raw.preview_ttl_hours, "preview_ttl_hours", 6, 72),
  };
  validateRuntimeSettings(settings, base, names);
  return settings;
}

export function validateRuntimeSettings(
  settings: RuntimeSettings,
  base: RuntimeSettingsBaseConfig,
  projectNames: readonly string[],
): void {
  const names = sortedProjectNames(projectNames);
  if (settings.max_llm_running_global > base.limits.max_tmux_sessions_global) {
    fail("LLM limit cannot exceed managed tmux capacity");
  }
  if (settings.max_active_global > base.limits.max_managed_worktrees_global) {
    fail("Global WIP cannot exceed managed worktree capacity");
  }
  for (const name of names) {
    const value = settings.project_wip[name];
    integer(value, `project_wip.${name}`, 1, 3);
    if (value > settings.max_active_global) {
      fail(`Project WIP for ${name} cannot exceed Global WIP`);
    }
    if (value > base.limits.max_managed_worktrees_per_project) {
      fail(`Project WIP for ${name} cannot exceed per-project worktree capacity`);
    }
  }
  if (settings.max_preview_builds_global > settings.max_previews_global) {
    fail("Concurrent preview builds cannot exceed active previews");
  }
  if (settings.preview_ttl_hours <= base.limits.preview_expiry_warning_hours) {
    fail("Preview lifetime must exceed its expiry warning window");
  }
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(table),
  );
}

export function currentRuntimeSettings(
  database: DatabaseSync,
  base: RuntimeSettingsBaseConfig,
  projectNames: readonly string[],
): RuntimeSettingsSnapshot {
  const defaults = normalizeRuntimeSettings(
    defaultRuntimeSettings(base, projectNames),
    base,
    projectNames,
  );
  if (!tableExists(database, "orchestrator_setting_revisions")) {
    return {
      revision: 0,
      settings: defaults,
      defaults,
      source: "defaults",
      appliedAt: null,
      actorId: null,
      action: null,
    };
  }
  const row = database
    .prepare(`
      SELECT revision, action, settings_json, previous_settings_json,
             settings_sha256, actor_id, applied_at
      FROM orchestrator_setting_revisions
      ORDER BY revision DESC
      LIMIT 1
    `)
    .get() as RevisionRow | undefined;
  if (!row) {
    return {
      revision: 0,
      settings: defaults,
      defaults,
      source: "defaults",
      appliedAt: null,
      actorId: null,
      action: null,
    };
  }
  if (runtimeSettingsHash(row.settings_json) !== row.settings_sha256) {
    fail("Runtime settings revision checksum does not match");
  }
  const parsed = JSON.parse(row.settings_json) as unknown;
  const settings = normalizeRuntimeSettings(parsed, base, projectNames);
  return {
    revision: row.revision,
    settings,
    defaults,
    source: "runtime_override",
    appliedAt: row.applied_at,
    actorId: row.actor_id,
    action: row.action,
  };
}

export function effectiveOrchestratorConfig<T extends RuntimeSettingsBaseConfig>(
  database: DatabaseSync,
  base: T,
  projectNames: readonly string[],
): T & { limits: T["limits"] & EffectiveRuntimeLimits } {
  const snapshot = currentRuntimeSettings(database, base, projectNames);
  return {
    ...base,
    limits: {
      ...base.limits,
      max_llm_running_global: snapshot.settings.max_llm_running_global,
      max_active_global: snapshot.settings.max_active_global,
      max_active_by_project: { ...snapshot.settings.project_wip },
      max_previews_global: snapshot.settings.max_previews_global,
      max_preview_builds_global: snapshot.settings.max_preview_builds_global,
      preview_ttl_hours: snapshot.settings.preview_ttl_hours,
    },
  };
}

export async function loadRuntimeSettingsInputs(
  orchestratorHome: string,
): Promise<{ base: RuntimeSettingsBaseConfig; projects: RuntimeSettingsProjects }> {
  const [base, projects] = await Promise.all([
    readFile(resolve(orchestratorHome, "config/orchestrator.yaml"), "utf8").then(
      (text) => parse(text) as RuntimeSettingsBaseConfig,
    ),
    readFile(resolve(orchestratorHome, "config/projects.yaml"), "utf8").then(
      (text) => parse(text) as RuntimeSettingsProjects,
    ),
  ]);
  if (base.version !== 1 || projects.version !== 1) fail("Unsupported config version");
  return { base, projects };
}

export async function loadEffectiveOrchestratorConfig<
  T extends RuntimeSettingsBaseConfig,
>(orchestratorHome: string): Promise<T & { limits: T["limits"] & EffectiveRuntimeLimits }> {
  const { base, projects } = await loadRuntimeSettingsInputs(orchestratorHome);
  const database = new DatabaseSync(resolve(orchestratorHome, "state/orchestrator.db"), {
    readOnly: true,
  });
  try {
    return effectiveOrchestratorConfig(
      database,
      base as T,
      Object.keys(projects.projects),
    );
  } finally {
    database.close();
  }
}

export function projectWipLimit(
  limits: { max_active_per_project: number; max_active_by_project?: Record<string, number> },
  project: string,
): number {
  return limits.max_active_by_project?.[project] ?? limits.max_active_per_project;
}

function count(database: DatabaseSync, sql: string, ...parameters: unknown[]): number {
  return Number(
    Object.values(database.prepare(sql).get(...(parameters as never[])) as object)[0] ?? 0,
  );
}

export function managedTmuxSessionCount(): number {
  const result = spawnSync(process.env.KURAMI_TMUX_BIN ?? "tmux", [
    "list-sessions",
    "-F",
    "#{session_name}",
  ], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    return result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /^cx-[a-z0-9-]+$/u.test(line)).length;
  }
  const detail = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.toLowerCase();
  if (result.status === 1 && detail.includes("no server running")) return 0;
  fail("Managed tmux inventory is unavailable");
}

export function inspectSettingsIdle(
  database: DatabaseSync,
  managedTmuxSessions = managedTmuxSessionCount(),
): SettingsIdleInspection {
  const counts = {
    nonTerminalRuns: count(
      database,
      "SELECT COUNT(*) AS n FROM runs WHERE state NOT IN ('archived','cancelled','rejected')",
    ),
    liveResources: count(
      database,
      "SELECT COUNT(*) AS n FROM run_resources WHERE resource_state IN ('provisioned','partial','releasing')",
    ),
    activePreviews: count(
      database,
      "SELECT COUNT(*) AS n FROM preview_leases WHERE state <> 'released'",
    ),
    pendingControls: count(
      database,
      "SELECT COUNT(*) AS n FROM run_control_requests WHERE request_state IN ('pending','processing')",
    ),
    pendingEvents: count(
      database,
      "SELECT COUNT(*) AS n FROM project_events WHERE processing_state='pending'",
    ),
    activeAiReviews: count(
      database,
      "SELECT COUNT(*) AS n FROM run_ai_reviews WHERE completed_at IS NULL",
    ),
    activeCiRepairs: count(
      database,
      "SELECT COUNT(*) AS n FROM run_ci_repair_attempts WHERE completed_at IS NULL",
    ),
    activeReviewFixes: count(
      database,
      "SELECT COUNT(*) AS n FROM run_review_fix_rounds WHERE completed_at IS NULL",
    ),
    activeMetadataWorkers: tableExists(database, "project_metadata_proposal_batches")
      ? count(
          database,
          "SELECT COUNT(*) AS n FROM project_metadata_proposal_batches WHERE batch_state IN ('planned','running')",
        )
      : 0,
    activeSuccessions: tableExists(database, "run_autonomous_successions")
      ? count(
          database,
          "SELECT COUNT(*) AS n FROM run_autonomous_successions WHERE completed_at IS NULL",
        )
      : 0,
    managedTmuxSessions,
  };
  const labels: Array<[keyof typeof counts, string]> = [
    ["nonTerminalRuns", "non-terminal runs"],
    ["liveResources", "managed resources"],
    ["activePreviews", "active previews"],
    ["pendingControls", "pending controls"],
    ["pendingEvents", "pending project events"],
    ["activeAiReviews", "AI reviews"],
    ["activeCiRepairs", "CI repairs"],
    ["activeReviewFixes", "review-fix rounds"],
    ["activeMetadataWorkers", "metadata workers"],
    ["activeSuccessions", "successor tasks"],
    ["managedTmuxSessions", "managed tmux sessions"],
  ];
  const reasons = labels
    .filter(([key]) => counts[key] > 0)
    .map(([key, label]) => `${label}: ${counts[key]}`);
  return { idle: reasons.length === 0, reasons, counts };
}

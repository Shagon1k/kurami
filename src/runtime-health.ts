import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import {
  inspectResourceGuard,
  validateResourceGuardLimits,
  type ResourceGuardAnalysis,
  type ResourceGuardLimits,
  type ResourceGuardProjects,
} from "./resource-guard.ts";

type ActiveLease = {
  lease_id: string;
  run_id: string;
  slot_number: number;
  lease_state: string;
  compose_project_name: string;
  run_state: string;
  preview_id: string | null;
  updated_at: string;
  expires_at: string | null;
  runtime_adapter: "compose" | "static";
  artifact_root: string | null;
};

export type PreviewHealthInput = {
  leases: ActiveLease[];
  dockerProjects: string[];
  runtimeDirectories: Array<{ name: string; ageMinutes: number }>;
  nowMs: number;
};

export type PreviewHealthAnalysis = {
  orphanDockerProjects: string[];
  missingDockerProjects: string[];
  missingStaticArtifacts: string[];
  failedLeases: string[];
  terminalRunLeases: string[];
  mappingMismatches: string[];
  expiredLeases: string[];
  orphanRuntimeDirectories: string[];
};

export type RuntimeHealthResult = {
  ok: boolean;
  checkedAt: string;
  databaseIntegrity: string;
  dockerRootless: boolean;
  activePreviewLeases: number;
  backupAgeHours: number | null;
  backupMaxAgeHours: number;
  backupFresh: boolean;
  preview: PreviewHealthAnalysis;
  resourceGuard: ResourceGuardAnalysis;
  problems: string[];
};

type CommandResult = {
  status: number | null;
  stdout: string;
  stderr: string;
};

const managedComposePattern = /^kurami-pv[1-6]-[a-z0-9]{10}$/;
const runtimeDirectoryPattern = /^r_[a-zA-Z0-9_]+$/;
const terminalRunStates = new Set(["rejected", "cancelled", "archived"]);
const transitionGraceMinutes = 20;
const defaultBackupMaxAgeHours = 84;

function run(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function fail(message: string): never {
  throw new Error(message);
}

function parseBackupMaxAgeHours(value: string | undefined): number {
  if (value === undefined) return defaultBackupMaxAgeHours;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 24 || parsed > 168) {
    fail("KURAMI_BACKUP_MAX_AGE_HOURS must be an integer between 24 and 168");
  }
  return parsed;
}

function formatVilniusTimestamp(value: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Vilnius",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((entry) => entry.type === type)?.value ?? "??";
  return `${part("day")}.${part("month")}.${part("year")} ${part("hour")}:${part("minute")}`;
}

export function formatHealthSummary(result: RuntimeHealthResult): string {
  const backupAge =
    result.backupAgeHours === null ? "missing" : `${result.backupAgeHours}h`;
  if (!result.ok) {
    return [
      "🚨 Kurami Orchestrator needs attention",
      ...result.problems.map((problem) => `- ${problem}`),
      `Checked: ${formatVilniusTimestamp(result.checkedAt)}`,
    ].join("\n");
  }
  return [
    "✅ Kurami Orchestrator healthy",
    `- SQLite: ${result.databaseIntegrity}`,
    `- Docker: ${result.dockerRootless ? "rootless" : "unexpected daemon"}`,
    `- Active previews: ${result.activePreviewLeases}`,
    `- Disk: ${result.resourceGuard.disk.usedPercent}% used (${result.resourceGuard.disk.availableGiB} GiB available)`,
    `- Managed worktrees: ${result.resourceGuard.worktrees.global}/${result.resourceGuard.worktrees.maxGlobal}`,
    `- Resource quarantines: ${result.resourceGuard.quarantines.quarantined}`,
    `- Backup age: ${backupAge} (limit ${result.backupMaxAgeHours}h)`,
    `- Checked: ${formatVilniusTimestamp(result.checkedAt)}`,
  ].join("\n");
}

export function analyzePreviewConsistency(
  input: PreviewHealthInput,
): PreviewHealthAnalysis {
  const dockerProjects = new Set(
    input.dockerProjects.filter((name) => managedComposePattern.test(name)),
  );
  const leasedProjects = new Set(
    input.leases
      .filter((lease) => lease.runtime_adapter === "compose")
      .map((lease) => lease.compose_project_name),
  );
  const activeRunIds = new Set(input.leases.map((lease) => lease.run_id));
  const runtimeRunIds = new Set(input.runtimeDirectories.map((entry) => entry.name));

  return {
    orphanDockerProjects: [...dockerProjects]
      .filter((project) => !leasedProjects.has(project))
      .sort(),
    missingDockerProjects: input.leases
      .filter(
        (lease) => {
          if (lease.runtime_adapter !== "compose") return false;
          if (dockerProjects.has(lease.compose_project_name)) return false;
          if (lease.lease_state === "running") return true;
          if (!["provisioning", "releasing"].includes(lease.lease_state)) {
            return false;
          }
          const updatedMs = Date.parse(lease.updated_at);
          return (
            Number.isFinite(updatedMs) &&
            (input.nowMs - updatedMs) / 60_000 >= transitionGraceMinutes
          );
        },
      )
      .map((lease) => lease.compose_project_name)
      .sort(),
    missingStaticArtifacts: input.leases
      .filter(
        (lease) =>
          lease.runtime_adapter === "static" &&
          lease.lease_state === "running" &&
          (!lease.artifact_root || !runtimeRunIds.has(lease.run_id)),
      )
      .map((lease) => lease.run_id)
      .sort(),
    failedLeases: input.leases
      .filter((lease) => lease.lease_state === "failed")
      .map((lease) => lease.run_id)
      .sort(),
    terminalRunLeases: input.leases
      .filter((lease) => terminalRunStates.has(lease.run_state))
      .map((lease) => lease.run_id)
      .sort(),
    mappingMismatches: input.leases
      .filter((lease) => lease.preview_id !== `preview-${lease.slot_number}`)
      .map((lease) => lease.run_id)
      .sort(),
    expiredLeases: input.leases
      .filter(
        (lease) =>
          lease.lease_state === "running" &&
          Boolean(lease.expires_at) &&
          Date.parse(lease.expires_at!) <= input.nowMs,
      )
      .map((lease) => lease.run_id)
      .sort(),
    orphanRuntimeDirectories: input.runtimeDirectories
      .filter(
        (directory) =>
          runtimeDirectoryPattern.test(directory.name) &&
          !activeRunIds.has(directory.name) &&
          directory.ageMinutes >= transitionGraceMinutes,
      )
      .map((directory) => directory.name)
      .sort(),
  };
}

async function directoryNames(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function runtimeDirectories(
  path: string,
): Promise<Array<{ name: string; ageMinutes: number }>> {
  const names = await directoryNames(path);
  return Promise.all(
    names.map(async (name) => {
      const metadata = await stat(resolve(path, name));
      return {
        name,
        ageMinutes: Math.max(0, (Date.now() - metadata.mtimeMs) / 60_000),
      };
    }),
  );
}

async function latestBackupAgeHours(orchestratorHome: string): Promise<number | null> {
  const root = resolve(orchestratorHome, "backups");
  const names = (await directoryNames(root))
    .filter((name) => /^backup-\d{8}T\d{6}Z$/.test(name))
    .sort()
    .reverse();
  if (!names[0]) return null;
  const metadata = await stat(resolve(root, names[0]));
  return Math.round(((Date.now() - metadata.mtimeMs) / 3_600_000) * 10) / 10;
}

function dockerInventory(): { rootless: boolean; projects: string[] } {
  const info = run("docker", ["info", "--format", "{{json .SecurityOptions}}"]);
  if (info.status !== 0) {
    fail(info.stderr.trim() || "Docker daemon is unavailable");
  }
  const list = run("docker", [
    "ps",
    "-a",
    "--filter",
    "label=com.docker.compose.project",
    "--format",
    '{{.Label "com.docker.compose.project"}}',
  ]);
  if (list.status !== 0) {
    fail(list.stderr.trim() || "Cannot list Docker Compose projects");
  }
  return {
    rootless: info.stdout.includes("name=rootless"),
    projects: [...new Set(list.stdout.split("\n").map((line) => line.trim()).filter(Boolean))],
  };
}

function activeLeases(database: DatabaseSync): ActiveLease[] {
  return database
    .prepare(`
      SELECT pl.lease_id, pl.run_id, pl.slot_number,
             pl.state AS lease_state, pl.compose_project_name,
             r.state AS run_state, rr.preview_id, pl.updated_at,
             pl.expires_at, pl.runtime_adapter, pl.artifact_root
      FROM preview_leases pl
      JOIN runs r USING (run_id)
      JOIN run_resources rr USING (run_id)
      WHERE pl.state <> 'released'
      ORDER BY pl.slot_number
    `)
    .all() as ActiveLease[];
}

function problemCount(analysis: PreviewHealthAnalysis): number {
  return Object.values(analysis).reduce((count, values) => count + values.length, 0);
}

export async function inspectRuntimeHealth(
  orchestratorHome: string,
): Promise<RuntimeHealthResult> {
  const home = resolve(orchestratorHome);
  const [projects, config] = await Promise.all([
    readFile(resolve(home, "config/projects.yaml"), "utf8").then(
      (content) => parse(content) as ResourceGuardProjects,
    ),
    readFile(resolve(home, "config/orchestrator.yaml"), "utf8").then(
      (content) => parse(content) as { version: number; limits: ResourceGuardLimits },
    ),
  ]);
  if (projects.version !== 1 || config.version !== 1) fail("Unsupported config version");
  validateResourceGuardLimits(config.limits);
  const database = new DatabaseSync(resolve(home, "state/orchestrator.db"), {
    readOnly: true,
    timeout: 5_000,
  });
  let integrity = "unknown";
  let leases: ActiveLease[] = [];
  let resourceGuard: ResourceGuardAnalysis;
  try {
    database.exec("PRAGMA busy_timeout = 5000");
    integrity = (
      database.prepare("PRAGMA quick_check").get() as { quick_check: string }
    ).quick_check;
    leases = activeLeases(database);
    resourceGuard = inspectResourceGuard(
      database,
      projects,
      config.limits,
      home,
    );
  } finally {
    database.close();
  }

  const docker = dockerInventory();
  const runtimeDirectoryInventory = await runtimeDirectories(
    resolve(home, "state/previews"),
  );
  const preview = analyzePreviewConsistency({
    leases,
    dockerProjects: docker.projects,
    runtimeDirectories: runtimeDirectoryInventory,
    nowMs: Date.now(),
  });
  const backupAgeHours = await latestBackupAgeHours(home);
  const backupMaxAgeHours = parseBackupMaxAgeHours(
    process.env.KURAMI_BACKUP_MAX_AGE_HOURS,
  );
  const backupFresh =
    backupAgeHours !== null && backupAgeHours <= backupMaxAgeHours;
  const problems: string[] = [];
  if (integrity !== "ok") problems.push(`SQLite quick_check: ${integrity}`);
  if (!docker.rootless) problems.push("Docker daemon is not rootless");
  if (!backupFresh) {
    problems.push(
      backupAgeHours === null
        ? "No state backup exists"
        : `Latest state backup is ${backupAgeHours}h old`,
    );
  }
  if (problemCount(preview) > 0) {
    for (const [kind, values] of Object.entries(preview)) {
      if (values.length > 0) problems.push(`${kind}: ${values.join(", ")}`);
    }
  }
  for (const problem of new Set([
    ...resourceGuard.blockReasons,
    ...resourceGuard.warnings,
  ])) {
    problems.push(problem);
  }

  return {
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    databaseIntegrity: integrity,
    dockerRootless: docker.rootless,
    activePreviewLeases: leases.length,
    backupAgeHours,
    backupMaxAgeHours,
    backupFresh,
    preview,
    resourceGuard,
    problems,
  };
}

async function main(): Promise<void> {
  const alertText = process.argv.includes("--alert-text");
  const summaryText = process.argv.includes("--summary-text");
  const unknown = process.argv
    .slice(2)
    .filter((arg) => !["--alert-text", "--summary-text"].includes(arg));
  if (unknown.length > 0 || (alertText && summaryText)) {
    fail("Usage: runtime-health.ts [--alert-text | --summary-text]");
  }
  const orchestratorHome = resolve(
    process.env.ORCHESTRATOR_HOME ?? resolve(import.meta.dirname, "../.."),
  );
  const result = await inspectRuntimeHealth(orchestratorHome);
  if (alertText) {
    if (!result.ok) {
      process.stdout.write(`${formatHealthSummary(result)}\n`);
      process.exitCode = 2;
    }
    return;
  }
  if (summaryText) {
    process.stdout.write(`${formatHealthSummary(result)}\n`);
    if (!result.ok) process.exitCode = 2;
    return;
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}

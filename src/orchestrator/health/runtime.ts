import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolveKuramiHome } from "../../core/kurami-home.ts";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import {
  inspectNetworkConnectivity,
  readNetworkSpeedSnapshot,
  type NetworkConnectivitySnapshot,
  type NetworkSpeedSnapshot,
} from "../../system/network/network-health.ts";
import {
  inspectResourceGuard,
  validateResourceGuardLimits,
  type ResourceGuardAnalysis,
  type ResourceGuardLimits,
  type ResourceGuardProjects,
} from "../resources/guard.ts";
import {
  assessServerHealth,
  evaluateHealthAlerts,
  formatUptime,
  inspectServerHealth,
  readHealthAlertState,
  resolveServerHealthConfig,
  stableProblemKey,
  writeHealthAlertState,
  type HealthAlertDecision,
  type HealthAlertIssue,
  type ServerHealthConfig,
  type ServerHealthSnapshot,
} from "../../system/health/server-health.ts";
import {
  calculateCpuRollingStatistics,
  readCpuStatistics,
  resolveCpuStatisticsConfig,
  type CpuRollingStatistics,
  type CpuStatisticsConfig,
} from "../../system/health/cpu-statistics.ts";

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
  containerRuntime: ContainerRuntimeSnapshot;
  topConsumers: TopConsumers;
  oomKillCount: number;
  oomKillsSincePreviousCheck: number;
  networkConnectivity: NetworkConnectivitySnapshot;
  networkSpeed: NetworkSpeedSnapshot | null;
  activePreviewLeases: number;
  backupAgeHours: number | null;
  backupMaxAgeHours: number;
  backupFresh: boolean;
  preview: PreviewHealthAnalysis;
  resourceGuard: ResourceGuardAnalysis;
  server: ServerHealthSnapshot;
  serverHealthConfig: ServerHealthConfig;
  cpuStatistics: CpuRollingStatistics;
  alertIssues: HealthAlertIssue[];
  problems: string[];
};

export type ContainerRuntimeSnapshot = {
  total: number;
  running: number;
  unhealthy: number;
};

export type ResourceConsumer = {
  name: string;
  cpuPercent: number;
  memoryPercent: number;
  rssMiB: number;
};

export type ContainerConsumer = {
  name: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsage: string;
};

export type TopConsumers = {
  cpu: ResourceConsumer | null;
  memory: ResourceConsumer | null;
  containerCpu: ContainerConsumer | null;
  containerMemory: ContainerConsumer | null;
};

type RuntimeHealthCounterState = {
  version: 1;
  oomKillCount: number;
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

function parsePercent(value: string): number {
  const parsed = Number.parseFloat(value.replace(/%$/u, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseProcessConsumer(line: string | undefined): ResourceConsumer | null {
  const fields = line?.trim().split(/\s+/u) ?? [];
  if (fields.length < 4) return null;
  const rssKiB = Number(fields.at(-1));
  const memoryPercent = Number(fields.at(-2));
  const cpuPercent = Number(fields.at(-3));
  const name = fields.slice(0, -3).join(" ");
  if (
    !name ||
    !Number.isFinite(rssKiB) ||
    !Number.isFinite(memoryPercent) ||
    !Number.isFinite(cpuPercent)
  ) {
    return null;
  }
  return {
    name,
    cpuPercent,
    memoryPercent,
    rssMiB: Math.round((rssKiB / 1024) * 10) / 10,
  };
}

function topProcessConsumers(): Pick<TopConsumers, "cpu" | "memory"> {
  const columns = ["-eo", "comm=,pcpu=,pmem=,rss="];
  const byCpu = run("ps", [...columns, "--sort=-pcpu"]);
  const byMemory = run("ps", [...columns, "--sort=-rss"]);
  return {
    cpu: byCpu.status === 0
      ? parseProcessConsumer(byCpu.stdout.split("\n").find(Boolean))
      : null,
    memory: byMemory.status === 0
      ? parseProcessConsumer(byMemory.stdout.split("\n").find(Boolean))
      : null,
  };
}

function parseContainerConsumer(line: string): ContainerConsumer | null {
  try {
    const value = JSON.parse(line) as {
      Name?: string;
      CPUPerc?: string;
      MemPerc?: string;
      MemUsage?: string;
    };
    if (!value.Name) return null;
    return {
      name: value.Name,
      cpuPercent: parsePercent(value.CPUPerc ?? "0"),
      memoryPercent: parsePercent(value.MemPerc ?? "0"),
      memoryUsage: value.MemUsage?.trim() || "unknown",
    };
  } catch {
    return null;
  }
}

function topContainerConsumers(): Pick<
  TopConsumers,
  "containerCpu" | "containerMemory"
> {
  const stats = run("docker", ["stats", "--no-stream", "--format", "{{json .}}"]);
  if (stats.status !== 0) return { containerCpu: null, containerMemory: null };
  const consumers = stats.stdout
    .split("\n")
    .filter(Boolean)
    .map(parseContainerConsumer)
    .filter((value): value is ContainerConsumer => value !== null);
  return {
    containerCpu: consumers.toSorted((left, right) => right.cpuPercent - left.cpuPercent)[0] ?? null,
    containerMemory:
      consumers.toSorted((left, right) => right.memoryPercent - left.memoryPercent)[0] ?? null,
  };
}

export function parseOomKillCount(content: string): number {
  const match = /^oom_kill\s+(\d+)$/mu.exec(content);
  if (!match) fail("/proc/vmstat does not contain oom_kill");
  return Number(match[1]);
}

async function readRuntimeHealthCounterState(
  path: string,
): Promise<RuntimeHealthCounterState | null> {
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<RuntimeHealthCounterState>;
    if (
      value.version === 1 &&
      Number.isInteger(value.oomKillCount) &&
      Number(value.oomKillCount) >= 0
    ) {
      return value as RuntimeHealthCounterState;
    }
    return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRuntimeHealthCounterState(
  path: string,
  oomKillCount: number,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ version: 1, oomKillCount })}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, path);
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
  const swap =
    result.server.swapTotalGiB === 0
      ? "off"
      : `${result.server.swapUsedGiB}/${result.server.swapTotalGiB} GiB`;
  return [
    result.ok ? "✅ Kurami system healthy" : "⚠️ Kurami system needs attention",
    `- Host: ${result.server.hostname} · uptime ${formatUptime(result.server.uptimeSeconds)}`,
    `- CPU: ${result.server.cpuUsedPercent}% · load ${result.server.loadAverage.join(" / ")} · ${result.server.cpuCores} cores`,
    `- RAM: ${result.server.memoryUsedPercent}% · ${result.server.memoryUsedGiB}/${result.server.memoryTotalGiB} GiB (${result.server.memoryAvailableGiB} GiB available)`,
    `- Swap: ${swap}`,
    `- Disk: ${result.resourceGuard.disk.usedPercent}% used (${result.resourceGuard.disk.availableGiB} GiB available)`,
    `- SQLite: ${result.databaseIntegrity}`,
    `- Docker: ${result.containerRuntime.running} up · ${result.containerRuntime.unhealthy} unhealthy`,
    `- Active previews: ${result.activePreviewLeases}`,
    `- Managed worktrees: ${result.resourceGuard.worktrees.global}/${result.resourceGuard.worktrees.maxGlobal}`,
    `- Resource quarantines: ${result.resourceGuard.quarantines.quarantined}`,
    `- Backup age: ${backupAge} (limit ${result.backupMaxAgeHours}h)`,
    ...(!result.ok ? result.problems.map((problem) => `- Issue: ${problem}`) : []),
    `- Checked: ${formatVilniusTimestamp(result.checkedAt)} Europe/Vilnius`,
  ].join("\n");
}

export function formatAlertNotification(
  result: RuntimeHealthResult,
  decision: HealthAlertDecision,
): string {
  const checked = formatVilniusTimestamp(result.checkedAt);
  if (decision.kind === "recovery") {
    return [
      "✅ Kurami system recovered",
      `- CPU: ${result.server.cpuUsedPercent}%`,
      `- RAM: ${result.server.memoryUsedPercent}% (${result.server.memoryAvailableGiB} GiB available)`,
      `- Disk: ${result.resourceGuard.disk.usedPercent}% (${result.resourceGuard.disk.availableGiB} GiB available)`,
      `- Checked: ${checked} Europe/Vilnius`,
    ].join("\n");
  }
  const issues = Object.values(decision.active);
  const critical = issues.some((issue) => issue.severity === "critical");
  const title =
    decision.kind === "reminder"
      ? "Kurami system health reminder"
      : "Kurami system health alert";
  return [
    `${critical ? "🚨" : "⚠️"} ${title}`,
    ...issues.map(
      (issue) => `- ${issue.severity === "critical" ? "CRITICAL" : "WARNING"}: ${issue.message}`,
    ),
    `- CPU: ${result.server.cpuUsedPercent}% · load ${result.server.loadAverage.join(" / ")}`,
    `- RAM: ${result.server.memoryUsedPercent}% (${result.server.memoryAvailableGiB} GiB available)`,
    `- Disk: ${result.resourceGuard.disk.usedPercent}% (${result.resourceGuard.disk.availableGiB} GiB available)`,
    `- Checked: ${checked} Europe/Vilnius`,
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

async function latestBackupAgeHours(kuramiHome: string): Promise<number | null> {
  const root = resolve(kuramiHome, "backups");
  const names = (await directoryNames(root))
    .filter((name) => /^backup-\d{8}T\d{6}Z$/.test(name))
    .sort()
    .reverse();
  if (!names[0]) return null;
  const metadata = await stat(resolve(root, names[0]));
  return Math.round(((Date.now() - metadata.mtimeMs) / 3_600_000) * 10) / 10;
}

function dockerInventory(): {
  rootless: boolean;
  projects: string[];
  runtime: ContainerRuntimeSnapshot;
} {
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
  const containers = run("docker", ["ps", "-a", "--format", "{{.State}}|{{.Status}}"]);
  if (containers.status !== 0) {
    fail(containers.stderr.trim() || "Cannot list Docker containers");
  }
  const statuses = containers.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    rootless: info.stdout.includes("name=rootless"),
    projects: [...new Set(list.stdout.split("\n").map((line) => line.trim()).filter(Boolean))],
    runtime: {
      total: statuses.length,
      running: statuses.filter((line) => line.startsWith("running|")).length,
      unhealthy: statuses.filter((line) => line.includes("(unhealthy)")).length,
    },
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
  kuramiHome: string,
): Promise<RuntimeHealthResult> {
  const home = resolve(kuramiHome);
  const counterStatePath = resolve(home, "state/runtime-health-counters.json");
  const [
    projects,
    config,
    server,
    vmstat,
    previousCounters,
    networkConnectivity,
    networkSpeed,
    cpuStatisticsEntries,
  ] = await Promise.all([
    readFile(resolve(home, "config/projects.yaml"), "utf8").then(
      (content) => parse(content) as ResourceGuardProjects,
    ),
    readFile(resolve(home, "config/orchestrator.yaml"), "utf8").then(
      (content) =>
        parse(content) as {
          version: number;
          limits: ResourceGuardLimits;
          server_health?: Partial<ServerHealthConfig>;
          cpu_statistics?: Partial<CpuStatisticsConfig>;
        },
    ),
    inspectServerHealth(),
    readFile("/proc/vmstat", "utf8"),
    readRuntimeHealthCounterState(counterStatePath),
    inspectNetworkConnectivity(),
    readNetworkSpeedSnapshot(resolve(home, "state/network-speed.json")),
    readCpuStatistics(resolve(home, "state/cpu-statistics.json")),
  ]);
  if (projects.version !== 1 || config.version !== 1) fail("Unsupported config version");
  validateResourceGuardLimits(config.limits);
  const serverHealthConfig = resolveServerHealthConfig(config.server_health);
  const cpuStatisticsConfig = resolveCpuStatisticsConfig(config.cpu_statistics);
  const cpuStatistics = calculateCpuRollingStatistics(
    cpuStatisticsEntries,
    cpuStatisticsConfig.rolling_window_minutes,
  );
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
  const topConsumers: TopConsumers = {
    ...topProcessConsumers(),
    ...topContainerConsumers(),
  };
  const oomKillCount = parseOomKillCount(vmstat);
  const oomKillsSincePreviousCheck = previousCounters === null
    ? 0
    : Math.max(0, oomKillCount - previousCounters.oomKillCount);
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
  if (oomKillsSincePreviousCheck > 0) {
    problems.push(
      `Linux OOM killer terminated ${oomKillsSincePreviousCheck} process${oomKillsSincePreviousCheck === 1 ? "" : "es"} since the previous alert check`,
    );
  }
  if (integrity !== "ok") problems.push(`SQLite quick_check: ${integrity}`);
  if (!docker.rootless) problems.push("Docker daemon is not rootless");
  if (docker.runtime.unhealthy > 0) {
    problems.push(
      `Docker reports ${docker.runtime.unhealthy} unhealthy container${docker.runtime.unhealthy === 1 ? "" : "s"}`,
    );
  }
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
  const criticalProblems = new Set(problems);
  for (const problem of resourceGuard.blockReasons) {
    criticalProblems.add(problem);
  }
  for (const problem of new Set([
    ...resourceGuard.blockReasons,
    ...resourceGuard.warnings,
  ])) {
    problems.push(problem);
  }
  const serverIssues = assessServerHealth(server, serverHealthConfig);
  const runtimeIssues = problems.map((problem) => ({
    key: stableProblemKey(problem),
    severity: criticalProblems.has(problem)
      ? ("critical" as const)
      : ("warning" as const),
    message: problem,
    requiredChecks: 1,
  }));
  problems.push(...serverIssues.map((issue) => issue.message));
  const networkIssues: HealthAlertIssue[] = [];
  if (networkConnectivity.status === "offline") {
    networkIssues.push({
      key: "server:network",
      severity: "critical",
      message: "All external HTTPS connectivity probes failed",
      requiredChecks: 2,
    });
  } else if (networkConnectivity.status === "degraded") {
    networkIssues.push({
      key: "server:network",
      severity: "warning",
      message: `Only ${networkConnectivity.successfulTargets}/${networkConnectivity.totalTargets} external HTTPS probes succeeded`,
      requiredChecks: 3,
    });
  }
  problems.push(...networkIssues.map((issue) => issue.message));

  return {
    ok: problems.length === 0,
    checkedAt: new Date().toISOString(),
    databaseIntegrity: integrity,
    dockerRootless: docker.rootless,
    containerRuntime: docker.runtime,
    topConsumers,
    oomKillCount,
    oomKillsSincePreviousCheck,
    networkConnectivity,
    networkSpeed,
    activePreviewLeases: leases.length,
    backupAgeHours,
    backupMaxAgeHours,
    backupFresh,
    preview,
    resourceGuard,
    server,
    serverHealthConfig,
    cpuStatistics,
    alertIssues: [...runtimeIssues, ...serverIssues, ...networkIssues],
    problems,
  };
}

export async function runRuntimeHealthCli(): Promise<void> {
  const alertText = process.argv.includes("--alert-text");
  const summaryText = process.argv.includes("--summary-text");
  const unknown = process.argv
    .slice(2)
    .filter((arg) => !["--alert-text", "--summary-text"].includes(arg));
  if (unknown.length > 0 || (alertText && summaryText)) {
    fail("Usage: runtime-health.ts [--alert-text | --summary-text]");
  }
  const kuramiHome = resolveKuramiHome(
    resolve(import.meta.dirname, "../../../.."),
  );
  const result = await inspectRuntimeHealth(kuramiHome);
  const counterStatePath = resolve(kuramiHome, "state/runtime-health-counters.json");
  if (alertText) {
    const statePath = resolve(kuramiHome, "state/runtime-health-alert.json");
    const previous = await readHealthAlertState(statePath);
    const decision = evaluateHealthAlerts(
      previous,
      result.alertIssues,
      new Date(result.checkedAt),
      result.serverHealthConfig.alert_reminder_minutes,
    );
    await writeHealthAlertState(statePath, decision.state);
    await writeRuntimeHealthCounterState(counterStatePath, result.oomKillCount);
    if (decision.kind) {
      process.stdout.write(`${formatAlertNotification(result, decision)}\n`);
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

if (import.meta.main) {
  runRuntimeHealthCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${JSON.stringify({ ok: false, error: message })}\n`);
    process.exitCode = 1;
  });
}

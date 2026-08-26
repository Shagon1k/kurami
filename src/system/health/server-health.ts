import { cpus, hostname, loadavg, uptime } from "node:os";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type AlertSeverity = "warning" | "critical";

export type ServerHealthConfig = {
  cpu_warning_percent: number;
  cpu_critical_percent: number;
  memory_warning_percent: number;
  memory_critical_percent: number;
  warning_consecutive_checks: number;
  critical_consecutive_checks: number;
  alert_reminder_minutes: number;
};

export type CpuSample = {
  idle: number;
  total: number;
};

export type ServerHealthSnapshot = {
  hostname: string;
  cpuUsedPercent: number;
  cpuCores: number;
  loadAverage: [number, number, number];
  memoryUsedPercent: number;
  memoryUsedGiB: number;
  memoryTotalGiB: number;
  memoryAvailableGiB: number;
  swapTotalGiB: number;
  swapUsedGiB: number;
  uptimeSeconds: number;
};

export type HealthAlertIssue = {
  key: string;
  severity: AlertSeverity;
  message: string;
  requiredChecks: number;
};

type AlertStreak = {
  severity: AlertSeverity;
  count: number;
};

export type ActiveAlert = {
  severity: AlertSeverity;
  message: string;
};

export type HealthAlertState = {
  version: 1;
  streaks: Record<string, AlertStreak>;
  active: Record<string, ActiveAlert>;
  lastNotifiedAt: string | null;
};

export type HealthAlertDecision = {
  kind: "alert" | "recovery" | "reminder" | null;
  active: Record<string, ActiveAlert>;
  state: HealthAlertState;
};

export const defaultServerHealthConfig: ServerHealthConfig = {
  cpu_warning_percent: 85,
  cpu_critical_percent: 95,
  memory_warning_percent: 80,
  memory_critical_percent: 90,
  warning_consecutive_checks: 3,
  critical_consecutive_checks: 2,
  alert_reminder_minutes: 120,
};

const gibibyte = 1024 ** 3;
const cpuSamplingWindowMs = 5_000;

function rounded(value: number, digits = 1): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function assertPercent(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 1 || value > 100) {
    throw new Error(`${name} must be between 1 and 100`);
  }
}

function assertInteger(
  name: string,
  value: number,
  minimum: number,
  maximum: number,
): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function resolveServerHealthConfig(
  input: Partial<ServerHealthConfig> | undefined,
): ServerHealthConfig {
  const config = { ...defaultServerHealthConfig, ...input };
  assertPercent("cpu_warning_percent", config.cpu_warning_percent);
  assertPercent("cpu_critical_percent", config.cpu_critical_percent);
  assertPercent("memory_warning_percent", config.memory_warning_percent);
  assertPercent("memory_critical_percent", config.memory_critical_percent);
  if (config.cpu_warning_percent >= config.cpu_critical_percent) {
    throw new Error("cpu_warning_percent must be lower than cpu_critical_percent");
  }
  if (config.memory_warning_percent >= config.memory_critical_percent) {
    throw new Error(
      "memory_warning_percent must be lower than memory_critical_percent",
    );
  }
  assertInteger(
    "warning_consecutive_checks",
    config.warning_consecutive_checks,
    1,
    12,
  );
  assertInteger(
    "critical_consecutive_checks",
    config.critical_consecutive_checks,
    1,
    12,
  );
  assertInteger("alert_reminder_minutes", config.alert_reminder_minutes, 30, 1440);
  return config;
}

export function parseCpuSample(content: string): CpuSample {
  const line = content
    .split("\n")
    .find((entry) => entry.startsWith("cpu "));
  if (!line) throw new Error("/proc/stat does not contain an aggregate CPU row");
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 4 || values.some((value) => !Number.isFinite(value))) {
    throw new Error("Cannot parse aggregate CPU counters from /proc/stat");
  }
  const idle = values[3] + (values[4] ?? 0);
  const total = values.reduce((sum, value) => sum + value, 0);
  return { idle, total };
}

export function calculateCpuUsedPercent(
  before: CpuSample,
  after: CpuSample,
): number {
  const totalDelta = after.total - before.total;
  const idleDelta = after.idle - before.idle;
  if (totalDelta <= 0 || idleDelta < 0) {
    throw new Error("CPU counters did not advance monotonically");
  }
  return rounded(Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)));
}

export function parseMemorySnapshot(content: string): Pick<
  ServerHealthSnapshot,
  | "memoryUsedPercent"
  | "memoryUsedGiB"
  | "memoryTotalGiB"
  | "memoryAvailableGiB"
  | "swapTotalGiB"
  | "swapUsedGiB"
> {
  const values = new Map<string, number>();
  for (const line of content.split("\n")) {
    const match = /^([A-Za-z_()]+):\s+(\d+)\s+kB$/.exec(line.trim());
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const total = values.get("MemTotal");
  const available = values.get("MemAvailable");
  if (!total || available === undefined || available > total) {
    throw new Error("Cannot parse MemTotal/MemAvailable from /proc/meminfo");
  }
  const swapTotal = values.get("SwapTotal") ?? 0;
  const swapFree = Math.min(swapTotal, values.get("SwapFree") ?? 0);
  const used = total - available;
  return {
    memoryUsedPercent: rounded((used / total) * 100),
    memoryUsedGiB: rounded(used / gibibyte),
    memoryTotalGiB: rounded(total / gibibyte),
    memoryAvailableGiB: rounded(available / gibibyte),
    swapTotalGiB: rounded(swapTotal / gibibyte),
    swapUsedGiB: rounded((swapTotal - swapFree) / gibibyte),
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export async function inspectServerHealth(): Promise<ServerHealthSnapshot> {
  const [beforeContent, memoryContent] = await Promise.all([
    readFile("/proc/stat", "utf8"),
    readFile("/proc/meminfo", "utf8"),
  ]);
  await delay(cpuSamplingWindowMs);
  const afterContent = await readFile("/proc/stat", "utf8");
  const loads = loadavg();
  return {
    hostname: hostname(),
    cpuUsedPercent: calculateCpuUsedPercent(
      parseCpuSample(beforeContent),
      parseCpuSample(afterContent),
    ),
    cpuCores: Math.max(1, cpus().length),
    loadAverage: [rounded(loads[0], 2), rounded(loads[1], 2), rounded(loads[2], 2)],
    ...parseMemorySnapshot(memoryContent),
    uptimeSeconds: Math.round(uptime()),
  };
}

export function assessServerHealth(
  snapshot: ServerHealthSnapshot,
  config: ServerHealthConfig,
): HealthAlertIssue[] {
  const issues: HealthAlertIssue[] = [];
  if (snapshot.cpuUsedPercent >= config.cpu_critical_percent) {
    issues.push({
      key: "server:cpu",
      severity: "critical",
      message: `CPU is ${snapshot.cpuUsedPercent}% used (critical ${config.cpu_critical_percent}%)`,
      requiredChecks: config.critical_consecutive_checks,
    });
  } else if (snapshot.cpuUsedPercent >= config.cpu_warning_percent) {
    issues.push({
      key: "server:cpu",
      severity: "warning",
      message: `CPU is ${snapshot.cpuUsedPercent}% used (warning ${config.cpu_warning_percent}%)`,
      requiredChecks: config.warning_consecutive_checks,
    });
  }
  if (snapshot.memoryUsedPercent >= config.memory_critical_percent) {
    issues.push({
      key: "server:memory",
      severity: "critical",
      message: `RAM is ${snapshot.memoryUsedPercent}% used (${snapshot.memoryAvailableGiB} GiB available)`,
      requiredChecks: config.critical_consecutive_checks,
    });
  } else if (snapshot.memoryUsedPercent >= config.memory_warning_percent) {
    issues.push({
      key: "server:memory",
      severity: "warning",
      message: `RAM is ${snapshot.memoryUsedPercent}% used (${snapshot.memoryAvailableGiB} GiB available)`,
      requiredChecks: config.warning_consecutive_checks,
    });
  }
  return issues;
}

export function emptyHealthAlertState(): HealthAlertState {
  return { version: 1, streaks: {}, active: {}, lastNotifiedAt: null };
}

function validAlertState(value: unknown): value is HealthAlertState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<HealthAlertState>;
  return (
    candidate.version === 1 &&
    Boolean(candidate.streaks) &&
    typeof candidate.streaks === "object" &&
    Boolean(candidate.active) &&
    typeof candidate.active === "object" &&
    (candidate.lastNotifiedAt === null || typeof candidate.lastNotifiedAt === "string")
  );
}

export function evaluateHealthAlerts(
  previous: HealthAlertState,
  issues: HealthAlertIssue[],
  now: Date,
  reminderMinutes: number,
): HealthAlertDecision {
  const streaks: Record<string, AlertStreak> = {};
  const active: Record<string, ActiveAlert> = {};

  for (const issue of issues) {
    const oldStreak = previous.streaks[issue.key];
    const count = oldStreak?.severity === issue.severity ? oldStreak.count + 1 : 1;
    streaks[issue.key] = { severity: issue.severity, count };
    if (count >= issue.requiredChecks) {
      active[issue.key] = { severity: issue.severity, message: issue.message };
    } else if (previous.active[issue.key]) {
      active[issue.key] = previous.active[issue.key];
    }
  }

  const previousKeys = Object.keys(previous.active).sort();
  const activeKeys = Object.keys(active).sort();
  const previousFingerprint = previousKeys
    .map((key) => `${key}:${previous.active[key].severity}`)
    .join("|");
  const activeFingerprint = activeKeys
    .map((key) => `${key}:${active[key].severity}`)
    .join("|");
  const changed = previousFingerprint !== activeFingerprint;
  const lastNotifiedMs = previous.lastNotifiedAt
    ? Date.parse(previous.lastNotifiedAt)
    : Number.NaN;
  const reminderDue =
    activeKeys.length > 0 &&
    Number.isFinite(lastNotifiedMs) &&
    now.getTime() - lastNotifiedMs >= reminderMinutes * 60_000;

  let kind: HealthAlertDecision["kind"] = null;
  if (changed && activeKeys.length > 0) kind = "alert";
  else if (changed && previousKeys.length > 0) kind = "recovery";
  else if (reminderDue) kind = "reminder";

  const state: HealthAlertState = {
    version: 1,
    streaks,
    active,
    lastNotifiedAt: kind ? now.toISOString() : previous.lastNotifiedAt,
  };
  return { kind, active, state };
}

export async function readHealthAlertState(path: string): Promise<HealthAlertState> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    return validAlertState(parsed) ? parsed : emptyHealthAlertState();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyHealthAlertState();
    }
    throw error;
  }
}

export async function writeHealthAlertState(
  path: string,
  state: HealthAlertState,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

export function stableProblemKey(message: string): string {
  return `runtime:${message
    .toLowerCase()
    .replace(/\d+(?:\.\d+)?/g, "#")
    .replace(/\s+/g, " ")
    .trim()}`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

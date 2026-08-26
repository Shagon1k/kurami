import {
  assessServerHealth,
  calculateCpuUsedPercent,
  defaultServerHealthConfig,
  emptyHealthAlertState,
  evaluateHealthAlerts,
  formatUptime,
  parseCpuSample,
  parseMemorySnapshot,
  resolveServerHealthConfig,
  stableProblemKey,
  type ServerHealthSnapshot,
} from "../src/server-health.ts";

const before = parseCpuSample("cpu  100 0 50 850 0 0 0 0 0 0\n");
const after = parseCpuSample("cpu  160 0 70 920 0 0 0 0 0 0\n");
if (calculateCpuUsedPercent(before, after) !== 53.3) {
  throw new Error("CPU delta calculation mismatch");
}

const memory = parseMemorySnapshot([
  "MemTotal:       23068672 kB",
  "MemAvailable:   17825792 kB",
  "SwapTotal:             0 kB",
  "SwapFree:              0 kB",
].join("\n"));
if (
  memory.memoryTotalGiB !== 22 ||
  memory.memoryAvailableGiB !== 17 ||
  memory.memoryUsedGiB !== 5 ||
  memory.memoryUsedPercent !== 22.7 ||
  memory.swapTotalGiB !== 0
) {
  throw new Error(`Memory parsing mismatch: ${JSON.stringify(memory)}`);
}

const config = resolveServerHealthConfig({ alert_reminder_minutes: 180 });
if (
  config.cpu_warning_percent !== 85 ||
  config.memory_warning_percent !== 80 ||
  config.alert_reminder_minutes !== 180
) {
  throw new Error("Server health config defaults were not merged");
}

let rejectedThresholds = false;
try {
  resolveServerHealthConfig({ cpu_warning_percent: 99 });
} catch {
  rejectedThresholds = true;
}
if (!rejectedThresholds) throw new Error("Invalid threshold ordering was accepted");

const snapshot: ServerHealthSnapshot = {
  hostname: "shagserv",
  cpuUsedPercent: 87,
  cpuCores: 8,
  loadAverage: [6.9, 5.2, 3.1],
  memoryUsedPercent: 82,
  memoryUsedGiB: 18,
  memoryTotalGiB: 22,
  memoryAvailableGiB: 4,
  swapTotalGiB: 0,
  swapUsedGiB: 0,
  uptimeSeconds: 1000,
};
const warningIssues = assessServerHealth(snapshot, defaultServerHealthConfig);
if (
  warningIssues.length !== 2 ||
  warningIssues.some(
    (issue) =>
      issue.severity !== "warning" ||
      issue.requiredChecks !== defaultServerHealthConfig.warning_consecutive_checks,
  )
) {
  throw new Error(`Warning assessment mismatch: ${JSON.stringify(warningIssues)}`);
}

let decision = evaluateHealthAlerts(
  emptyHealthAlertState(),
  warningIssues,
  new Date("2026-08-26T08:00:00Z"),
  120,
);
if (decision.kind !== null || Object.keys(decision.active).length !== 0) {
  throw new Error("First warning sample should not alert");
}
decision = evaluateHealthAlerts(
  decision.state,
  warningIssues,
  new Date("2026-08-26T08:10:00Z"),
  120,
);
if (decision.kind !== null) throw new Error("Second warning sample should not alert");
decision = evaluateHealthAlerts(
  decision.state,
  warningIssues,
  new Date("2026-08-26T08:20:00Z"),
  120,
);
if (decision.kind !== "alert" || Object.keys(decision.active).length !== 2) {
  throw new Error("Third warning sample should open an alert");
}

const unchanged = evaluateHealthAlerts(
  decision.state,
  warningIssues.map((issue) => ({
    ...issue,
    message: issue.message.replace("87%", "88%").replace("82%", "83%"),
  })),
  new Date("2026-08-26T09:00:00Z"),
  120,
);
if (unchanged.kind !== null) {
  throw new Error("Alert cooldown did not suppress changing metric values");
}
const reminder = evaluateHealthAlerts(
  unchanged.state,
  warningIssues,
  new Date("2026-08-26T10:20:00Z"),
  120,
);
if (reminder.kind !== "reminder") throw new Error("Alert reminder was not emitted");
const recovery = evaluateHealthAlerts(
  reminder.state,
  [],
  new Date("2026-08-26T10:30:00Z"),
  120,
);
if (recovery.kind !== "recovery" || Object.keys(recovery.active).length !== 0) {
  throw new Error("Recovery transition was not emitted");
}

const criticalSnapshot = {
  ...snapshot,
  cpuUsedPercent: 97,
  memoryUsedPercent: 92,
  memoryAvailableGiB: 1.8,
};
const criticalIssues = assessServerHealth(
  criticalSnapshot,
  defaultServerHealthConfig,
);
let critical = evaluateHealthAlerts(
  emptyHealthAlertState(),
  criticalIssues,
  new Date("2026-08-26T11:00:00Z"),
  120,
);
if (critical.kind !== null) throw new Error("First critical sample should not alert");
critical = evaluateHealthAlerts(
  critical.state,
  criticalIssues,
  new Date("2026-08-26T11:10:00Z"),
  120,
);
if (
  critical.kind !== "alert" ||
  Object.values(critical.active).some((issue) => issue.severity !== "critical")
) {
  throw new Error("Second critical sample should open a critical alert");
}

if (
  stableProblemKey("Latest state backup is 90h old") !==
  stableProblemKey("Latest state backup is 91.5h old")
) {
  throw new Error("Dynamic problem values should map to a stable alert key");
}
if (formatUptime(16 * 86_400) !== "16d 0h") {
  throw new Error("Uptime formatting mismatch");
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    cpuDelta: true,
    memAvailable: true,
    warningAfterChecks: 3,
    criticalAfterChecks: 2,
    alertCooldownMinutes: 120,
    recoveryNotification: true,
    stableDynamicKeys: true,
  })}\n`,
);

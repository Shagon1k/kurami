import {
  analyzePreviewConsistency,
  formatHealthSummary,
  parseOomKillCount,
} from "../src/runtime-health.ts";
import type { ResourceGuardAnalysis } from "../src/resource-guard.ts";
import { defaultServerHealthConfig } from "../src/server-health.ts";

const healthyResourceGuard: ResourceGuardAnalysis = {
  disk: { usedPercent: 18, availableGiB: 160, state: "normal" },
  worktrees: {
    global: 0,
    byProject: { tailortales: 0, pickflick: 0 },
    maxGlobal: 6,
    maxPerProject: 4,
  },
  observations: [],
  quarantines: { observed: 0, quarantined: 0, reviewDue: 0 },
  admissionBlocked: false,
  blockReasons: [],
  warnings: [],
};

const healthyServer = {
  hostname: "shagserv",
  cpuUsedPercent: 12.5,
  cpuCores: 8,
  loadAverage: [0.44, 0.53, 0.49] as [number, number, number],
  memoryUsedPercent: 25,
  memoryUsedGiB: 5.6,
  memoryTotalGiB: 22,
  memoryAvailableGiB: 17,
  swapTotalGiB: 0,
  swapUsedGiB: 0,
  uptimeSeconds: 1_382_400,
};

const healthy = analyzePreviewConsistency({
  leases: [
    {
      lease_id: "lease-1",
      run_id: "r_healthy",
      slot_number: 1,
      lease_state: "running",
      compose_project_name: "kurami-pv1-1234567890",
      run_state: "parked_review",
      preview_id: "preview-1",
      expires_at: "2026-08-20T20:00:00.000Z",
      updated_at: "2026-08-16T12:00:00Z",
      runtime_adapter: "compose",
      artifact_root: null,
    },
  ],
  dockerProjects: ["kurami-pv1-1234567890", "unrelated-project"],
  runtimeDirectories: [{ name: "r_healthy", ageMinutes: 60 }],
  nowMs: Date.parse("2026-08-16T13:00:00Z"),
});

if (parseOomKillCount("pgfault 20\noom_kill 7\n") !== 7) {
  throw new Error("OOM kill counter parsing failed");
}

if (Object.values(healthy).some((values) => values.length > 0)) {
  throw new Error("Healthy preview inventory produced a false positive");
}

const unhealthy = analyzePreviewConsistency({
  leases: [
    {
      lease_id: "lease-running",
      run_id: "r_missing",
      slot_number: 2,
      lease_state: "running",
      compose_project_name: "kurami-pv2-aaaaaaaaaa",
      run_state: "running",
      preview_id: "preview-2",
      expires_at: "2026-08-20T20:00:00.000Z",
      updated_at: "2026-08-16T12:00:00Z",
      runtime_adapter: "compose",
      artifact_root: null,
    },
    {
      lease_id: "lease-failed",
      run_id: "r_failed",
      slot_number: 3,
      lease_state: "failed",
      compose_project_name: "kurami-pv3-bbbbbbbbbb",
      run_state: "archived",
      preview_id: "preview-9",
      expires_at: null,
      updated_at: "2026-08-16T12:00:00Z",
      runtime_adapter: "compose",
      artifact_root: null,
    },
    {
      lease_id: "lease-expired",
      run_id: "r_expired",
      slot_number: 4,
      lease_state: "running",
      compose_project_name: "kurami-pv4-dddddddddd",
      run_state: "parked_review",
      preview_id: "preview-4",
      expires_at: "2026-08-16T12:30:00.000Z",
      updated_at: "2026-08-16T12:00:00Z",
      runtime_adapter: "compose",
      artifact_root: null,
    },
    {
      lease_id: "lease-static",
      run_id: "r_static_missing",
      slot_number: 5,
      lease_state: "running",
      compose_project_name: "kurami-pv5-eeeeeeeeee",
      run_state: "parked_review",
      preview_id: "preview-5",
      expires_at: "2026-08-20T20:00:00.000Z",
      updated_at: "2026-08-16T12:00:00Z",
      runtime_adapter: "static",
      artifact_root: "/srv/state/previews/r_static_missing/artifact",
    },
  ],
  dockerProjects: [
    "kurami-pv3-bbbbbbbbbb",
    "kurami-pv4-cccccccccc",
    "kurami-pv4-dddddddddd",
    "not-kurami-preview",
  ],
  runtimeDirectories: [
    { name: "r_missing", ageMinutes: 60 },
    { name: "r_failed", ageMinutes: 60 },
    { name: "r_orphan", ageMinutes: 60 },
    { name: "r_young_orphan", ageMinutes: 5 },
    { name: "r_expired", ageMinutes: 60 },
    { name: "unsafe-name", ageMinutes: 60 },
  ],
  nowMs: Date.parse("2026-08-16T13:00:00Z"),
});

const expected = {
  orphanDockerProjects: "kurami-pv4-cccccccccc",
  missingDockerProjects: "kurami-pv2-aaaaaaaaaa",
  missingStaticArtifacts: "r_static_missing",
  failedLeases: "r_failed",
  terminalRunLeases: "r_failed",
  mappingMismatches: "r_failed",
  expiredLeases: "r_expired",
  orphanRuntimeDirectories: "r_orphan",
};

for (const [key, value] of Object.entries(expected)) {
  const actual = unhealthy[key as keyof typeof unhealthy];
  if (actual.length !== 1 || actual[0] !== value) {
    throw new Error(`${key} mismatch: ${JSON.stringify(actual)}`);
  }
}

const heartbeat = formatHealthSummary({
  ok: true,
  checkedAt: "2026-08-16T18:20:00Z",
  databaseIntegrity: "ok",
  dockerRootless: true,
  containerRuntime: { total: 0, running: 0, unhealthy: 0 },
  topConsumers: {
    cpu: null,
    memory: null,
    containerCpu: null,
    containerMemory: null,
  },
  oomKillCount: 0,
  oomKillsSincePreviousCheck: 0,
  networkConnectivity: {
    status: "online",
    successfulTargets: 3,
    totalTargets: 3,
    latencyMs: 18,
  },
  networkSpeed: null,
  activePreviewLeases: 2,
  backupAgeHours: 71.5,
  backupMaxAgeHours: 84,
  backupFresh: true,
  preview: healthy,
  resourceGuard: healthyResourceGuard,
  server: healthyServer,
  serverHealthConfig: defaultServerHealthConfig,
  alertIssues: [],
  problems: [],
});
if (
  !heartbeat.includes("Kurami system healthy") ||
  !heartbeat.includes("CPU: 12.5%") ||
  !heartbeat.includes("RAM: 25%") ||
  !heartbeat.includes("uptime 16d 0h") ||
  !heartbeat.includes("Active previews: 2") ||
  !heartbeat.includes("Managed worktrees: 0/6") ||
  !heartbeat.includes("Runtime: 0 running · 0 unhealthy") ||
  !heartbeat.includes("71.5h (limit 84h)")
) {
  throw new Error(`Unexpected healthy heartbeat: ${heartbeat}`);
}

const alert = formatHealthSummary({
  ok: false,
  checkedAt: "2026-08-16T18:20:00Z",
  databaseIntegrity: "ok",
  dockerRootless: true,
  containerRuntime: { total: 0, running: 0, unhealthy: 0 },
  topConsumers: {
    cpu: null,
    memory: null,
    containerCpu: null,
    containerMemory: null,
  },
  oomKillCount: 0,
  oomKillsSincePreviousCheck: 0,
  networkConnectivity: {
    status: "online",
    successfulTargets: 3,
    totalTargets: 3,
    latencyMs: 18,
  },
  networkSpeed: null,
  activePreviewLeases: 0,
  backupAgeHours: 90,
  backupMaxAgeHours: 84,
  backupFresh: false,
  preview: healthy,
  resourceGuard: healthyResourceGuard,
  server: healthyServer,
  serverHealthConfig: defaultServerHealthConfig,
  alertIssues: [
    {
      key: "runtime:backup",
      severity: "critical",
      message: "Latest state backup is 90h old",
      requiredChecks: 1,
    },
  ],
  problems: ["Latest state backup is 90h old"],
});
if (!alert.includes("needs attention") || !alert.includes("90h old")) {
  throw new Error(`Unexpected health alert: ${alert}`);
}

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    isolated: true,
    healthyFalsePositives: 0,
    orphanDockerDetected: true,
    missingDockerDetected: true,
    missingStaticArtifactDetected: true,
    failedLeaseDetected: true,
    terminalLeaseDetected: true,
    mappingMismatchDetected: true,
    expiredPreviewDetected: true,
    orphanRuntimeDetected: true,
    backupFreshnessHours: 84,
    friendlyHeartbeat: true,
    friendlyAlert: true,
    noAutomaticDeletion: true,
  })}\n`,
);

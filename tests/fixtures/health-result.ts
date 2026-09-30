import type { RuntimeHealthResult } from "../../src/orchestrator/health/runtime.ts";
import { defaultServerHealthConfig } from "../../src/system/health/server-health.ts";

export function healthResult(checkedAt: string): RuntimeHealthResult {
  return {
    ok: true, checkedAt, databaseIntegrity: "ok", dockerRootless: true,
    containerRuntime: {total: 2, running: 2, unhealthy: 0},
    topConsumers: {cpu: null, memory: null, containerCpu: null, containerMemory: null},
    oomKillCount: 0, oomKillsSincePreviousCheck: 0,
    networkConnectivity: {status: "online", successfulTargets: 3, totalTargets: 3, latencyMs: 18},
    networkSpeed: null, activePreviewLeases: 0,
    backupAgeHours: 2, backupMaxAgeHours: 84, backupFresh: true,
    preview: {orphanDockerProjects: [], missingDockerProjects: [], missingStaticArtifacts: [], failedLeases: [], terminalRunLeases: [], mappingMismatches: [], expiredLeases: [], orphanRuntimeDirectories: []},
    resourceGuard: {disk: {usedPercent: 18, availableGiB: 160, state: "normal"},
      worktrees: {global: 0, byProject: {}, maxGlobal: 6, maxPerProject: 4},
      observations: [], quarantines: {observed: 0, quarantined: 0, reviewDue: 0}, admissionBlocked: false, blockReasons: [], warnings: []},
    server: {hostname: "fixture", cpuUsedPercent: 12, cpuCores: 8, loadAverage: [0.4, 0.5, 0.6],
      memoryUsedPercent: 25, memoryUsedGiB: 5.5, memoryTotalGiB: 22, memoryAvailableGiB: 16.5,
      swapTotalGiB: 0, swapUsedGiB: 0, uptimeSeconds: 86_400},
    serverHealthConfig: {...defaultServerHealthConfig},
    cpuStatistics: {windowMinutes: 8, sampleCount: 32, averagePercent: 8, peakPercent: 22},
    alertIssues: [], problems: [],
  };
}

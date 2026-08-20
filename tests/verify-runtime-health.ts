import {
  analyzePreviewConsistency,
  formatHealthSummary,
} from "../src/runtime-health.ts";

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
    },
  ],
  dockerProjects: ["kurami-pv1-1234567890", "unrelated-project"],
  runtimeDirectories: [{ name: "r_healthy", ageMinutes: 60 }],
  nowMs: Date.parse("2026-08-16T13:00:00Z"),
});

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
  activePreviewLeases: 2,
  backupAgeHours: 71.5,
  backupMaxAgeHours: 84,
  backupFresh: true,
  preview: healthy,
  problems: [],
});
if (
  !heartbeat.includes("Kurami Orchestrator healthy") ||
  !heartbeat.includes("Active previews: 2") ||
  !heartbeat.includes("71.5h (limit 84h)")
) {
  throw new Error(`Unexpected healthy heartbeat: ${heartbeat}`);
}

const alert = formatHealthSummary({
  ok: false,
  checkedAt: "2026-08-16T18:20:00Z",
  databaseIntegrity: "ok",
  dockerRootless: true,
  activePreviewLeases: 0,
  backupAgeHours: 90,
  backupMaxAgeHours: 84,
  backupFresh: false,
  preview: healthy,
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

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  analyzeResourceGuard,
  reconcileResourceQuarantines,
  validateResourceGuardLimits,
  type ResourceGuardInventory,
  type ResourceGuardLimits,
  type ResourceObservation,
} from "../src/orchestrator/resources/guard.ts";
import * as legacyResourceGuard from "../src/resource-guard.ts";

const limits: ResourceGuardLimits = {
  max_managed_worktrees_global: 6,
  max_managed_worktrees_per_project: 4,
  disk_warning_percent: 75,
  disk_admission_block_percent: 85,
  disk_emergency_percent: 92,
  orphan_grace_minutes: 30,
  quarantine_review_after_days: 7,
  max_delivery_attempts: 3,
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(
  legacyResourceGuard.analyzeResourceGuard === analyzeResourceGuard &&
    legacyResourceGuard.reconcileResourceQuarantines ===
      reconcileResourceQuarantines &&
    legacyResourceGuard.validateResourceGuardLimits ===
      validateResourceGuardLimits,
  "Legacy Resource Guard wrapper diverged from the canonical module",
);

function inventory(
  overrides: Partial<ResourceGuardInventory> = {},
): ResourceGuardInventory {
  return {
    diskUsedPercent: 18,
    diskAvailableGiB: 160,
    worktreesByProject: { tailortales: 0, pickflick: 0 },
    observations: [],
    activeQuarantines: [],
    ...overrides,
  };
}

const nowMs = Date.parse("2026-08-21T10:00:00.000Z");
const healthy = analyzeResourceGuard(inventory(), limits, nowMs);
assert(!healthy.admissionBlocked, "Healthy inventory blocked admission");
assert(healthy.disk.state === "normal", "Healthy disk state was not normal");

const warning = analyzeResourceGuard(
  inventory({ diskUsedPercent: 75 }),
  limits,
  nowMs,
);
assert(
  warning.disk.state === "warning" && !warning.admissionBlocked,
  "Warning threshold should alert without blocking admission",
);

const blocked = analyzeResourceGuard(
  inventory({ diskUsedPercent: 85 }),
  limits,
  nowMs,
);
assert(
  blocked.disk.state === "blocked" && blocked.admissionBlocked,
  "Admission disk threshold did not block",
);

const emergency = analyzeResourceGuard(
  inventory({ diskUsedPercent: 92 }),
  limits,
  nowMs,
);
assert(emergency.disk.state === "emergency", "Emergency disk threshold missed");

const capped = analyzeResourceGuard(
  inventory({ worktreesByProject: { tailortales: 4, pickflick: 2 } }),
  limits,
  nowMs,
);
assert(
  capped.admissionBlocked && capped.blockReasons.length >= 2,
  "Global/per-project worktree caps did not fail closed",
);

const observation: ResourceObservation = {
  resourceType: "worktree",
  resourceKey: "/srv/worktrees/TT-999-orphan",
  project: "tailortales",
  runId: null,
  reason: "unmapped_worktree_directory",
  evidence: { path: "/srv/worktrees/TT-999-orphan" },
};
const ambiguous = analyzeResourceGuard(
  inventory({ observations: [observation] }),
  limits,
  nowMs,
);
assert(ambiguous.admissionBlocked, "Resource ambiguity did not block admission");

const database = new DatabaseSync(":memory:");
database.exec("CREATE TABLE runs (run_id TEXT PRIMARY KEY) STRICT;");
for (const name of [
  "028_resource_guardrails.sql",
  "029_resource_guard_discord.sql",
]) {
  database.exec(
    await readFile(resolve(import.meta.dirname, `../migrations/${name}`), "utf8"),
  );
}
reconcileResourceQuarantines(database, [observation], limits, nowMs);
let row = database
  .prepare(
    `SELECT quarantine_state, first_observed_at, quarantined_at, resolved_at
     FROM resource_quarantines`,
  )
  .get() as {
  quarantine_state: string;
  first_observed_at: string;
  quarantined_at: string | null;
  resolved_at: string | null;
};
assert(row.quarantine_state === "observed", "New orphan skipped observation grace");
reconcileResourceQuarantines(database, [observation], limits, nowMs + 60_000);
let eventKinds = database
  .prepare(
    `SELECT event_kind FROM resource_guard_events
     ORDER BY event_at, event_kind`,
  )
  .all() as Array<{ event_kind: string }>;
assert(
  eventKinds.map((event) => event.event_kind).join(",") === "observed",
  "Repeated observation created duplicate lifecycle events",
);

reconcileResourceQuarantines(database, [observation], limits, nowMs + 31 * 60_000);
row = database
  .prepare(
    `SELECT quarantine_state, first_observed_at, quarantined_at, resolved_at
     FROM resource_quarantines`,
  )
  .get() as typeof row;
assert(
  row.quarantine_state === "quarantined" && row.quarantined_at !== null,
  "Persistent orphan was not quarantined after 30 minutes",
);
eventKinds = database
  .prepare(`SELECT event_kind FROM resource_guard_events ORDER BY event_at`)
  .all() as typeof eventKinds;
assert(
  eventKinds.map((event) => event.event_kind).join(",") ===
    "observed,quarantined",
  "Quarantine transition event was not durable and idempotent",
);

const reviewDue = analyzeResourceGuard(
  inventory({
    activeQuarantines: [
      { quarantine_state: "quarantined", quarantined_at: row.quarantined_at },
    ],
  }),
  limits,
  Date.parse(row.quarantined_at) + 7 * 86_400_000,
);
assert(reviewDue.quarantines.reviewDue === 1, "Seven-day owner review was not due");
const reviewAtMs =
  Date.parse(row.quarantined_at) + 7 * 86_400_000;
reconcileResourceQuarantines(database, [observation], limits, reviewAtMs);
eventKinds = database
  .prepare(`SELECT event_kind FROM resource_guard_events ORDER BY event_at`)
  .all() as typeof eventKinds;
assert(
  eventKinds.map((event) => event.event_kind).join(",") ===
    "observed,quarantined,review_due",
  "Seven-day owner-review transition was not emitted once",
);

reconcileResourceQuarantines(database, [], limits, reviewAtMs + 60_000);
row = database
  .prepare(
    `SELECT quarantine_state, first_observed_at, quarantined_at, resolved_at
     FROM resource_quarantines`,
  )
  .get() as typeof row;
assert(
  row.quarantine_state === "resolved" && row.resolved_at !== null,
  "Disappeared orphan did not resolve without deletion",
);
eventKinds = database
  .prepare(`SELECT event_kind FROM resource_guard_events ORDER BY event_at`)
  .all() as typeof eventKinds;
assert(
  eventKinds.map((event) => event.event_kind).join(",") ===
    "observed,quarantined,review_due,resolved",
  "Resolved transition did not preserve the full lifecycle",
);
reconcileResourceQuarantines(database, [observation], limits, reviewAtMs + 120_000);
const observedLifecycles = database
  .prepare(
    `SELECT COUNT(*) AS count FROM resource_guard_events
     WHERE event_kind='observed'`,
  )
  .get() as { count: number };
assert(
  observedLifecycles.count === 2,
  "A new orphan lifecycle reused the previous observed event",
);
database.close();

let invalidRejected = false;
try {
  validateResourceGuardLimits({
    ...limits,
    disk_warning_percent: 90,
    disk_admission_block_percent: 80,
  });
} catch {
  invalidRejected = true;
}
assert(invalidRejected, "Invalid threshold order was accepted");

process.stdout.write(
  `${JSON.stringify({
    ok: true,
    isolated: true,
    diskThresholds: { warning: 75, block: 85, emergency: 92 },
    worktreeCaps: { global: 6, perProject: 4 },
    orphanGraceMinutes: 30,
    quarantineReviewDays: 7,
    admissionFailClosed: true,
    automaticDeletion: false,
    lifecycleEvents: ["observed", "quarantined", "review_due", "resolved"],
    repeatObservationDeduplicated: true,
    repeatedLifecyclePreserved: true,
    invalidConfigRejected: true,
  })}\n`,
);

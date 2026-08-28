import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  deliverResourceGuardBatch,
  formatResourceGuardBatch,
  loadPendingResourceGuardBatches,
  planResourceGuardDiscord,
  prepareResourceGuardDiscord,
  type DiscordMessagePayload,
} from "../src/orchestrator/resources/discord.ts";
import {
  reconcileResourceQuarantines,
  type ResourceGuardLimits,
  type ResourceObservation,
} from "../src/orchestrator/resources/guard.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
const channelId = "1538633903726788758";
const nowMs = Date.parse("2026-08-21T10:00:00.000Z");
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

const observations: ResourceObservation[] = [
  {
    resourceType: "worktree",
    resourceKey: "/srv/worktrees/TT-991-orphan\n@everyone`",
    project: "tailortales",
    runId: null,
    reason: "unmapped_worktree_directory",
    evidence: { path: "/srv/worktrees/TT-991-orphan\n@everyone`" },
  },
  {
    resourceType: "tmux",
    resourceKey: "cx-unmapped-991",
    project: null,
    runId: null,
    reason: "unmapped_managed_tmux_session",
    evidence: { session: "cx-unmapped-991" },
  },
];

reconcileResourceQuarantines(database, observations, limits, nowMs);
let plan = planResourceGuardDiscord(database, limits.max_delivery_attempts, nowMs);
assert(
  plan.unbatchedEvents === 2 && plan.readyBatches === 0,
  "Observed transitions were not available for batching",
);
let batches = prepareResourceGuardDiscord(
  database,
  channelId,
  limits.max_delivery_attempts,
  nowMs,
);
assert(
  batches.length === 1 && batches[0]!.events.length === 2,
  "Same-cycle resource transitions were not grouped into one bounded batch",
);
const initialBatchId = batches[0]!.batch_id;
const initialContent = formatResourceGuardBatch(batches[0]!);
assert(
  initialContent.includes("Observed") &&
    initialContent.includes("fail-closed") &&
    !initialContent.includes("orphan\n@everyone") &&
    initialContent.length <= 1_950,
  "Owner-facing Resource Guard message was incomplete or oversized",
);

const sent: Array<{
  channelId: string;
  payload: DiscordMessagePayload;
}> = [];
const delivered = await deliverResourceGuardBatch(
  database,
  batches[0]!,
  limits.max_delivery_attempts,
  async (target, payload) => {
    sent.push({ channelId: target, payload });
    return { id: "7001" };
  },
);
assert(delivered.action === "delivered", "Resource Guard batch was not delivered");
assert(
  sent.length === 1 &&
    sent[0]!.channelId === channelId &&
    sent[0]!.payload.allowed_mentions.parse.length === 0 &&
    sent[0]!.payload.enforce_nonce,
  "Discord safety envelope or target channel was lost",
);
batches = prepareResourceGuardDiscord(
  database,
  channelId,
  limits.max_delivery_attempts,
  nowMs + 60_000,
);
assert(
  batches.length === 0 && sent.length === 1,
  "Stable reconciliation created a duplicate Resource Guard delivery",
);

reconcileResourceQuarantines(database, [], limits, nowMs + 120_000);
batches = prepareResourceGuardDiscord(
  database,
  channelId,
  limits.max_delivery_attempts,
  nowMs + 120_000,
);
assert(
  batches.length === 1 &&
    batches[0]!.events.every((event) => event.event_kind === "resolved"),
  "Resolved transitions were not grouped separately",
);
for (let attempt = 1; attempt <= 3; attempt += 1) {
  const current = loadPendingResourceGuardBatches(
    database,
    limits.max_delivery_attempts,
  );
  assert(current.length === 1, `Retry ${attempt} was not available`);
  const failed = await deliverResourceGuardBatch(
    database,
    current[0]!,
    limits.max_delivery_attempts,
    async () => {
      throw new Error("synthetic Discord outage");
    },
  );
  assert(failed.action === "failed", `Retry ${attempt} did not fail durably`);
}
assert(
  loadPendingResourceGuardBatches(database, limits.max_delivery_attempts)
    .length === 0,
  "Delivery remained eligible after the configured three attempts",
);

reconcileResourceQuarantines(
  database,
  [observations[0]!],
  limits,
  nowMs + 180_000,
);
batches = prepareResourceGuardDiscord(
  database,
  channelId,
  limits.max_delivery_attempts,
  nowMs + 180_000,
);
assert(batches.length === 1, "Restart fixture batch was not created");
const restartBatchId = batches[0]!.batch_id;
const restartNonce = batches[0]!.nonce;
database
  .prepare(
    `UPDATE resource_guard_discord_batches
     SET delivery_state='sending', attempt_count=1, updated_at=?
     WHERE batch_id=?`,
  )
  .run(new Date(nowMs).toISOString(), restartBatchId);
plan = planResourceGuardDiscord(
  database,
  limits.max_delivery_attempts,
  nowMs + 6 * 60_000,
);
assert(plan.staleSendingBatches === 1, "Stale sending lease was not detected");
batches = prepareResourceGuardDiscord(
  database,
  channelId,
  limits.max_delivery_attempts,
  nowMs + 6 * 60_000,
);
assert(
  batches.length === 1 &&
    batches[0]!.batch_id === restartBatchId &&
    batches[0]!.nonce === restartNonce,
  "Restart recovery changed the durable batch identity or nonce",
);
const recovered = await deliverResourceGuardBatch(
  database,
  batches[0]!,
  limits.max_delivery_attempts,
  async (_target, payload) => {
    assert(payload.nonce === restartNonce, "Restart retry changed Discord nonce");
    return { id: "7002" };
  },
);
assert(recovered.action === "delivered", "Stale batch was not recovered");

const summary = database
  .prepare(
    `SELECT
       (SELECT COUNT(*) FROM resource_guard_events) AS events,
       (SELECT COUNT(*) FROM resource_guard_discord_batches) AS batches,
       (SELECT COUNT(*) FROM resource_guard_discord_batches
        WHERE delivery_state='delivered') AS delivered,
       (SELECT COUNT(*) FROM resource_guard_discord_batches
        WHERE delivery_state='failed' AND attempt_count=3) AS exhausted`,
  )
  .get() as {
  events: number;
  batches: number;
  delivered: number;
  exhausted: number;
};
database.close();

assert(initialBatchId !== restartBatchId, "Distinct lifecycles reused a batch ID");
process.stdout.write(
  `${JSON.stringify({
    ok: true,
    isolated: true,
    transitionEvents: summary.events,
    batches: summary.batches,
    deliveredBatches: summary.delivered,
    exhaustedBatches: summary.exhausted,
    sameCycleBatching: true,
    changedOnly: true,
    maxDeliveryAttempts: 3,
    restartNonceStable: true,
    mentionsDisabled: true,
    automaticCleanup: false,
  })}\n`,
);

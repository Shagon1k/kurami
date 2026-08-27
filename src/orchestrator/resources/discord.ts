import { createHash } from "node:crypto";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

// Durable Discord delivery boundary for Project Orchestrator resource events.

type ResourceGuardEventRow = {
  event_id: string;
  event_kind: "observed" | "quarantined" | "review_due" | "resolved";
  resource_type: "worktree" | "tmux";
  resource_key: string;
  project: string | null;
  run_id: string | null;
  reason: string;
  event_at: string;
};

type ResourceGuardBatchRow = {
  batch_id: string;
  channel_id: string;
  nonce: string;
  delivery_state: "pending" | "sending" | "delivered" | "failed";
  attempt_count: number;
};

export type ResourceGuardDiscordBatch = ResourceGuardBatchRow & {
  events: ResourceGuardEventRow[];
};

export type ResourceGuardDiscordPlan = {
  unbatchedEvents: number;
  readyBatches: number;
  staleSendingBatches: number;
};

export type DiscordMessagePayload = {
  content: string;
  allowed_mentions: { parse: string[] };
  nonce: string;
  enforce_nonce: true;
};

export type ResourceGuardMessageSender = (
  channelId: string,
  payload: DiscordMessagePayload,
) => Promise<{ id?: unknown } | null>;

const maximumEventsPerBatch = 6;
const sendingLeaseMilliseconds = 5 * 60_000;

function fail(message: string): never {
  throw new Error(message);
}

function validateDeliveryConfig(
  channelId: string,
  maxDeliveryAttempts: number,
): void {
  if (!/^\d{5,30}$/u.test(channelId)) {
    fail("Invalid resource_guard_alerts_channel_id");
  }
  if (
    !Number.isInteger(maxDeliveryAttempts) ||
    maxDeliveryAttempts < 1 ||
    maxDeliveryAttempts > 5
  ) {
    fail("Invalid max_delivery_attempts");
  }
}

function scalarCount(
  database: DatabaseSync,
  sql: string,
  ...values: SQLInputValue[]
): number {
  return Number(
    (database.prepare(sql).get(...values) as { count: number }).count,
  );
}

export function planResourceGuardDiscord(
  database: DatabaseSync,
  maxDeliveryAttempts: number,
  nowMs = Date.now(),
): ResourceGuardDiscordPlan {
  const staleBefore = new Date(nowMs - sendingLeaseMilliseconds).toISOString();
  return {
    unbatchedEvents: scalarCount(
      database,
      `SELECT COUNT(*) AS count
       FROM resource_guard_events event
       LEFT JOIN resource_guard_discord_batch_events mapping USING (event_id)
       WHERE mapping.event_id IS NULL`,
    ),
    readyBatches: scalarCount(
      database,
      `SELECT COUNT(*) AS count
       FROM resource_guard_discord_batches
       WHERE delivery_state IN ('pending', 'failed')
         AND attempt_count < ?`,
      maxDeliveryAttempts,
    ),
    staleSendingBatches: scalarCount(
      database,
      `SELECT COUNT(*) AS count
       FROM resource_guard_discord_batches
       WHERE delivery_state = 'sending' AND updated_at <= ?`,
      staleBefore,
    ),
  };
}

function batchIdentity(eventIds: string[]): { batchId: string; nonce: string } {
  const digest = createHash("sha256")
    .update(eventIds.join("\0"))
    .digest("hex");
  return {
    batchId: `rgb_${digest.slice(0, 24)}`,
    nonce: `rg-${digest.slice(0, 20)}`,
  };
}

export function prepareResourceGuardDiscord(
  database: DatabaseSync,
  channelId: string,
  maxDeliveryAttempts: number,
  nowMs = Date.now(),
): ResourceGuardDiscordBatch[] {
  validateDeliveryConfig(channelId, maxDeliveryAttempts);
  const now = new Date(nowMs).toISOString();
  const staleBefore = new Date(nowMs - sendingLeaseMilliseconds).toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare(
        `UPDATE resource_guard_discord_batches
         SET delivery_state='failed',
             last_error=COALESCE(last_error, 'Recovered stale sending lease'),
             updated_at=?
         WHERE delivery_state='sending' AND updated_at <= ?`,
      )
      .run(now, staleBefore);

    const unbatched = database.prepare(
      `SELECT event.event_id
       FROM resource_guard_events event
       LEFT JOIN resource_guard_discord_batch_events mapping USING (event_id)
       WHERE mapping.event_id IS NULL
       ORDER BY event.created_at, event.event_id
       LIMIT ${maximumEventsPerBatch}`,
    );
    const insertBatch = database.prepare(
      `INSERT INTO resource_guard_discord_batches (
         batch_id, channel_id, nonce, event_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const insertMapping = database.prepare(
      `INSERT INTO resource_guard_discord_batch_events (
         batch_id, event_id, ordinal
       ) VALUES (?, ?, ?)`,
    );
    while (true) {
      const eventIds = (unbatched.all() as Array<{ event_id: string }>).map(
        (row) => row.event_id,
      );
      if (eventIds.length === 0) break;
      const identity = batchIdentity(eventIds);
      insertBatch.run(
        identity.batchId,
        channelId,
        identity.nonce,
        eventIds.length,
        now,
        now,
      );
      for (const [ordinal, eventId] of eventIds.entries()) {
        insertMapping.run(identity.batchId, eventId, ordinal);
      }
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return loadPendingResourceGuardBatches(database, maxDeliveryAttempts);
}

export function loadPendingResourceGuardBatches(
  database: DatabaseSync,
  maxDeliveryAttempts: number,
): ResourceGuardDiscordBatch[] {
  const batches = database
    .prepare(
      `SELECT batch_id, channel_id, nonce, delivery_state, attempt_count
       FROM resource_guard_discord_batches
       WHERE delivery_state IN ('pending', 'failed')
         AND attempt_count < ?
       ORDER BY created_at, batch_id`,
    )
    .all(maxDeliveryAttempts) as ResourceGuardBatchRow[];
  const loadEvents = database.prepare(
    `SELECT event.event_id, event.event_kind, event.resource_type,
            event.resource_key, event.project, event.run_id,
            event.reason, event.event_at
     FROM resource_guard_discord_batch_events mapping
     JOIN resource_guard_events event USING (event_id)
     WHERE mapping.batch_id = ?
     ORDER BY mapping.ordinal`,
  );
  return batches.map((batch) => ({
    ...batch,
    events: loadEvents.all(batch.batch_id) as ResourceGuardEventRow[],
  }));
}

function truncate(value: string, maximum: number): string {
  if (value.length <= maximum) return value;
  return `${value.slice(0, Math.max(0, maximum - 1)).trimEnd()}…`;
}

function singleLine(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function inlineCode(value: string): string {
  return `\`${truncate(singleLine(value).replaceAll("`", "'"), 120)}\``;
}

function relativeTimestamp(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? `<t:${Math.floor(milliseconds / 1_000)}:R>`
    : truncate(value, 30);
}

const eventLabels: Record<ResourceGuardEventRow["event_kind"], string> = {
  observed: "⚠️ Observed",
  quarantined: "🟠 Quarantined",
  review_due: "🔴 Owner review due",
  resolved: "✅ Resolved",
};

export function formatResourceGuardBatch(
  batch: ResourceGuardDiscordBatch,
): string {
  const worsened = batch.events.some((event) => event.event_kind !== "resolved");
  const lines = [
    "**Kurami Resource Guard**",
    worsened
      ? "Admission remains fail-closed while resource ownership is ambiguous."
      : "Recorded ambiguity was resolved; no cleanup was performed by Kurami.",
  ];
  for (const event of batch.events) {
    const owner =
      singleLine([event.project, event.run_id].filter(Boolean).join(" / ")) ||
      "unmapped";
    lines.push(
      [
        `• **${eventLabels[event.event_kind]}** · ${event.resource_type} · ${truncate(owner, 70)} · ${relativeTimestamp(event.event_at)}`,
        `  ${inlineCode(event.resource_key)} — ${truncate(singleLine(event.reason), 90)}`,
      ].join("\n"),
    );
  }
  lines.push("Owner review is required before any manual cleanup. No resource was deleted, stopped, or released.");
  return truncate(lines.join("\n"), 1_950);
}

export async function deliverResourceGuardBatch(
  database: DatabaseSync,
  batch: ResourceGuardDiscordBatch,
  maxDeliveryAttempts: number,
  sendMessage: ResourceGuardMessageSender,
): Promise<Record<string, unknown>> {
  const claimed = database
    .prepare(
      `UPDATE resource_guard_discord_batches
       SET delivery_state='sending', attempt_count=attempt_count + 1,
           last_error=NULL,
           updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE batch_id=? AND delivery_state IN ('pending', 'failed')
         AND attempt_count < ?`,
    )
    .run(batch.batch_id, maxDeliveryAttempts);
  if (claimed.changes !== 1) {
    return { batchId: batch.batch_id, action: "skipped_not_claimed" };
  }
  try {
    const message = await sendMessage(batch.channel_id, {
      content: formatResourceGuardBatch(batch),
      allowed_mentions: { parse: [] },
      nonce: batch.nonce,
      enforce_nonce: true,
    });
    const messageId = String(message?.id ?? "");
    if (!/^\d+$/u.test(messageId)) fail("Discord returned no resource guard message ID");
    database
      .prepare(
        `UPDATE resource_guard_discord_batches
         SET delivery_state='delivered', message_id=?,
             delivered_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE batch_id=? AND delivery_state='sending'`,
      )
      .run(messageId, batch.batch_id);
    return {
      batchId: batch.batch_id,
      action: "delivered",
      messageId,
      events: batch.events.length,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    database
      .prepare(
        `UPDATE resource_guard_discord_batches
         SET delivery_state='failed', last_error=?,
             updated_at=strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE batch_id=? AND delivery_state='sending'`,
      )
      .run(message.slice(0, 500), batch.batch_id);
    return { batchId: batch.batch_id, action: "failed", error: message };
  }
}

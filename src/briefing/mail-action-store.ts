import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { section } from "./addons/envelopes.ts";
import { loadEdition } from "./edition-store.ts";
import { briefingAddonEnabled, parseBriefingPayload } from "./model.ts";
import { observeCompletedMailAction } from "./weekly/mail-observation.ts";

export type PreparedMailAction = {
  actionId: string;
  editionId: string;
  itemIds: string[];
  providerMessageIds: string[];
  alreadyComplete: boolean;
};

function fail(message: string): never {
  throw new Error(message);
}

export function markItemRead(database: DatabaseSync, editionId: string, itemId: string): string {
  const timestamp = new Date().toISOString();
  const result = database
    .prepare(`
      UPDATE edition_items
      SET read_at = COALESCE(read_at, ?), updated_at = ?
      WHERE edition_id = ? AND item_id = ?
    `)
    .run(timestamp, timestamp, editionId, itemId);
  if (result.changes !== 1) fail("Unknown briefing item");
  return timestamp;
}

export function prepareMailReadAndArchive(
  database: DatabaseSync,
  editionId: string,
  requestedItemIds: string[],
): PreparedMailAction {
  const itemIds = [...new Set(requestedItemIds)].sort();
  if (itemIds.length < 1 || itemIds.length > 1000) {
    fail("Mail action must contain one to 1000 unique items");
  }
  const edition = loadEdition(database, { id: editionId });
  if (!edition) fail("Unknown briefing edition");
  const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  const mailById = new Map(section(payload, "mail").items.map((item) => [item.id, item]));
  if (!briefingAddonEnabled(payload, "mail")) fail("Mail add-on is disabled for this edition");
  const providerMessageIds = itemIds.map((itemId) => {
    const item = mailById.get(itemId);
    if (!item || item.provider !== "gmail" || typeof item.providerItemId !== "string") {
      fail(`Mail item ${itemId} is not eligible for Gmail automation`);
    }
    return item.providerItemId;
  });
  const rows = database.prepare(`
    SELECT item_id FROM edition_items
    WHERE edition_id = ? AND item_type = 'mail'
  `).all(editionId) as Array<{ item_id: string }>;
  const persisted = new Set(rows.map((row) => row.item_id));
  if (itemIds.some((itemId) => !persisted.has(itemId))) fail("Unknown briefing mail item");

  const actionId = `mail:${createHash("sha256")
    .update(editionId)
    .update("\0")
    .update(itemIds.join("\0"))
    .digest("hex")
    .slice(0, 32)}`;
  const existing = database.prepare(`
    SELECT state FROM action_receipts WHERE action_id = ?
  `).get(actionId) as { state: "prepared" | "complete" | "partial" | "failed" } | undefined;
  if (existing?.state === "complete") {
    return { actionId, editionId, itemIds, providerMessageIds, alreadyComplete: true };
  }
  const timestamp = new Date().toISOString();
  database.prepare(`
    INSERT INTO action_receipts (
      action_id, edition_id, action_type, item_ids_json, state,
      provider_receipt_json, created_at, updated_at
    ) VALUES (?, ?, 'mail.read_and_archive', ?, 'prepared', NULL, ?, ?)
    ON CONFLICT(action_id) DO UPDATE SET
      state = 'prepared', provider_receipt_json = NULL, updated_at = excluded.updated_at
  `).run(actionId, editionId, JSON.stringify(itemIds), timestamp, timestamp);
  return { actionId, editionId, itemIds, providerMessageIds, alreadyComplete: false };
}

export function finishMailReadAndArchive(
  database: DatabaseSync,
  action: PreparedMailAction,
  result: { ok: boolean; receipt: unknown },
): string | null {
  const timestamp = new Date().toISOString();
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      UPDATE action_receipts
      SET state = ?, provider_receipt_json = ?, updated_at = ?
      WHERE action_id = ?
    `).run(
      result.ok ? "complete" : "failed",
      JSON.stringify(result.receipt),
      timestamp,
      action.actionId,
    );
    if (result.ok) {
      observeCompletedMailAction(database, {
        actionId: action.actionId,
        editionId: action.editionId,
        itemIdsJson: JSON.stringify(action.itemIds),
        completedAt: timestamp,
      });
      const mark = database.prepare(`
        UPDATE edition_items
        SET read_at = COALESCE(read_at, ?), updated_at = ?
        WHERE edition_id = ? AND item_id = ? AND item_type = 'mail'
      `);
      for (const itemId of action.itemIds) mark.run(timestamp, timestamp, action.editionId, itemId);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return result.ok ? timestamp : null;
}

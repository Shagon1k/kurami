import type { DatabaseSync } from "node:sqlite";
import { addonEnvelopeDigest, checkedAddonId, loadAddonSnapshot, upsertAddonSnapshot } from "./addons/snapshot-store.ts";
import { assertTelegramStoryCoverage } from "./coverage.ts";
import { loadEdition } from "./edition-store.ts";
import {
  assertProductionBriefingPayload,
  briefingAddonEnabled,
  parseBriefingAddonEnvelope,
  parseBriefingPayload,
  type BriefingAddonEnvelope,
} from "./model.ts";
import type { TelegramBatchReport } from "./telegram-batch.ts";
import { persistOptionalWeekly } from "./weekly/persistence.ts";

export type SourceCommitResult = {
  sourceKey: string;
  status: "committed" | "failed";
  errorCode?: string;
};

export type AddonEditionPromotion = {
  addonId: string;
  envelope: BriefingAddonEnvelope;
};

function fail(message: string): never {
  throw new Error(message);
}

export function finalizeEdition(
  database: DatabaseSync,
  editionId: string,
  results: SourceCommitResult[],
  planDigest?: string,
  addonPromotion?: AddonEditionPromotion,
): { editionId: string; state: "complete" | "partial"; publicationPath: string } {
  const edition = loadEdition(database, { id: editionId });
  if (!edition) fail("Unknown briefing edition");
  const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  assertProductionBriefingPayload(payload);
  let checkedPromotion: AddonEditionPromotion | undefined;
  if (addonPromotion) {
    const addonId = checkedAddonId(addonPromotion.addonId);
    const envelope = parseBriefingAddonEnvelope(addonPromotion.envelope, `promotion.${addonId}`);
    const embedded = payload.addons?.[addonId];
    if (!embedded || addonEnvelopeDigest(embedded) !== addonEnvelopeDigest(envelope)) {
      fail(`Edition ${editionId} does not embed the exact ${addonId} snapshot`);
    }
    checkedPromotion = { addonId, envelope };
  }
  if (edition.state === "complete" || edition.state === "partial") {
    if (checkedPromotion) {
      const stored = loadAddonSnapshot(database, checkedPromotion.addonId);
      if (!stored || stored.contentDigest !== addonEnvelopeDigest(checkedPromotion.envelope)) {
        fail(`Published edition ${editionId} does not own the current ${checkedPromotion.addonId} snapshot`);
      }
    }
    return {
      editionId,
      state: edition.state,
      publicationPath: edition.edition_type === "daily" ? `/daily/${edition.local_date}` : "/cinema",
    };
  }
  if (edition.state !== "prepared") fail("Briefing edition is not prepared");
  const batches = database.prepare(`
    SELECT source_key, source_provider, max_item_id, state
    FROM source_batches WHERE edition_id = ? ORDER BY source_key
  `).all(editionId) as Array<{
    source_key: string;
    source_provider: string;
    max_item_id: string | null;
    state: "prepared" | "committed" | "failed" | "skipped";
  }>;
  if (edition.edition_type === "daily" && batches.length < 1 && briefingAddonEnabled(payload, "news")) {
    fail("Daily production edition has no prepared source batches");
  }
  const resultBySource = new Map(results.map((result) => [result.sourceKey, result]));
  if (resultBySource.size !== results.length) fail("Duplicate source commit result");
  for (const batch of batches) {
    if (batch.state === "committed") continue;
    if (!resultBySource.has(batch.source_key)) fail(`Missing commit result for ${batch.source_key}`);
  }
  if (payload.schemaVersion === 2 && edition.edition_type === "daily") {
    if (!planDigest) fail("SchemaVersion 2 finalization requires a Telegram commit plan digest");
    const planned = database.prepare(`
      SELECT commit_plan_digest, report_json
      FROM telegram_validation_receipts WHERE edition_id = ?
    `).get(editionId) as { commit_plan_digest: string | null; report_json: string } | undefined;
    if (!planned?.commit_plan_digest || planned.commit_plan_digest !== planDigest) {
      fail("Telegram commit plan digest does not match the prepared edition");
    }
    const report = JSON.parse(planned.report_json) as TelegramBatchReport;
    if (report.complete !== true) {
      fail("Telegram finalization requires a complete raw/normalized capture");
    }
    assertTelegramStoryCoverage(payload);
  }
  const timestamp = new Date().toISOString();
  let failed = payload.edition.status === "partial";
  database.exec("BEGIN IMMEDIATE");
  try {
    const updateBatch = database.prepare(`
      UPDATE source_batches
      SET state = ?, committed_at = ?, error_code = ?
      WHERE edition_id = ? AND source_key = ?
    `);
    const upsertCheckpoint = database.prepare(`
      INSERT INTO source_checkpoints (
        source_key, source_provider, last_successful_item_id,
        last_successful_at, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(source_key) DO UPDATE SET
        source_provider = excluded.source_provider,
        last_successful_item_id = excluded.last_successful_item_id,
        last_successful_at = excluded.last_successful_at,
        updated_at = excluded.updated_at
    `);
    for (const batch of batches) {
      if (batch.state === "committed") continue;
      const result = resultBySource.get(batch.source_key)!;
      if (result.status === "committed") {
        updateBatch.run("committed", timestamp, null, editionId, batch.source_key);
        upsertCheckpoint.run(
          batch.source_key,
          batch.source_provider,
          batch.max_item_id,
          timestamp,
          timestamp,
        );
      } else {
        failed = true;
        updateBatch.run(
          "failed",
          null,
          (result.errorCode ?? "provider_error").slice(0, 160),
          editionId,
          batch.source_key,
        );
      }
    }
    const state = failed ? "partial" : "complete";
    persistOptionalWeekly(database, payload, timestamp, "publish");
    database.prepare(`
      UPDATE editions SET is_current = 0, updated_at = ?
      WHERE edition_type = ? AND is_current = 1
    `).run(timestamp, edition.edition_type);
    database.prepare(`
      UPDATE editions
      SET state = ?, is_current = 1, published_at = ?, updated_at = ?
      WHERE id = ? AND state = 'prepared'
    `).run(state, timestamp, timestamp, editionId);
    if (checkedPromotion) {
      upsertAddonSnapshot(
        database,
        checkedPromotion.addonId,
        checkedPromotion.envelope,
      );
    }
    database.exec("COMMIT");
    return {
      editionId,
      state,
      publicationPath: edition.edition_type === "daily" ? `/daily/${edition.local_date}` : "/cinema",
    };
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

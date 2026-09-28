import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rm, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  assertProductionBriefingPayload,
  briefingAddonEnabled,
  parseBriefingPayload,
  parseBriefingAddonEnvelope,
  type BriefingAddonEnvelope,
  type BriefingPayload,
} from "./model.ts";
import { assertTelegramStoryCoverage } from "./coverage.ts";
import {
  assertEditorialPayload,
  assertKuramiNoteContract,
  loadTopicPolicy,
} from "./editorial-validation.ts";
import type { TelegramBatchReport } from "./telegram-batch.ts";
import { DAILY_RETENTION_DAYS } from "./runtime-config.ts";
import {persistOptionalWeekly} from "./weekly/persistence.ts";
import { observeCompletedMailAction } from "./weekly/mail-observation.ts";
import { section, newsBatches } from "./addons/envelopes.ts";
import { loadEdition, type EditionRow } from "./edition-store.ts";
import { topicRegistry, type TopicRegistryRow } from "./interest-profile-store.ts";
import { briefingPaths, type BriefingPaths } from "./paths.ts";
import { atomicWrite, relativeHtmlPath, resolvedHtmlPath, validateRenderedHtml } from "./html-artifacts.ts";
import { persistPreparedMediaRefresh, persistPreparedPreview } from "./preview-store.ts";
import { persistPublishedAddonReplacement } from "./addon-publication-store.ts";
import { inspectDynamicRefresh, persistDynamicRefresh, persistPublishedRevision } from "./published-edition-store.ts";
import {
  addonEnvelopeDigest,
  checkedAddonId,
  loadAddonSnapshot,
  upsertAddonSnapshot,
} from "./addons/snapshot-store.ts";

export {
  addonEnvelopeDigest,
  listAddonSnapshots,
  loadAddonSnapshot,
  upsertAddonSnapshot,
} from "./addons/snapshot-store.ts";
export type { AddonSnapshotRow } from "./addons/snapshot-store.ts";
export { loadEdition } from "./edition-store.ts";
export type { EditionRow } from "./edition-store.ts";
export { setReaction, topicProfile, topicPairProfile, topicRegistry } from "./interest-profile-store.ts";
export type { TopicProfileRow, TopicPairProfileRow, TopicRegistryRow } from "./interest-profile-store.ts";
export { recordTelegramValidation, createTelegramCommitPlan } from "./telegram-commit-store.ts";
export type { TelegramCommitPlan } from "./telegram-commit-store.ts";
export { briefingPaths } from "./paths.ts";
export type { BriefingPaths } from "./paths.ts";
export { validateRenderedHtml, readEditionHtml } from "./html-artifacts.ts";

process.umask(0o077);

export type PreparedMailAction = {
  actionId: string;
  editionId: string;
  itemIds: string[];
  providerMessageIds: string[];
  alreadyComplete: boolean;
};

export type SourceCommitResult = {
  sourceKey: string;
  status: "committed" | "failed";
  errorCode?: string;
};

export type AddonEditionPromotion = {
  addonId: string;
  envelope: BriefingAddonEnvelope;
};

function now(): string {
  return new Date().toISOString();
}

function dailyRetentionUntil(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const instant = new Date(Date.UTC(year!, month! - 1, day!));
  if (!Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== localDate) {
    fail(`Invalid daily edition local date ${localDate}`);
  }
  instant.setUTCDate(instant.getUTCDate() + DAILY_RETENTION_DAYS);
  return instant.toISOString();
}

function fail(message: string): never {
  throw new Error(message);
}

function configureDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
}

export async function initializeBriefingStore(
  paths: BriefingPaths = briefingPaths(),
): Promise<{ database: string; applied: string[]; integrity: string }> {
  await mkdir(paths.previewDirectory, { recursive: true, mode: 0o700 });
  await mkdir(paths.mediaDirectory, { recursive: true, mode: 0o700 });
  await mkdir(paths.mediaInboxDirectory, { recursive: true, mode: 0o700 });
  const database = new DatabaseSync(paths.databasePath, { timeout: 5_000 });
  const applied: string[] = [];
  try {
    configureDatabase(database);
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        migration TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        )
      ) STRICT;
    `);
    const migrationFiles = (await readdir(paths.migrationsDirectory))
      .filter((name) => /^\d+_[a-z0-9_]+\.sql$/.test(name))
      .sort();
    if (migrationFiles.length === 0) fail(`No briefing migrations in ${paths.migrationsDirectory}`);

    const exists = database.prepare("SELECT 1 FROM schema_migrations WHERE migration = ?");
    const record = database.prepare("INSERT INTO schema_migrations (migration) VALUES (?)");
    for (const migration of migrationFiles) {
      if (exists.get(migration)) continue;
      const sql = await readFile(resolve(paths.migrationsDirectory, migration), "utf8");
      database.exec("BEGIN IMMEDIATE");
      try {
        database.exec(sql);
        record.run(migration);
        database.exec("COMMIT");
        applied.push(migration);
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    }
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    if (integrity.integrity_check !== "ok") {
      fail(`Briefing SQLite integrity check failed: ${integrity.integrity_check}`);
    }
    await chmod(paths.databasePath, 0o600);
    return { database: paths.databasePath, applied, integrity: integrity.integrity_check };
  } finally {
    database.close();
  }
}

export function openBriefingDatabase(paths: BriefingPaths = briefingPaths()): DatabaseSync {
  const database = new DatabaseSync(paths.databasePath, { timeout: 5_000 });
  configureDatabase(database);
  return database;
}

export async function preparePreview(
  payloadValue: unknown,
  html: string,
  paths: BriefingPaths = briefingPaths(),
): Promise<{ editionId: string; previewPath: string; digest: string; state: "prepared" }> {
  const payload = parseBriefingPayload(payloadValue);
  assertProductionBriefingPayload(payload);
  await initializeBriefingStore(paths);
  const topicDatabase = openBriefingDatabase(paths);
  let runtimeTopics: TopicRegistryRow[];
  try {
    runtimeTopics = topicRegistry(topicDatabase);
  } finally {
    topicDatabase.close();
  }
  const topicPolicy = await loadTopicPolicy(paths.home, process.env, runtimeTopics);
  assertEditorialPayload(payload, topicPolicy);
  if (payload.edition.type === "daily") {
    payload.edition.retentionUntil = dailyRetentionUntil(payload.edition.localDate);
  }
  if (payload.schemaVersion === 2 && payload.edition.type === "daily" && newsBatches(payload)?.length) {
    assertTelegramStoryCoverage(payload);
  }
  if (payload.edition.type === "daily") {
    assertKuramiNoteContract(payload);
  }
  validateRenderedHtml(html, payload);
  const currentDatabase = openBriefingDatabase(paths);
  try {
    const existing = currentDatabase.prepare("SELECT state FROM editions WHERE id = ?").get(
      payload.edition.id,
    ) as { state: EditionRow["state"] } | undefined;
    if (existing?.state === "complete") {
      fail(`Edition ${payload.edition.id} is already published`);
    }
  } finally {
    currentDatabase.close();
  }

  const database = openBriefingDatabase(paths);
  let digest: string;
  try {
    digest = await persistPreparedPreview(database, payload, html, paths, topicPolicy);
  } finally {
    database.close();
  }

  return {
    editionId: payload.edition.id,
    previewPath: `/preview/${payload.edition.type}/${payload.edition.localDate}`,
    digest,
    state: "prepared",
  };
}


/**
 * Persist media downloaded for an already validated prepared edition.
 *
 * This path intentionally does not rerun editorial validation: preparing an
 * edition may register proposed topics, which changes the runtime policy and
 * must not make a later media-only retry reject the exact same editorial
 * payload. The invariant below proves that only story media and the derived
 * media-quality counters changed.
 */
export async function refreshPreparedPreviewMedia(
  payloadValue: unknown,
  html: string,
  paths: BriefingPaths = briefingPaths(),
): Promise<{ editionId: string; previewPath: string; digest: string; state: "prepared" }> {
  const payload = parseBriefingPayload(payloadValue);
  assertProductionBriefingPayload(payload);
  await initializeBriefingStore(paths);
  if (payload.edition.type === "daily") {
    payload.edition.retentionUntil = dailyRetentionUntil(payload.edition.localDate);
  }
  if (payload.schemaVersion === 2 && payload.edition.type === "daily" && newsBatches(payload)?.length) {
    assertTelegramStoryCoverage(payload);
  }
  validateRenderedHtml(html, payload);

  const database = openBriefingDatabase(paths);
  try {
    const { editionId, digest } = await persistPreparedMediaRefresh(database, payload, html, paths);
    return {
      editionId,
      previewPath: `/preview/${payload.edition.type}/${payload.edition.localDate}`,
      digest,
      state: "prepared",
    };
  } finally {
    database.close();
  }
}

export async function rerenderPublishedPreview(
  payloadValue: unknown,
  html: string,
  paths: BriefingPaths = briefingPaths(),
): Promise<{ editionId: string; previewPath: string; digest: string; state: "complete" }> {
  const payload = parseBriefingPayload(payloadValue);
  validateRenderedHtml(html, payload);
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  try {
    const existing = database.prepare("SELECT state FROM editions WHERE id = ?").get(
      payload.edition.id,
    ) as { state: EditionRow["state"] } | undefined;
    if (existing?.state !== "complete") fail(`Edition ${payload.edition.id} is not published`);
  } finally {
    database.close();
  }
  const digest = createHash("sha256").update(JSON.stringify(payload)).update("\0").update(html).digest("hex");
  await atomicWrite(resolvedHtmlPath(paths, relativeHtmlPath(paths, payload)), html);
  return {
    editionId: payload.edition.id,
    previewPath: `/preview/${payload.edition.type}/${payload.edition.localDate}`,
    digest,
    state: "complete",
  };
}

/**
 * Replace an already-published non-Daily add-on edition in place. The new
 * payload and HTML are fully validated before the current edition and its
 * latest-snapshot pointer move together. Daily editions deliberately use their
 * stricter editorial revision and Telegram ownership workflow instead.
 */
export async function replacePublishedAddonEdition(
  payloadValue: unknown,
  html: string,
  addonIdValue: string,
  paths: BriefingPaths = briefingPaths(),
): Promise<{ editionId: string; publicationPath: string; digest: string; state: "complete" | "partial" }> {
  const payload = parseBriefingPayload(payloadValue);
  assertProductionBriefingPayload(payload);
  if (payload.edition.type === "daily") fail("Daily editions cannot use add-on replacement");
  const addonId = checkedAddonId(addonIdValue);
  const envelope = payload.addons?.[addonId];
  if (!envelope) fail(`Replacement payload does not embed ${addonId}`);
  validateRenderedHtml(html, payload);
  await initializeBriefingStore(paths);

  const database = openBriefingDatabase(paths);
  try {
    const { editionId, digest, state } = await persistPublishedAddonReplacement(
      database, payload, html, addonId, envelope, paths,
    );
    return { editionId, publicationPath: "/cinema", digest, state };
  } finally {
    database.close();
  }
}

export async function revisePublishedEdition(
  payloadValue: unknown,
  renderer: (payload: BriefingPayload) => string,
  paths: BriefingPaths = briefingPaths(),
): Promise<{ editionId: string; publicationPath: string; digest: string; state: "complete" | "partial" }> {
  const revision = parseBriefingPayload(payloadValue);
  assertProductionBriefingPayload(revision);
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  try {
    return await persistPublishedRevision(database, revision, renderer, paths);
  } finally {
    database.close();
  }
}

export function retainedDailyEditions(
  database: DatabaseSync,
  currentTime = now(),
): EditionRow[] {
  return database.prepare(`
    SELECT * FROM (
      SELECT * FROM editions
      WHERE edition_type = 'daily'
        AND state IN ('complete', 'partial')
        AND retention_until > ?
      ORDER BY local_date DESC, updated_at DESC
      LIMIT ?
    ) retained
    ORDER BY local_date ASC
  `).all(currentTime, DAILY_RETENTION_DAYS) as EditionRow[];
}

export async function refreshPublishedEdition(
  payloadValue: unknown,
  html: string,
  expectedContentDigest: string,
  paths: BriefingPaths = briefingPaths(),
  options: { prepared?: boolean } = {},
): Promise<{ editionId: string; digest: string }> {
  const payload = parseBriefingPayload(payloadValue);
  validateRenderedHtml(html, payload);
  const database = openBriefingDatabase(paths);
  let edition: EditionRow;
  try {
    edition = inspectDynamicRefresh(database, payload, expectedContentDigest, options);
  } finally {
    database.close();
  }

  const writable = openBriefingDatabase(paths);
  try {
    return await persistDynamicRefresh(writable, payload, html, expectedContentDigest, edition, paths);
  } finally {
    writable.close();
  }
}

export function markItemRead(database: DatabaseSync, editionId: string, itemId: string): string {
  const timestamp = now();
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
  const timestamp = now();
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
  const timestamp = now();
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
  const timestamp = now();
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
    persistOptionalWeekly(database,payload,timestamp,"publish");
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

export async function cleanupExpired(
  currentTime = now(),
  paths: BriefingPaths = briefingPaths(),
): Promise<{ deleted: string[] }> {
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  const expired = database
    .prepare(`
      WITH retained AS (
        SELECT id FROM editions
        WHERE edition_type = 'daily' AND retention_until > ?
        ORDER BY local_date DESC, updated_at DESC
        LIMIT ?
      )
      SELECT id, edition_type, local_date, html_path
      FROM editions
      WHERE edition_type = 'daily'
        AND (retention_until <= ? OR id NOT IN (SELECT id FROM retained))
    `)
    .all(currentTime, DAILY_RETENTION_DAYS, currentTime) as Array<{
    id: string;
    edition_type: "daily" | "cinema";
    local_date: string;
    html_path: string;
  }>;
  for (const edition of expired) {
    await unlink(resolvedHtmlPath(paths, edition.html_path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rm(resolve(paths.mediaDirectory, edition.edition_type, edition.local_date), {
      recursive: true,
      force: true,
    });
    const attempts = database.prepare(`
      SELECT run_directory FROM briefing_run_attempts WHERE edition_id = ?
    `).all(edition.id) as Array<{ run_directory: string }>;
    for (const attempt of attempts) {
      const directory = resolve(attempt.run_directory);
      if (directory.startsWith(`${resolve(paths.runsDirectory)}/`)) {
        await rm(directory, { recursive: true, force: true });
      }
    }
    for (const root of [paths.runsDirectory, paths.recoveryDirectory, paths.artifactsDirectory, paths.stateArtifactsDirectory]) {
      const children = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const child of children) {
        const legacyName = new RegExp(`^(?:daily|cinema)-${edition.local_date}(?:$|-)`, "u");
        if (!child.isDirectory() || !legacyName.test(child.name)) continue;
        await rm(resolve(root, child.name), { recursive: true, force: true });
      }
    }
  }
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const removeCard = database.prepare("DELETE FROM briefing_run_cards WHERE edition_id = ?");
      const remove = database.prepare("DELETE FROM editions WHERE id = ?");
      for (const edition of expired) {
        removeCard.run(edition.id);
        remove.run(edition.id);
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  } finally {
    database.close();
  }
  return { deleted: expired.map((edition) => edition.id) };
}

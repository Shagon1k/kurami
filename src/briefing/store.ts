import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { assertProductionBriefingPayload, parseBriefingPayload, type BriefingPayload } from "./model.ts";
import { assertTelegramStoryCoverage } from "./coverage.ts";
import {
  assertEditorialPayload,
  assertKuramiNoteContract,
  loadTopicPolicy,
} from "./editorial-validation.ts";
import { DAILY_RETENTION_DAYS } from "./runtime-config.ts";
import { newsBatches } from "./addons/envelopes.ts";
import { loadEdition, type EditionRow } from "./edition-store.ts";
import { topicRegistry, type TopicRegistryRow } from "./interest-profile-store.ts";
import { briefingPaths, type BriefingPaths } from "./paths.ts";
import { atomicWrite, relativeHtmlPath, resolvedHtmlPath, validateRenderedHtml } from "./html-artifacts.ts";
import { persistPreparedMediaRefresh, persistPreparedPreview } from "./preview-store.ts";
import { persistPublishedAddonReplacement } from "./addon-publication-store.ts";
import { inspectDynamicRefresh, persistDynamicRefresh, persistPublishedRevision } from "./published-edition-store.ts";
import { pruneExpiredDailyEditions } from "./retention-store.ts";
import { checkedAddonId } from "./addons/snapshot-store.ts";

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
export { markItemRead, prepareMailReadAndArchive, finishMailReadAndArchive } from "./mail-action-store.ts";
export type { PreparedMailAction } from "./mail-action-store.ts";
export { finalizeEdition } from "./finalization-store.ts";
export type { SourceCommitResult, AddonEditionPromotion } from "./finalization-store.ts";
export { retainedDailyEditions } from "./retention-store.ts";

process.umask(0o077);

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

export async function cleanupExpired(
  currentTime = now(),
  paths: BriefingPaths = briefingPaths(),
): Promise<{ deleted: string[] }> {
  await initializeBriefingStore(paths);
  const database = openBriefingDatabase(paths);
  try {
    return await pruneExpiredDailyEditions(database, currentTime, paths);
  } finally {
    database.close();
  }
}

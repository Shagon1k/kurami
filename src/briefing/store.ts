import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import {
  assertProductionBriefingPayload,
  parseBriefingPayload,
  persistedItems,
  type BriefingPayload,
  type Reaction,
} from "./model.ts";
import { assertTelegramStoryCoverage } from "./coverage.ts";
import type { TelegramBatchReport } from "./telegram-batch.ts";
import { DAILY_RETENTION_DAYS } from "./runtime-config.ts";

process.umask(0o077);

export type BriefingPaths = {
  home: string;
  stateDirectory: string;
  pagesDirectory: string;
  previewDirectory: string;
  mediaDirectory: string;
  mediaInboxDirectory: string;
  databasePath: string;
  migrationsDirectory: string;
  runsDirectory: string;
  recoveryDirectory: string;
  artifactsDirectory: string;
  stateArtifactsDirectory: string;
};

export type EditionRow = {
  id: string;
  edition_type: "daily" | "cinema";
  local_date: string;
  timezone: string;
  state: "prepared" | "complete" | "partial" | "aborted";
  payload_json: string;
  html_path: string;
  content_digest: string;
  preview_enabled: 0 | 1;
  is_current: 0 | 1;
  prepared_at: string;
  published_at: string | null;
  retention_until: string;
  updated_at: string;
};

export type TopicProfileRow = {
  topicId: string;
  label: string;
  likes: number;
  dislikes: number;
};

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

export type TelegramCommitPlan = {
  editionId: string;
  planDigest: string;
  sources: Array<{
    sourceKey: string;
    chatId: number;
    maxId: number;
  }>;
};

export function briefingPaths(environment: NodeJS.ProcessEnv = process.env): BriefingPaths {
  const home = resolveKuramiHome(resolve(import.meta.dirname, "../../.."), environment);
  const stateDirectory = resolve(home, "state/briefing");
  return {
    home,
    stateDirectory,
    pagesDirectory: resolve(stateDirectory, "pages"),
    previewDirectory: resolve(stateDirectory, "pages/preview"),
    mediaDirectory: resolve(stateDirectory, "media"),
    mediaInboxDirectory: resolve(stateDirectory, "media-inbox"),
    databasePath: resolve(stateDirectory, "briefing.db"),
    migrationsDirectory: resolve(
      environment.BRIEFING_MIGRATIONS_DIR ?? resolve(import.meta.dirname, "../../migrations/briefing"),
    ),
    runsDirectory: resolve(stateDirectory, "runs"),
    recoveryDirectory: resolve(stateDirectory, "recovery"),
    artifactsDirectory: resolve(home, "artifacts/briefing"),
    stateArtifactsDirectory: resolve(stateDirectory, "artifacts"),
  };
}

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

function htmlHasAttributes(html: string, attributes: Record<string, string | null>): boolean {
  const tags = html.match(/<[a-z][^>]*>/gi) ?? [];
  return tags.some((tag) =>
    Object.entries(attributes).every(([name, value]) => {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (value === null) return new RegExp(`\\s${escapedName}(?:\\s|=|>|\\/)`, "i").test(tag);
      const escapedValue = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\s${escapedName}\\s*=\\s*["']${escapedValue}["']`, "i").test(tag);
    }),
  );
}

export function validateRenderedHtml(html: string, payload?: BriefingPayload): void {
  if (Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024) fail("Rendered HTML exceeds 2 MiB");
  if (!/^\s*<!doctype html>/i.test(html)) fail("Rendered HTML must begin with a doctype");
  if (!/<html\b/i.test(html) || !/<body\b/i.test(html) || !/<\/body>/i.test(html)) {
    fail("Rendered HTML must contain html and body elements");
  }
  const forbidden: Array<[RegExp, string]> = [
    [/<script\b/i, "script elements"],
    [/<(?:iframe|object|embed|base|form)\b/i, "active embedded content"],
    [/\son[a-z]+\s*=/i, "inline event handlers"],
    [/<meta[^>]+http-equiv\s*=\s*["']?refresh/i, "meta refresh"],
  ];
  for (const [pattern, label] of forbidden) {
    if (pattern.test(html)) fail(`Rendered HTML contains forbidden ${label}`);
  }
  if (!htmlHasAttributes(html, { "data-theme-toggle": null })) {
    fail("Rendered HTML must contain a visible theme toggle");
  }
  if (!payload) return;

  for (const story of payload.news.items) {
    const itemAttributes = { "data-item-id": story.id };
    if (!htmlHasAttributes(html, { ...itemAttributes, "data-feed-item": null })) {
      fail(`Rendered HTML is missing feed item ${story.id}`);
    }
    if (
      !htmlHasAttributes(html, {
        ...itemAttributes,
        "data-edition-id": payload.edition.id,
        "data-story-details": null,
      })
    ) {
      fail(`Rendered HTML is missing expandable details for ${story.id}`);
    }
  }

  const pageSize = payload.news.pageSize ?? 10;
  if (payload.news.items.length > pageSize) {
    for (const attribute of [
      "data-paginated-feed",
      "data-feed-pagination",
      "data-page-prev",
      "data-page-next",
      "data-page-status",
    ]) {
      if (!htmlHasAttributes(html, { [attribute]: null })) {
        fail(`Rendered HTML is missing pagination hook ${attribute}`);
      }
    }
  }
}

async function atomicWrite(path: string, content: string): Promise<void> {
  const candidate = `${path}.${randomUUID().replaceAll("-", "")}.tmp`;
  await writeFile(candidate, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await rename(candidate, path);
  await chmod(path, 0o600);
}

function relativeHtmlPath(paths: BriefingPaths, payload: BriefingPayload): string {
  return relative(
    paths.stateDirectory,
    resolve(paths.previewDirectory, `${payload.edition.type}-${payload.edition.localDate}.html`),
  );
}

function resolvedHtmlPath(paths: BriefingPaths, storedPath: string): string {
  if (isAbsolute(storedPath) || storedPath.includes("..")) fail("Unsafe stored HTML path");
  const candidate = resolve(paths.stateDirectory, storedPath);
  const child = relative(paths.pagesDirectory, candidate);
  if (child.startsWith("..") || resolve(paths.pagesDirectory, child) !== candidate) {
    fail("Stored HTML path escapes briefing pages");
  }
  return candidate;
}

export async function preparePreview(
  payloadValue: unknown,
  html: string,
  paths: BriefingPaths = briefingPaths(),
): Promise<{ editionId: string; previewPath: string; digest: string; state: "prepared" }> {
  const payload = parseBriefingPayload(payloadValue);
  assertProductionBriefingPayload(payload);
  if (payload.edition.type === "daily") {
    payload.edition.retentionUntil = dailyRetentionUntil(payload.edition.localDate);
  }
  if (payload.schemaVersion === 2 && payload.edition.type === "daily" && payload.sourceBatches?.length) {
    assertTelegramStoryCoverage(payload);
  }
  validateRenderedHtml(html, payload);
  await initializeBriefingStore(paths);

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

  const payloadJson = JSON.stringify(payload);
  const digest = createHash("sha256").update(payloadJson).update("\0").update(html).digest("hex");
  const storedHtmlPath = relativeHtmlPath(paths, payload);
  const htmlPath = resolvedHtmlPath(paths, storedHtmlPath);
  await atomicWrite(htmlPath, html);

  const database = openBriefingDatabase(paths);
  try {
    const timestamp = now();
    const previous = database
      .prepare(
        "SELECT item_id, read_at, reaction FROM edition_items WHERE edition_id = ?",
      )
      .all(payload.edition.id) as Array<{
      item_id: string;
      read_at: string | null;
      reaction: Reaction | null;
    }>;
    const priorState = new Map(previous.map((item) => [item.item_id, item]));
    const previousBatches = database.prepare(`
      SELECT source_key, max_item_id, state, committed_at, error_code
      FROM source_batches WHERE edition_id = ?
    `).all(payload.edition.id) as Array<{
      source_key: string;
      max_item_id: string | null;
      state: "prepared" | "committed" | "failed" | "skipped";
      committed_at: string | null;
      error_code: string | null;
    }>;
    const priorBatches = new Map(previousBatches.map((batch) => [batch.source_key, batch]));
    const items = persistedItems(payload);

    database.exec("BEGIN IMMEDIATE");
    try {
      database
        .prepare(`
          INSERT INTO editions (
            id, edition_type, local_date, timezone, state, payload_json,
            html_path, content_digest, preview_enabled, is_current,
            prepared_at, published_at, retention_until, updated_at
          ) VALUES (?, ?, ?, ?, 'prepared', ?, ?, ?, 1, 0, ?, NULL, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            edition_type = excluded.edition_type,
            local_date = excluded.local_date,
            timezone = excluded.timezone,
            state = 'prepared',
            payload_json = excluded.payload_json,
            html_path = excluded.html_path,
            content_digest = excluded.content_digest,
            preview_enabled = 1,
            is_current = 0,
            prepared_at = excluded.prepared_at,
            published_at = NULL,
            retention_until = excluded.retention_until,
            updated_at = excluded.updated_at
        `)
        .run(
          payload.edition.id,
          payload.edition.type,
          payload.edition.localDate,
          payload.edition.timezone,
          payloadJson,
          storedHtmlPath,
          digest,
          timestamp,
          payload.edition.retentionUntil,
          timestamp,
        );

      database.prepare("DELETE FROM edition_items WHERE edition_id = ?").run(payload.edition.id);
      const insertItem = database.prepare(`
        INSERT INTO edition_items (
          edition_id, item_id, item_type, story_fingerprint, topic_ids_json,
          read_at, reaction, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const upsertTopic = database.prepare(`
        INSERT INTO topic_registry (id, label, aliases_json, status, created_at, updated_at)
        VALUES (?, ?, '[]', 'active', ?, ?)
        ON CONFLICT(id) DO UPDATE SET label = excluded.label, updated_at = excluded.updated_at
      `);
      for (const item of items) {
        const previousItem = priorState.get(item.itemId);
        insertItem.run(
          payload.edition.id,
          item.itemId,
          item.itemType,
          item.storyFingerprint,
          JSON.stringify(item.topics.map((topic) => topic.id)),
          previousItem?.read_at ?? null,
          previousItem?.reaction ?? null,
          timestamp,
        );
        for (const topic of item.topics) {
          upsertTopic.run(topic.id, topic.label, timestamp, timestamp);
        }
      }
      database.prepare("DELETE FROM source_batches WHERE edition_id = ?").run(payload.edition.id);
      database.prepare("DELETE FROM telegram_validation_receipts WHERE edition_id = ?").run(
        payload.edition.id,
      );
      const insertBatch = database.prepare(`
        INSERT INTO source_batches (
          edition_id, source_key, source_provider, provider_source_id,
          min_item_id, max_item_id, item_ids_json, state,
          committed_at, error_code
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const batch of payload.sourceBatches ?? []) {
        const prior = priorBatches.get(batch.sourceKey);
        const preserveCommit = prior?.state === "committed" && prior.max_item_id === batch.maxItemId;
        insertBatch.run(
          payload.edition.id,
          batch.sourceKey,
          batch.provider,
          batch.providerSourceId,
          batch.minItemId,
          batch.maxItemId,
          JSON.stringify(batch.itemIds),
          preserveCommit ? "committed" : "prepared",
          preserveCommit ? prior.committed_at : null,
          preserveCommit ? null : prior?.error_code ?? null,
        );
      }
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
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

function telegramBatchMap(payload: BriefingPayload): Map<string, {
  providerSourceId: string;
  itemIds: string[];
  maxItemId: string;
}> {
  return new Map((payload.sourceBatches ?? []).map((batch) => [batch.sourceKey, {
    providerSourceId: batch.providerSourceId,
    itemIds: [...batch.itemIds].sort(),
    maxItemId: batch.maxItemId,
  }]));
}

function assertValidationMatchesPayload(payload: BriefingPayload, report: TelegramBatchReport): void {
  const batches = telegramBatchMap(payload);
  const reports = new Map(report.channels
    .filter((channel) => channel.itemIds.length > 0)
    .map((channel) => [`telegram:${channel.sourceKey}`, channel]));
  if (batches.size !== reports.size) {
    fail(`Telegram validation covers ${reports.size} non-empty sources; payload contains ${batches.size}`);
  }
  for (const [sourceKey, batch] of batches) {
    const channel = reports.get(sourceKey);
    if (!channel) fail(`Telegram validation is missing ${sourceKey}`);
    if (String(channel.channelId) !== batch.providerSourceId) {
      fail(`Telegram validation channel ID differs for ${sourceKey}`);
    }
    const itemIds = channel.itemIds.map(String).sort();
    if (itemIds.length !== batch.itemIds.length
      || itemIds.some((itemId, index) => itemId !== batch.itemIds[index])) {
      fail(`Telegram validation item IDs differ for ${sourceKey}`);
    }
    if (channel.upperMessageId === null || String(channel.upperMessageId) !== batch.maxItemId) {
      fail(`Telegram validation upper boundary differs for ${sourceKey}`);
    }
  }
}

export function recordTelegramValidation(
  database: DatabaseSync,
  editionId: string,
  report: TelegramBatchReport,
  digests: { raw: string; normalized: string },
): void {
  const edition = loadEdition(database, { id: editionId });
  if (!edition || edition.state !== "prepared") fail("Telegram validation requires a prepared edition");
  const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  if (payload.schemaVersion !== 2) fail("Telegram validation requires schemaVersion 2");
  assertTelegramStoryCoverage(payload);
  assertValidationMatchesPayload(payload, report);
  const timestamp = now();
  database.prepare(`
    INSERT INTO telegram_validation_receipts (
      edition_id, raw_digest, normalized_digest, report_json,
      commit_plan_json, commit_plan_digest, validated_at, planned_at
    ) VALUES (?, ?, ?, ?, NULL, NULL, ?, NULL)
    ON CONFLICT(edition_id) DO UPDATE SET
      raw_digest = excluded.raw_digest,
      normalized_digest = excluded.normalized_digest,
      report_json = excluded.report_json,
      commit_plan_json = NULL,
      commit_plan_digest = NULL,
      validated_at = excluded.validated_at,
      planned_at = NULL
  `).run(
    editionId,
    digests.raw,
    digests.normalized,
    JSON.stringify(report),
    timestamp,
  );
}

function storyMediaExpectations(
  payload: BriefingPayload,
  report: TelegramBatchReport,
): Map<string, Set<string>> {
  const availableMedia = new Set(report.channels.flatMap((channel) =>
    channel.mediaItemIds.map((itemId) => `telegram:${channel.sourceKey}:${itemId}`)
  ));
  const result = new Map<string, Set<string>>();
  for (const story of payload.news.items) {
    const expected = new Set<string>();
    const sources = Array.isArray(story.sources) ? story.sources : [];
    for (const sourceValue of sources) {
      if (typeof sourceValue !== "object" || sourceValue === null || Array.isArray(sourceValue)) continue;
      const source = sourceValue as Record<string, unknown>;
      const sourceKey = typeof source.sourceKey === "string"
        ? source.sourceKey
        : typeof source.sourceId === "string" ? `telegram:${source.sourceId}` : "";
      const canonicalSourceKey = sourceKey.startsWith("telegram:") ? sourceKey : `telegram:${sourceKey}`;
      const itemIds = new Set(Array.isArray(source.itemIds)
        ? source.itemIds.filter((itemId): itemId is string => typeof itemId === "string")
        : []);
      const mediaItemIds = Array.isArray(source.mediaMessageIds)
        ? source.mediaMessageIds.filter((itemId): itemId is string => typeof itemId === "string")
        : [];
      for (const itemId of mediaItemIds) {
        if (!itemIds.has(itemId)) fail(`Story ${story.id} media item ${itemId} is not a source item`);
        const key = `${canonicalSourceKey}:${itemId}`;
        if (!availableMedia.has(key)) fail(`Story ${story.id} claims unknown Telegram media ${key}`);
        expected.add(key);
      }
      for (const itemId of itemIds) {
        const key = `${canonicalSourceKey}:${itemId}`;
        if (availableMedia.has(key) && !expected.has(key)) {
          fail(`Story ${story.id} omitted retained Telegram media ${key}`);
        }
      }
    }
    if (expected.size > 12) fail(`Story ${story.id} exceeds the twelve-asset media limit`);
    const imported = new Set((story.media ?? []).map((asset) =>
      asset.sourceKey && asset.providerItemId ? `${asset.sourceKey}:${asset.providerItemId}` : ""
    ));
    imported.delete("");
    if (expected.size !== (story.media?.length ?? 0) || imported.size !== expected.size
      || [...expected].some((key) => !imported.has(key))) {
      fail(`Story ${story.id} imported ${(story.media?.length ?? 0)} of ${expected.size} expected media assets`);
    }
    result.set(story.id, expected);
  }
  return result;
}

export function createTelegramCommitPlan(
  database: DatabaseSync,
  editionId: string,
): TelegramCommitPlan {
  const edition = loadEdition(database, { id: editionId });
  if (!edition || edition.state !== "prepared") fail("Telegram commit plan requires a prepared edition");
  const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  if (payload.schemaVersion !== 2) fail("Telegram commit plan requires schemaVersion 2");
  assertTelegramStoryCoverage(payload);
  const receipt = database.prepare(`
    SELECT report_json FROM telegram_validation_receipts WHERE edition_id = ?
  `).get(editionId) as { report_json: string } | undefined;
  if (!receipt) fail("Telegram commit plan requires a persisted raw/normalized validation receipt");
  const report = JSON.parse(receipt.report_json) as TelegramBatchReport;
  if (report.complete !== true) {
    fail("Telegram commit plan requires a complete raw/normalized capture");
  }
  assertValidationMatchesPayload(payload, report);
  storyMediaExpectations(payload, report);
  const sources = report.channels
    .filter((channel) => channel.itemIds.length > 0)
    .map((channel) => ({
      sourceKey: `telegram:${channel.sourceKey}`,
      chatId: channel.channelId,
      maxId: channel.upperMessageId!,
    }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  if (sources.some((source) => !Number.isSafeInteger(source.chatId)
    || !Number.isSafeInteger(source.maxId) || source.maxId < 1)) {
    fail("Telegram commit plan contains an unsafe provider identifier");
  }
  const planBody = { editionId, sources };
  const planDigest = createHash("sha256").update(JSON.stringify(planBody)).digest("hex");
  const plan = { ...planBody, planDigest };
  const timestamp = now();
  database.prepare(`
    UPDATE telegram_validation_receipts
    SET commit_plan_json = ?, commit_plan_digest = ?, planned_at = ?
    WHERE edition_id = ?
  `).run(JSON.stringify(plan), planDigest, timestamp, editionId);
  return plan;
}

export function loadEdition(
  database: DatabaseSync,
  selector: { id?: string; type?: "daily" | "cinema"; date?: string; current?: boolean },
): EditionRow | null {
  if (selector.id) {
    return (database.prepare("SELECT * FROM editions WHERE id = ?").get(selector.id) as
      | EditionRow
      | undefined) ?? null;
  }
  if (selector.current && selector.type) {
    return (database
      .prepare("SELECT * FROM editions WHERE edition_type = ? AND is_current = 1")
      .get(selector.type) as EditionRow | undefined) ?? null;
  }
  if (selector.type && selector.date) {
    return (database
      .prepare("SELECT * FROM editions WHERE edition_type = ? AND local_date = ?")
      .get(selector.type, selector.date) as EditionRow | undefined) ?? null;
  }
  fail("Incomplete edition selector");
}

export async function readEditionHtml(
  edition: EditionRow,
  paths: BriefingPaths = briefingPaths(),
): Promise<string> {
  return readFile(resolvedHtmlPath(paths, edition.html_path), "utf8");
}

function immutableNewsDigest(payload: BriefingPayload): string {
  return createHash("sha256")
    .update(JSON.stringify({ news: payload.news, sourceBatches: payload.sourceBatches ?? [] }))
    .digest("hex");
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
): Promise<{ editionId: string; digest: string }> {
  const payload = parseBriefingPayload(payloadValue);
  validateRenderedHtml(html, payload);
  const database = openBriefingDatabase(paths);
  let edition: EditionRow;
  let previousPayload: BriefingPayload;
  try {
    const loaded = loadEdition(database, { id: payload.edition.id });
    if (!loaded || (loaded.state !== "complete" && loaded.state !== "partial")) {
      fail("Dynamic refresh requires a published edition");
    }
    if (loaded.content_digest !== expectedContentDigest) {
      fail("Dynamic refresh lost its optimistic edition lock");
    }
    edition = loaded;
    previousPayload = parseBriefingPayload(JSON.parse(loaded.payload_json) as unknown);
    if (immutableNewsDigest(previousPayload) !== immutableNewsDigest(payload)) {
      fail("Dynamic refresh attempted to change frozen news or source batches");
    }
    if (previousPayload.edition.id !== payload.edition.id
      || previousPayload.edition.generatedAt !== payload.edition.generatedAt
      || previousPayload.edition.retentionUntil !== payload.edition.retentionUntil) {
      fail("Dynamic refresh attempted to change the immutable edition envelope");
    }
  } finally {
    database.close();
  }

  const payloadJson = JSON.stringify(payload);
  const digest = createHash("sha256").update(payloadJson).update("\0").update(html).digest("hex");
  const htmlPath = resolvedHtmlPath(paths, edition.html_path);
  const previousHtml = await readFile(htmlPath, "utf8");

  const writable = openBriefingDatabase(paths);
  let wroteHtml = false;
  try {
    const timestamp = now();
    writable.exec("BEGIN IMMEDIATE");
    try {
      const current = loadEdition(writable, { id: payload.edition.id });
      if (!current || current.content_digest !== expectedContentDigest) {
        fail("Dynamic refresh lost its optimistic edition lock");
      }
      await atomicWrite(htmlPath, html);
      wroteHtml = true;
      const priorMail = writable.prepare(`
        SELECT item_id, read_at FROM edition_items
        WHERE edition_id = ? AND item_type = 'mail'
      `).all(payload.edition.id) as Array<{ item_id: string; read_at: string | null }>;
      const priorRead = new Map(priorMail.map((item) => [item.item_id, item.read_at]));
      writable.prepare(`DELETE FROM edition_items WHERE edition_id = ? AND item_type = 'mail'`)
        .run(payload.edition.id);
      const insert = writable.prepare(`
        INSERT INTO edition_items (
          edition_id, item_id, item_type, story_fingerprint,
          topic_ids_json, read_at, reaction, updated_at
        ) VALUES (?, ?, 'mail', NULL, '[]', ?, NULL, ?)
      `);
      for (const item of payload.mail.items) {
        insert.run(payload.edition.id, item.id, priorRead.get(item.id) ?? null, timestamp);
      }
      writable.prepare(`
        UPDATE editions
        SET payload_json = ?, content_digest = ?, updated_at = ?
        WHERE id = ? AND content_digest = ?
      `).run(payloadJson, digest, timestamp, payload.edition.id, expectedContentDigest);
      writable.exec("COMMIT");
    } catch (error) {
      writable.exec("ROLLBACK");
      if (wroteHtml) await atomicWrite(htmlPath, previousHtml);
      throw error;
    }
  } finally {
    writable.close();
  }
  return { editionId: payload.edition.id, digest };
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
  const mailById = new Map(payload.mail.items.map((item) => [item.id, item]));
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
): { editionId: string; state: "complete" | "partial"; publicationPath: string } {
  const edition = loadEdition(database, { id: editionId });
  if (!edition) fail("Unknown briefing edition");
  if (edition.state === "complete" || edition.state === "partial") {
    return {
      editionId,
      state: edition.state,
      publicationPath: edition.edition_type === "daily" ? `/daily/${edition.local_date}` : "/cinema",
    };
  }
  if (edition.state !== "prepared") fail("Briefing edition is not prepared");
  const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  assertProductionBriefingPayload(payload);
  const batches = database.prepare(`
    SELECT source_key, source_provider, max_item_id, state
    FROM source_batches WHERE edition_id = ? ORDER BY source_key
  `).all(editionId) as Array<{
    source_key: string;
    source_provider: string;
    max_item_id: string | null;
    state: "prepared" | "committed" | "failed" | "skipped";
  }>;
  if (edition.edition_type === "daily" && batches.length < 1) {
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
    database.prepare(`
      UPDATE editions SET is_current = 0, updated_at = ?
      WHERE edition_type = ? AND is_current = 1
    `).run(timestamp, edition.edition_type);
    database.prepare(`
      UPDATE editions
      SET state = ?, is_current = 1, published_at = ?, updated_at = ?
      WHERE id = ? AND state = 'prepared'
    `).run(state, timestamp, timestamp, editionId);
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

export function setReaction(
  database: DatabaseSync,
  editionId: string,
  itemId: string,
  reaction: Reaction | "clear",
): void {
  const item = database
    .prepare(`
      SELECT story_fingerprint, topic_ids_json
      FROM edition_items
      WHERE edition_id = ? AND item_id = ? AND item_type = 'story'
    `)
    .get(editionId, itemId) as
    | { story_fingerprint: string | null; topic_ids_json: string }
    | undefined;
  if (!item?.story_fingerprint) fail("Unknown briefing story");
  const timestamp = now();
  database.exec("BEGIN IMMEDIATE");
  try {
    database
      .prepare("UPDATE edition_items SET reaction = ?, updated_at = ? WHERE edition_id = ? AND item_id = ?")
      .run(reaction === "clear" ? null : reaction, timestamp, editionId, itemId);
    database
      .prepare(`
        INSERT INTO reaction_events (
          story_fingerprint, topic_ids_json, reaction, recorded_at
        ) VALUES (?, ?, ?, ?)
      `)
      .run(item.story_fingerprint, item.topic_ids_json, reaction, timestamp);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function topicProfile(database: DatabaseSync): TopicProfileRow[] {
  return database
    .prepare(`
      WITH ranked AS (
        SELECT story_fingerprint, topic_ids_json, reaction,
               ROW_NUMBER() OVER (
                 PARTITION BY story_fingerprint ORDER BY event_id DESC
               ) AS position
        FROM reaction_events
      ), current_reactions AS (
        SELECT story_fingerprint, topic_ids_json, reaction
        FROM ranked
        WHERE position = 1 AND reaction != 'clear'
      )
      SELECT topics.value AS topic_id,
             COALESCE(registry.label, topics.value) AS label,
             SUM(CASE WHEN current_reactions.reaction = 'like' THEN 1 ELSE 0 END) AS likes,
             SUM(CASE WHEN current_reactions.reaction = 'dislike' THEN 1 ELSE 0 END) AS dislikes
      FROM current_reactions, json_each(current_reactions.topic_ids_json) AS topics
      LEFT JOIN topic_registry registry ON registry.id = topics.value
      GROUP BY topics.value, registry.label
      ORDER BY likes DESC, dislikes ASC, topics.value ASC
    `)
    .all()
    .map((row) => {
      const value = row as { topic_id: string; label: string; likes: number; dislikes: number };
      return {
        topicId: value.topic_id,
        label: value.label,
        likes: Number(value.likes),
        dislikes: Number(value.dislikes),
      };
    });
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
    for (const root of [
      paths.runsDirectory,
      paths.recoveryDirectory,
      paths.artifactsDirectory,
      paths.stateArtifactsDirectory,
    ]) {
      const children = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      });
      for (const child of children) {
        if (!child.isDirectory() || !child.name.includes(edition.local_date)) continue;
        await rm(resolve(root, child.name), { recursive: true, force: true });
      }
    }
  }
  try {
    database.exec("BEGIN IMMEDIATE");
    try {
      const remove = database.prepare("DELETE FROM editions WHERE id = ?");
      for (const edition of expired) remove.run(edition.id);
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

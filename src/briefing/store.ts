import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import {
  parseBriefingPayload,
  persistedItems,
  type BriefingPayload,
  type Reaction,
} from "./model.ts";

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
  };
}

function now(): string {
  return new Date().toISOString();
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
  validateRenderedHtml(html, payload);
  await initializeBriefingStore(paths);

  const currentDatabase = openBriefingDatabase(paths);
  try {
    const existing = currentDatabase.prepare("SELECT state FROM editions WHERE id = ?").get(
      payload.edition.id,
    ) as { state: EditionRow["state"] } | undefined;
    if (existing && (existing.state === "complete" || existing.state === "partial")) {
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
  const payload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
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
      SELECT id, edition_type, local_date, html_path
      FROM editions
      WHERE edition_type = 'daily' AND retention_until <= ?
    `)
    .all(currentTime) as Array<{
    id: string;
    edition_type: "daily" | "cinema";
    local_date: string;
    html_path: string;
  }>;
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
  for (const edition of expired) {
    await unlink(resolvedHtmlPath(paths, edition.html_path)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    await rm(resolve(paths.mediaDirectory, edition.edition_type, edition.local_date), {
      recursive: true,
      force: true,
    });
  }
  return { deleted: expired.map((edition) => edition.id) };
}

import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { newsBatches, section } from "./addons/envelopes.ts";
import type { TopicPolicy } from "./editorial-validation.ts";
import { atomicWrite, relativeHtmlPath, resolvedHtmlPath } from "./html-artifacts.ts";
import { persistedItems, type BriefingPayload, type Reaction } from "./model.ts";
import type { BriefingPaths } from "./paths.ts";

export async function persistPreparedPreview(
  database: DatabaseSync,
  payload: BriefingPayload,
  html: string,
  paths: BriefingPaths,
  topicPolicy: TopicPolicy,
): Promise<string> {
  const payloadJson = JSON.stringify(payload);
  const digest = createHash("sha256").update(payloadJson).update("\0").update(html).digest("hex");
  const storedHtmlPath = relativeHtmlPath(paths, payload);
  const htmlPath = resolvedHtmlPath(paths, storedHtmlPath);
  const previousHtml = await readFile(htmlPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });

  let wroteHtml = false;
  const timestamp = new Date().toISOString();
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
    SELECT source_key, provider_source_id, max_item_id, item_ids_json,
           state, committed_at, error_code
    FROM source_batches WHERE edition_id = ?
  `).all(payload.edition.id) as Array<{
    source_key: string;
    provider_source_id: string;
    max_item_id: string | null;
    item_ids_json: string;
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
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        aliases_json = CASE
          WHEN excluded.aliases_json = '[]' THEN topic_registry.aliases_json
          ELSE excluded.aliases_json
        END,
        status = CASE
          WHEN topic_registry.status = 'active' THEN 'active'
          ELSE excluded.status
        END,
        updated_at = excluded.updated_at
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
        const registered = topicPolicy.topics.get(topic.id);
        upsertTopic.run(
          topic.id,
          topic.label,
          JSON.stringify(topic.aliases ?? registered?.aliases ?? []),
          topic.status ?? registered?.status ?? "active",
          timestamp,
          timestamp,
        );
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
    for (const batch of newsBatches(payload) ?? []) {
      const prior = priorBatches.get(batch.sourceKey);
      const preserveCommit = prior?.state === "committed"
        && prior.provider_source_id === batch.providerSourceId
        && prior.max_item_id === batch.maxItemId
        && prior.item_ids_json === JSON.stringify(batch.itemIds);
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
    const insertOccurrence = database.prepare(`
      INSERT OR IGNORE INTO topic_story_occurrences (
        topic_id, edition_id, story_fingerprint, source_key, observed_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const story of section(payload, "news").items) {
      const sourceKeys = new Set(
        (Array.isArray(story.sources) ? story.sources : [])
          .map((source) => source && typeof source === "object" && !Array.isArray(source)
            ? (source as Record<string, unknown>).sourceKey
            : null)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      );
      if (sourceKeys.size === 0) sourceKeys.add(`edition:${payload.edition.id}`);
      for (const topic of story.topics) {
        for (const sourceKey of sourceKeys) {
          insertOccurrence.run(topic.id, payload.edition.id, story.fingerprint, sourceKey, timestamp);
        }
      }
    }
    database.prepare(`
      UPDATE topic_registry
      SET status = 'active', updated_at = ?
      WHERE status = 'proposed'
        AND id IN (
          SELECT topic_id
          FROM topic_story_occurrences
          GROUP BY topic_id
          HAVING COUNT(DISTINCT story_fingerprint) >= ?
            AND (
              COUNT(DISTINCT edition_id) >= ?
              OR COUNT(DISTINCT source_key) >= ?
            )
        )
    `).run(
      timestamp,
      topicPolicy.promotion.minimumStoryCount,
      topicPolicy.promotion.minimumEditionOrSourceCount,
      topicPolicy.promotion.minimumEditionOrSourceCount,
    );
    await atomicWrite(htmlPath, html);
    wroteHtml = true;
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    if (wroteHtml) {
      if (previousHtml === null) await unlink(htmlPath).catch(() => undefined);
      else await atomicWrite(htmlPath, previousHtml);
    }
    throw error;
  }

  return digest;
}

import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { newsBatches, section, setSection } from "./addons/envelopes.ts";
import { addonEnvelopeDigest } from "./addons/snapshot-store.ts";
import { loadEdition, type EditionRow } from "./edition-store.ts";
import { assertEditorialPayload, loadTopicPolicy } from "./editorial-validation.ts";
import { assertTelegramStoryCoverage } from "./coverage.ts";
import { atomicWrite, resolvedHtmlPath, validateRenderedHtml } from "./html-artifacts.ts";
import { topicRegistry } from "./interest-profile-store.ts";
import { parseBriefingPayload, type BriefingPayload, type Reaction } from "./model.ts";
import type { BriefingPaths } from "./paths.ts";
import { persistOptionalWeekly } from "./weekly/persistence.ts";

function fail(message: string): never {
  throw new Error(message);
}

function stableSourceOwnership(payload: BriefingPayload): string {
  return JSON.stringify(section(payload, "news").items.map((story) => ({
    id: story.id,
    fingerprint: story.fingerprint,
    sources: (Array.isArray(story.sources) ? story.sources : [])
      .map((source) => ({
        sourceKey: typeof source.sourceKey === "string" ? source.sourceKey : "",
        itemIds: Array.isArray(source.itemIds)
          ? source.itemIds.filter((value): value is string => typeof value === "string").sort()
          : [],
      }))
      .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)),
  })).sort((left, right) => left.id.localeCompare(right.id)));
}

function stableSourceBatches(payload: BriefingPayload): string {
  return JSON.stringify((newsBatches(payload) ?? []).map((batch) => ({
    sourceKey: batch.sourceKey,
    providerSourceId: batch.providerSourceId,
    minItemId: batch.minItemId,
    maxItemId: batch.maxItemId,
    itemIds: [...batch.itemIds].sort(),
  })).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey)));
}

function stableExclusions(payload: BriefingPayload): string {
  return JSON.stringify([...(section(payload, "news").exclusions ?? [])].sort((left, right) =>
    `${left.sourceKey}:${left.itemId}`.localeCompare(`${right.sourceKey}:${right.itemId}`)
  ));
}

export async function persistPublishedRevision(
  database: DatabaseSync,
  revision: BriefingPayload,
  renderer: (payload: BriefingPayload) => string,
  paths: BriefingPaths,
): Promise<{ editionId: string; publicationPath: string; digest: string; state: "complete" | "partial" }> {
  const edition = loadEdition(database, { id: revision.edition.id });
  if (!edition || (edition.state !== "complete" && edition.state !== "partial")) {
    fail(`Edition ${revision.edition.id} is not published`);
  }
  const existing = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  if (
    revision.edition.type !== existing.edition.type
    || revision.edition.localDate !== existing.edition.localDate
    || revision.edition.timezone !== existing.edition.timezone
  ) {
    fail("Published revision cannot change edition identity");
  }
  if (stableSourceBatches(revision) !== stableSourceBatches(existing)) {
    fail("Published revision cannot change source batches");
  }
  if (stableSourceOwnership(revision) !== stableSourceOwnership(existing)) {
    fail("Published revision cannot regroup, add, or remove stories");
  }
  if (stableExclusions(revision) !== stableExclusions(existing)) {
    fail("Published revision cannot change exclusions");
  }

  const states = database
    .prepare("SELECT item_id, read_at, reaction FROM edition_items WHERE edition_id = ?")
    .all(edition.id) as Array<{
    item_id: string;
    read_at: string | null;
    reaction: Reaction | null;
  }>;
  const stateById = new Map(states.map((state) => [state.item_id, state]));
  const existingById = new Map(section(existing, "news").items.map((story) => [story.id, story]));
  const { notes: _existingNotes, ...stableExisting } = structuredClone(existing);
  const revisedStories = section(revision, "news").items.map((story) => {
    const prior = existingById.get(story.id)!;
    const state = stateById.get(story.id);
    const { media: _revisionMedia, readState: _revisionReadState, reaction: _revisionReaction, ...editorial } = story;
    return {
      ...editorial,
      ...(prior.media ? { media: prior.media } : {}),
      ...(state?.read_at ? { readState: "read" } : {}),
      ...(state?.reaction ? { reaction: state.reaction } : {}),
    };
  });
  const revisedNotes = revision.notes?.map((note) =>
    note.target.startsWith("story:") ? { ...note, mark: "arrow-down-left" as const } : note
  );
  if (stableExisting.addons.news) setSection(stableExisting, "news", { ...section(revision, "news"), items: revisedStories });
  const candidate = parseBriefingPayload({
    ...stableExisting,
    ...(revisedNotes ? { notes: revisedNotes } : {}),
  });
  const topicPolicy = await loadTopicPolicy(paths.home, process.env, topicRegistry(database));
  assertEditorialPayload(candidate, topicPolicy);
  if (candidate.schemaVersion === 2 && candidate.edition.type === "daily" && newsBatches(candidate)?.length) {
    assertTelegramStoryCoverage(candidate);
  }
  const html = renderer(candidate);
  validateRenderedHtml(html, candidate);
  const payloadJson = JSON.stringify(candidate);
  const digest = createHash("sha256").update(payloadJson).update("\0").update(html).digest("hex");
  const htmlPath = resolvedHtmlPath(paths, edition.html_path);
  const previousHtml = await readFile(htmlPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const timestamp = new Date().toISOString();
  let wroteHtml = false;

  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare(`
      UPDATE editions
      SET payload_json = ?, content_digest = ?, updated_at = ?
      WHERE id = ?
    `).run(payloadJson, digest, timestamp, edition.id);
    const updateItem = database.prepare(`
      UPDATE edition_items
      SET story_fingerprint = ?, topic_ids_json = ?, updated_at = ?
      WHERE edition_id = ? AND item_id = ? AND item_type = 'story'
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
    database.prepare("DELETE FROM topic_story_occurrences WHERE edition_id = ?").run(edition.id);
    const insertOccurrence = database.prepare(`
      INSERT OR IGNORE INTO topic_story_occurrences (
        topic_id, edition_id, story_fingerprint, source_key, observed_at
      ) VALUES (?, ?, ?, ?, ?)
    `);
    for (const story of section(candidate, "news").items) {
      const update = updateItem.run(
        story.fingerprint,
        JSON.stringify(story.topics.map((topic) => topic.id)),
        timestamp,
        edition.id,
        story.id,
      );
      if (update.changes !== 1) fail(`Published revision is missing item state for ${story.id}`);
      const sourceKeys = new Set((Array.isArray(story.sources) ? story.sources : [])
        .map((source) => typeof source.sourceKey === "string" ? source.sourceKey : "")
        .filter(Boolean));
      if (!sourceKeys.size) sourceKeys.add(`edition:${edition.id}`);
      for (const topic of story.topics) {
        const registered = topicPolicy.topics.get(topic.id);
        upsertTopic.run(
          topic.id,
          topic.label,
          JSON.stringify(topic.aliases ?? registered?.aliases ?? []),
          topic.status ?? registered?.status ?? "active",
          timestamp,
          timestamp,
        );
        for (const sourceKey of sourceKeys) {
          insertOccurrence.run(topic.id, edition.id, story.fingerprint, sourceKey, timestamp);
        }
      }
    }
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
  return {
    editionId: edition.id,
    publicationPath: `/${candidate.edition.type}/${candidate.edition.localDate}`,
    digest,
    state: edition.state,
  };
}

function immutableNewsDigest(payload: BriefingPayload): string {
  return createHash("sha256")
    .update(JSON.stringify({ news: section(payload, "news"), sourceBatches: newsBatches(payload) ?? [], newsAddon: payload.addons?.news }))
    .digest("hex");
}

export function inspectDynamicRefresh(
  database: DatabaseSync,
  payload: BriefingPayload,
  expectedContentDigest: string,
  options: { prepared?: boolean },
): EditionRow {
  const edition = loadEdition(database, { id: payload.edition.id });
  if (!edition || (edition.state !== "complete" && edition.state !== "partial" && !(options.prepared && edition.state === "prepared"))) {
    fail("Dynamic refresh requires a published edition");
  }
  if (edition.content_digest !== expectedContentDigest) {
    fail("Dynamic refresh lost its optimistic edition lock");
  }
  const previousPayload = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  if (previousPayload.addons.stocks && (edition.state === "complete" || edition.state === "partial")
    && (!payload.addons.stocks || addonEnvelopeDigest(previousPayload.addons.stocks) !== addonEnvelopeDigest(payload.addons.stocks))) {
    fail("Dynamic refresh attempted to change the frozen stocks snapshot");
  }
  if (immutableNewsDigest(previousPayload) !== immutableNewsDigest(payload)) {
    fail("Dynamic refresh attempted to change frozen news or source batches");
  }
  if (previousPayload.edition.id !== payload.edition.id
    || previousPayload.edition.generatedAt !== payload.edition.generatedAt
    || previousPayload.edition.retentionUntil !== payload.edition.retentionUntil) {
    fail("Dynamic refresh attempted to change the immutable edition envelope");
  }
  return edition;
}

export async function persistDynamicRefresh(
  database: DatabaseSync,
  payload: BriefingPayload,
  html: string,
  expectedContentDigest: string,
  edition: EditionRow,
  paths: BriefingPaths,
): Promise<{ editionId: string; digest: string }> {
  const payloadJson = JSON.stringify(payload);
  const digest = createHash("sha256").update(payloadJson).update("\0").update(html).digest("hex");
  const htmlPath = resolvedHtmlPath(paths, edition.html_path);
  const previousHtml = await readFile(htmlPath, "utf8");
  let wroteHtml = false;
  const timestamp = new Date().toISOString();

  database.exec("BEGIN IMMEDIATE");
  try {
    const current = loadEdition(database, { id: payload.edition.id });
    if (!current || current.content_digest !== expectedContentDigest) {
      fail("Dynamic refresh lost its optimistic edition lock");
    }
    if (current.state === "prepared") {
      // The new content lock needs its own Telegram acknowledgement.
      database.prepare("DELETE FROM telegram_validation_receipts WHERE edition_id = ?").run(payload.edition.id);
    }
    await atomicWrite(htmlPath, html);
    wroteHtml = true;
    const priorMail = database.prepare(`
      SELECT item_id, read_at FROM edition_items
      WHERE edition_id = ? AND item_type = 'mail'
    `).all(payload.edition.id) as Array<{ item_id: string; read_at: string | null }>;
    const priorRead = new Map(priorMail.map((item) => [item.item_id, item.read_at]));
    database.prepare("DELETE FROM edition_items WHERE edition_id = ? AND item_type = 'mail'")
      .run(payload.edition.id);
    const insert = database.prepare(`
      INSERT INTO edition_items (
        edition_id, item_id, item_type, story_fingerprint,
        topic_ids_json, read_at, reaction, updated_at
      ) VALUES (?, ?, 'mail', NULL, '[]', ?, NULL, ?)
    `);
    for (const item of section(payload, "mail").items) {
      insert.run(payload.edition.id, item.id, priorRead.get(item.id) ?? null, timestamp);
    }
    database.prepare(`
      UPDATE editions
      SET payload_json = ?, content_digest = ?, updated_at = ?
      WHERE id = ? AND content_digest = ?
    `).run(payloadJson, digest, timestamp, payload.edition.id, expectedContentDigest);
    if (current.state !== "prepared") persistOptionalWeekly(database, payload, timestamp, "refresh");
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    if (wroteHtml) await atomicWrite(htmlPath, previousHtml);
    throw error;
  }
  return { editionId: payload.edition.id, digest };
}

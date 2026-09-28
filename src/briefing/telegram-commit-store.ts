import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { assertTelegramStoryCoverage } from "./coverage.ts";
import { loadEdition } from "./edition-store.ts";
import { parseBriefingPayload, type BriefingPayload } from "./model.ts";
import { newsBatches, section } from "./addons/envelopes.ts";
import type { TelegramBatchReport } from "./telegram-batch.ts";

export type TelegramCommitPlan = {
  editionId: string;
  planDigest: string;
  sources: Array<{
    sourceKey: string;
    chatId: number;
    maxId: number;
  }>;
};

function now(): string {
  return new Date().toISOString();
}

function fail(message: string): never {
  throw new Error(message);
}

function telegramBatchMap(payload: BriefingPayload): Map<string, {
  providerSourceId: string;
  itemIds: string[];
  maxItemId: string;
}> {
  return new Map((newsBatches(payload) ?? []).map((batch) => [batch.sourceKey, {
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
  for (const story of section(payload, "news").items) {
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

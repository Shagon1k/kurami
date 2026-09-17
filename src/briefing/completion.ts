import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { section, newsBatches } from "./addons/envelopes.ts";
import { parseBriefingPayload, assertProductionBriefingPayload } from "./model.ts";
import { loadBriefingAttempt } from "./run-attempt.ts";
import { loadEdition, type BriefingPaths } from "./store.ts";
import type { DatabaseSync } from "node:sqlite";

/** The connector receives only runtime-derived identities, never AI-selected pairs. */
export async function completionContext(database: DatabaseSync, paths: BriefingPaths, editionId: string, attemptId: string) {
  const attempt = loadBriefingAttempt(database, attemptId);
  if (!attempt || attempt.editionId !== editionId || attempt.mode === "dry-run") throw new Error("Completion requires a matching production attempt");
  if (!["editorialized", "prepared", "media-ready", "commit-planned", "telegram-committed", "published", "notified"].includes(attempt.state)) {
    throw new Error("Completion requires accepted editorial content or an explicitly resumed attempt");
  }
  const runDirectory = await realpath(attempt.runDirectory);
  const runs = await realpath(paths.runsDirectory);
  const child = relative(runs, runDirectory);
  if (!child || child.startsWith("..") || resolve(runs, child) !== runDirectory) throw new Error("Invalid completion directory");
  const edition = loadEdition(database, { id: editionId });
  const payloadPath = resolve(runDirectory, "payload.json");
  let payload;
  if (attempt.state === "editorialized") {
    if (await realpath(payloadPath) !== payloadPath) throw new Error("Completion payload must not be a symlink");
    const raw = await readFile(payloadPath);
    if (createHash("sha256").update(raw).digest("hex") !== attempt.outputDigest) throw new Error("Editorial payload changed after acceptance");
    payload = parseBriefingPayload(JSON.parse(raw.toString()));
  } else {
    if (!edition || edition.state === "aborted") throw new Error("Completion edition is unavailable");
    payload = parseBriefingPayload(JSON.parse(edition.payload_json));
  }
  if (payload.edition.id !== editionId || payload.edition.type !== "daily") throw new Error("Completion edition mismatch");
  assertProductionBriefingPayload(payload);
  const pairs: Array<{chat_id: number; message_id: number}> = [];
  const seen = new Set<string>();
  for (const story of section(payload, "news").items) {
    let count = 0;
    for (const raw of story.sources ?? []) {
      const source = raw as {sourceKey?: string; mediaMessageIds?: string[]};
      for (const id of source.mediaMessageIds ?? []) {
        const chatId = Number(newsBatches(payload)?.find(batch => batch.sourceKey === source.sourceKey)?.providerSourceId);
        const messageId = Number(id), key = chatId + ":" + messageId;
        if (!Number.isSafeInteger(chatId) || !chatId || !/^\d+$/.test(id) || !Number.isSafeInteger(messageId) || messageId < 1 || seen.has(key)) {
          throw new Error("Invalid or duplicate completion media identity");
        }
        seen.add(key); pairs.push({chat_id:chatId, message_id:messageId}); count++;
      }
    }
    if (count > 12) throw new Error("Completion story exceeds image limit");
  }
  return { attempt, runDirectory, payloadPath, pairs,
    pairDigest: createHash("sha256").update(JSON.stringify(pairs)).digest("hex") };
}

/** Explicit operator recovery only; never silently restart a failed editorial stage. */
export function resumeCompletion(database: DatabaseSync, editionId: string, attemptId: string) {
  const attempt = loadBriefingAttempt(database, attemptId);
  if (!attempt || attempt.editionId !== editionId || attempt.mode === "dry-run" || attempt.state !== "failed") {
    throw new Error("Resume requires a matching failed production attempt");
  }
  const order = ["editorialized", "prepared", "media-ready", "commit-planned", "telegram-committed", "published"];
  const receipts = database.prepare("SELECT stage FROM briefing_run_stage_receipts WHERE attempt_id = ? AND state = 'complete'").all(attemptId) as Array<{stage:string}>;
  const stage = order.findLast(value => receipts.some(receipt => receipt.stage === value));
  if (!stage) throw new Error("No accepted content to resume");
  database.prepare("UPDATE briefing_run_attempts SET state = ?, error_code = NULL, completed_at = NULL, updated_at = ? WHERE attempt_id = ? AND state = 'failed'")
    .run(stage, new Date().toISOString(), attemptId);
  return loadBriefingAttempt(database, attemptId)!;
}

export function assertCompletion(database: DatabaseSync, editionId: string, attemptId: string) {
  const attempt = loadBriefingAttempt(database, attemptId), edition = loadEdition(database, {id:editionId});
  const notified = database.prepare("SELECT state FROM release_notification_receipts WHERE edition_id = ?").get(editionId) as {state:string}|undefined;
  if (attempt?.editionId !== editionId || attempt.state !== "notified" || !edition || !["complete","partial"].includes(edition.state) || notified?.state !== "complete") {
    throw new Error("Briefing completion not proven: published edition and notification receipt required");
  }
  return {editionId, state:edition.state, notified:true};
}

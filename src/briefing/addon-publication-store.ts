import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { loadAddonSnapshot, upsertAddonSnapshot } from "./addons/snapshot-store.ts";
import { loadEdition } from "./edition-store.ts";
import { atomicWrite, resolvedHtmlPath } from "./html-artifacts.ts";
import { parseBriefingPayload, type BriefingAddonEnvelope, type BriefingPayload } from "./model.ts";
import type { BriefingPaths } from "./paths.ts";

function fail(message: string): never {
  throw new Error(message);
}

export async function persistPublishedAddonReplacement(
  database: DatabaseSync,
  payload: BriefingPayload,
  html: string,
  addonId: string,
  envelope: BriefingAddonEnvelope,
  paths: BriefingPaths,
): Promise<{ editionId: string; digest: string; state: "complete" | "partial" }> {
  const edition = loadEdition(database, { id: payload.edition.id });
  if (!edition || (edition.state !== "complete" && edition.state !== "partial") || edition.is_current !== 1) {
    fail(`Add-on edition ${payload.edition.id} is not the current published edition`);
  }
  const existing = parseBriefingPayload(JSON.parse(edition.payload_json) as unknown);
  if (existing.edition.type !== payload.edition.type
    || existing.edition.localDate !== payload.edition.localDate
    || existing.edition.timezone !== payload.edition.timezone) {
    fail("Add-on replacement cannot change edition identity");
  }
  const currentSnapshot = loadAddonSnapshot(database, addonId);
  if (currentSnapshot && Date.parse(envelope.capturedAt) < Date.parse(currentSnapshot.envelope.capturedAt)) {
    fail(`Replacement ${addonId} snapshot is older than the current snapshot`);
  }

  const payloadJson = JSON.stringify(payload);
  const digest = createHash("sha256").update(payloadJson).update("\0").update(html).digest("hex");
  const htmlPath = resolvedHtmlPath(paths, edition.html_path);
  const previousHtml = await readFile(htmlPath, "utf8");
  const timestamp = new Date().toISOString();
  const state = payload.edition.status;
  let wroteHtml = false;

  database.exec("BEGIN IMMEDIATE");
  try {
    await atomicWrite(htmlPath, html);
    wroteHtml = true;
    const update = database.prepare(`
      UPDATE editions
      SET state = ?, payload_json = ?, content_digest = ?, updated_at = ?
      WHERE id = ? AND is_current = 1
    `).run(state, payloadJson, digest, timestamp, edition.id);
    if (update.changes !== 1) fail("Current add-on edition changed during replacement");
    upsertAddonSnapshot(database, addonId, envelope);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    if (wroteHtml) await atomicWrite(htmlPath, previousHtml);
    throw error;
  }
  return { editionId: edition.id, digest, state };
}

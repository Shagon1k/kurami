import type { DatabaseSync } from "node:sqlite";
import { loadEdition, retainedDailyEditions, refreshPublishedEdition, type BriefingPaths } from "../../store.ts";
import { parseBriefingPayload, briefingAddonEnabled } from "../../model.ts";
import { renderBriefingPage } from "../../ui/render-page.ts";
import { removeArchivedMail } from "./lifecycle.ts";
import { refreshDerivedAddons } from "../derived.ts";
import { refreshDataQuality } from "../quality.ts";

export async function removeArchivedMailFromRetainedEditions(
  database: DatabaseSync,
  paths: BriefingPaths,
  providerMessageIds: string[],
  currentTime?: string,
): Promise<string[]> {
  const refreshed: string[] = [];
  for (const retained of retainedDailyEditions(database, currentTime)) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const current = loadEdition(database, { id: retained.id });
      if (!current || (current.state !== "complete" && current.state !== "partial")) break;
      const payload = parseBriefingPayload(JSON.parse(current.payload_json) as unknown);
      if (!briefingAddonEnabled(payload, "mail") || !removeArchivedMail(payload, providerMessageIds)) break;
      const at = currentTime ?? new Date().toISOString();
      refreshDerivedAddons(payload, { at });
      refreshDataQuality(payload, payload.live?.refreshedAt ?? payload.edition.generatedAt);
      try {
        await refreshPublishedEdition(
          payload,
          renderBriefingPage(payload),
          current.content_digest,
          paths,
        );
        refreshed.push(current.id);
        break;
      } catch (error) {
        if (attempt === 1 || !String(error).includes("optimistic edition lock")) throw error;
      }
    }
  }
  return refreshed;
}

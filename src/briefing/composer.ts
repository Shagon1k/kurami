import { randomUUID } from "node:crypto";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DynamicBriefingSnapshot } from "./providers/dynamic-snapshot.ts";
import type { BriefingAddonEnvelope, BriefingPayload } from "./model.ts";
import { parseBriefingPayload } from "./model.ts";
import { refreshDataQuality } from "./addons/quality.ts";
import { applyLiveAddons } from "./addons/live.ts";
import { composeNews } from "./addons/news/editorial.ts";
export type { EditorialStoryDraft, EditorialBriefingDraft } from "./addons/news/editorial.ts";
import { applyDeterministicRanking } from "./ranking.ts";
import { captureAddonManifest } from "./addons/registry.ts";
import { validateTelegramBatch, type TelegramBatchReport } from "./telegram-batch.ts";
import { readBriefingAddonSwitches } from "./runtime-config.ts";

export async function composeBriefingPayload(input: {
  draftPath: string;
  livePath: string;
  configPath: string;
  rawPath: string;
  normalizedPath: string;
  outputPath?: string;
  addonSnapshots?: Record<string, BriefingAddonEnvelope>;
}): Promise<{ payload: BriefingPayload; report: TelegramBatchReport; outputPath?: string }> {
  const [draftValue, liveValue, normalizedValue, enabled] = await Promise.all([
    readFile(input.draftPath, "utf8").then(JSON.parse),
    readFile(input.livePath, "utf8").then(JSON.parse),
    readFile(input.normalizedPath, "utf8").then(JSON.parse),
    readBriefingAddonSwitches(input.configPath),
  ]);
  const snapshot = liveValue as DynamicBriefingSnapshot;
  const report = await validateTelegramBatch(input.configPath, input.rawPath, input.normalizedPath);
  const { draft, notes, news, sourceBatches } = composeNews(draftValue, normalizedValue, report);
  if (snapshot.localDate !== draft.editionId.slice(6)) throw new Error("Editorial draft and live snapshot dates differ");
  const localDate = draft.editionId.slice(6);
  const base: BriefingPayload = {
    schemaVersion: 2,
    edition: {
      id: draft.editionId,
      type: "daily",
      localDate,
      timezone: "Europe/Vilnius",
      generatedAt: draft.generatedAt,
      status: snapshot.state === "failed" || snapshot.state === "partial" ? "partial" : "complete",
      retentionUntil: new Date(Date.parse(`${localDate}T00:00:00Z`) + 5 * 86_400_000).toISOString(),
    },
    hero: {
      title: draft.hero?.title ?? "Утренний обзор",
      subtitle: draft.hero?.subtitle ?? "Главное к началу дня.",
    },
    ...(notes ? { notes } : {}),
    mail: { state: "empty", items: [] },
    calendar: { state: "empty", events: [], allDayEvents: [] },
    news,
    dataQuality: { state: "ready", summary: "" },
    sourceBatches,
  };
  base.addons = Object.fromEntries(Object.entries(captureAddonManifest(base))
    .filter(([id]) => enabled[id as keyof typeof enabled] !== false));
  applyLiveAddons(base, snapshot, {
    initial: true, refreshedAt: snapshot.refreshedAt, classifications: draft.mailClassifications,
  });
  base.edition.status = base.live?.state === "partial" ? "partial" : "complete";
  refreshDataQuality(base, snapshot.refreshedAt);
  const ranked = parseBriefingPayload(applyDeterministicRanking(base));
  const payload = parseBriefingPayload({
    ...ranked,
    addons: {
      ...captureAddonManifest(ranked),
      ...(input.addonSnapshots ?? {}),
    },
  });
  if (input.outputPath) {
    const outputPath = resolve(input.outputPath);
    const temporary = resolve(dirname(outputPath), `.${randomUUID()}.tmp`);
    await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
    await chmod(temporary, 0o600);
    await rename(temporary, outputPath);
  }
  return { payload, report, ...(input.outputPath ? { outputPath: resolve(input.outputPath) } : {}) };
}

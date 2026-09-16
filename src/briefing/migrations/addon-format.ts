/** One-way offline import. Never call this from serving, composition or polling. */
import { parseBriefingPayload, parseBriefingAddonEnvelope, type BriefingPayload, type BriefingAddonEnvelope } from "../model.ts";
import { BUILTIN_ADDON_IDS } from "../addons/envelopes.ts";

export function upgradeLegacyPayload(value: unknown): BriefingPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected legacy briefing payload");
  const root = structuredClone(value) as Record<string, any>;
  if (root.formatVersion === 3) return parseBriefingPayload(root);
  if (root.formatVersion !== undefined) throw new Error("Unsupported briefing format");
  if (root.schemaVersion !== 1 && root.schemaVersion !== 2) throw new Error("schemaVersion must equal 1 or 2");
  const declared = root.addons as Record<string, BriefingAddonEnvelope> | undefined;
  const addons = { ...declared };
  for (const id of BUILTIN_ADDON_IDS) {
    if (declared && !Object.hasOwn(declared, id)) continue;
    const prior = declared?.[id];
    if (prior) parseBriefingAddonEnvelope(prior, `addons.${id}`);
    if (prior && prior.version !== 1 && prior.version !== 2) throw new Error(`Unsupported ${id} add-on version`);
    const section = root[id] ?? prior?.data.section ?? (id === "weather"
      ? { state: "failed" } : { state: "empty", items: [], events: [], allDayEvents: [] });
    addons[id] = {
      version: 2, state: section.state,
      capturedAt: prior?.capturedAt ?? (id === "news" ? root.edition?.generatedAt : root.live?.refreshedAt ?? root.edition?.generatedAt),
      data: { section, ...(id === "news" && (root.sourceBatches ?? prior?.data.sourceBatches) !== undefined
        ? { sourceBatches: root.sourceBatches ?? prior?.data.sourceBatches } : {}) },
    };
  }
  for (const id of [...BUILTIN_ADDON_IDS, "sourceBatches"]) delete root[id];
  return parseBriefingPayload({ ...root, formatVersion: 3, addons });
}

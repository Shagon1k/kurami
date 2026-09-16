import type { BriefingAddonEnvelope, BriefingPayload } from "../model.ts";
import type { BuiltinAddonId } from "./live-contract.ts";

export const BUILTIN_ADDON_IDS = ["mail", "calendar", "weather", "news"] as const;
export type BuiltinAddonEnvelope<K extends BuiltinAddonId> = Omit<BriefingAddonEnvelope, "data"> & {
  version: 2;
  data: { section: NonNullable<BriefingPayload[K]>; sourceBatches?: BriefingPayload["sourceBatches"] };
};

/** Root fields remain the schema-v2 compatibility view for existing tools.
 * Writers update that view; the parser refreshes populated envelopes from it.
 * Add-on-only inputs can omit root fields and use data.section instead.
 */
export function captureBuiltinAddon<K extends BuiltinAddonId>(payload: BriefingPayload, id: K, capturedAt?: string): BuiltinAddonEnvelope<K> {
  const section = payload[id] ?? { state: "failed" };
  return {
    version: 2,
    state: section.state,
    capturedAt: capturedAt ?? (id === "news" ? payload.edition.generatedAt : payload.live?.refreshedAt ?? payload.edition.generatedAt),
    data: {
      section: structuredClone(section) as NonNullable<BriefingPayload[K]>,
      ...(id === "news" ? { sourceBatches: structuredClone(payload.sourceBatches ?? []) } : {}),
    },
  };
}

export function syncBuiltinEnvelopes(payload: BriefingPayload): void {
  if (!payload.addons) return;
  for (const id of BUILTIN_ADDON_IDS) {
    const envelope = payload.addons[id];
    // Legacy v1 manifests remain readable without rewriting frozen snapshots.
    if (envelope?.version === 2) payload.addons[id] = captureBuiltinAddon(payload, id, envelope.capturedAt);
  }
}

export function builtinSectionInput(root: Record<string, unknown>, id: BuiltinAddonId, addons: Record<string, BriefingAddonEnvelope> | undefined): unknown {
  const envelope = addons?.[id];
  if (envelope && envelope.version !== 1 && envelope.version !== 2) throw new Error(`Unsupported ${id} add-on version ${envelope.version}`);
  if (envelope?.version === 2 && (!envelope.data.section || typeof envelope.data.section !== "object" || Array.isArray(envelope.data.section))) {
    throw new Error(`Missing ${id} add-on section`);
  }
  if (root[id] !== undefined) return root[id];
  if (envelope?.version === 2) {
    return envelope.data.section;
  }
  if (addons && !envelope) return id === "weather" ? undefined : { state: "empty", items: [], events: [], allDayEvents: [] };
  return root[id];
}

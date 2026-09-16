import type { BriefingAddonEnvelope, BriefingPayload, BriefingSections, SourceBatch } from "../model.ts";
import type { BuiltinAddonId } from "./live-contract.ts";

export const BUILTIN_ADDON_IDS = ["mail", "calendar", "weather", "news"] as const;
export type BuiltinAddonEnvelope<K extends BuiltinAddonId> = Omit<BriefingAddonEnvelope, "data"> & {
  version: 2;
  data: { section: BriefingSections[K]; sourceBatches?: SourceBatch[] };
};

/** Absent modules have no stored data. Empty read values are never attached to the payload. */
export function section<K extends BuiltinAddonId>(payload: BriefingPayload | null | undefined, id: K): BriefingSections[K] {
  const envelope = payload?.addons[id];
  if (envelope) return envelope.data.section as BriefingSections[K];
  return (id === "weather" ? { state: "failed" } : id === "calendar"
    ? { state: "empty", events: [], allDayEvents: [] } : { state: "empty", items: [] }) as BriefingSections[K];
}

export function newsBatches(payload: BriefingPayload): SourceBatch[] {
  return (payload.addons.news?.data.sourceBatches ?? []) as SourceBatch[];
}

export function setSection<K extends BuiltinAddonId>(payload: BriefingPayload, id: K, value: BriefingSections[K], capturedAt?: string): void {
  const previous = payload.addons[id];
  payload.addons[id] = {
    version: 2, state: value.state,
    capturedAt: capturedAt ?? previous?.capturedAt ?? payload.edition.generatedAt,
    data: { ...previous?.data, section: value },
  };
}

export function captureBuiltinAddon<K extends BuiltinAddonId>(payload: BriefingPayload, id: K, capturedAt?: string): BuiltinAddonEnvelope<K> {
  const existing = payload.addons[id];
  if (!existing) throw new Error(`Cannot capture disabled add-on ${id}`);
  return { ...structuredClone(existing), version: 2, state: section(payload, id).state,
    capturedAt: capturedAt ?? existing.capturedAt } as BuiltinAddonEnvelope<K>;
}

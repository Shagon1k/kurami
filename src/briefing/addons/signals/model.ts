import type { BriefingAddonEnvelope } from "../../model.ts";
import type { SignalsConfig } from "./config.ts";

export type SignalItem = {
  id: string; group: "calendar-today" | "calendar-tomorrow" | "mail" | "weather";
  priority: number; severity: "attention" | "info"; title: string; detail: string;
  enTitle?: string; enDetail?: string;
  href?: "#calendar-heading" | "#mail-heading";
  expiresAt?: string;
};
export type SignalsData = {
  policy: SignalsConfig; localDate: string; timezone: string; evaluatedAt: string;
  validUntil: string; items: SignalItem[]; unavailable: string[];
};
export type SignalsEnvelope = Omit<BriefingAddonEnvelope,"data"> & { version: 1; data: SignalsData };

export function parseSignalsEnvelope(value: BriefingAddonEnvelope | undefined): SignalsEnvelope | null {
  if (!value || value.version !== 1 || value.state === "failed") return null;
  const data = value.data as unknown as SignalsData;
  if (!data || !Array.isArray(data.items) || data.items.length > 3
    || !/^\d{4}-\d{2}-\d{2}$/.test(data.localDate) || !Number.isFinite(Date.parse(data.validUntil))
    || !Number.isFinite(Date.parse(data.evaluatedAt)) || typeof data.timezone !== "string") return null;
  try { new Intl.DateTimeFormat("en",{timeZone:data.timezone}).format(new Date(data.evaluatedAt)); } catch { return null; }
  const ids = new Set<string>();
  for (const item of data.items) {
    if (!item || typeof item.id !== "string" || ids.has(item.id)
      || !/^[a-z][a-z0-9-]{0,63}$/u.test(item.id)
      || !["calendar-today","calendar-tomorrow","mail","weather"].includes(item.group) || !Number.isFinite(item.priority)
      || !["attention","info"].includes(item.severity) || typeof item.title !== "string"
      || typeof item.detail !== "string" || item.title.length > 100 || item.detail.length > 300
      || (item.enTitle!==undefined&&(typeof item.enTitle!=="string"||item.enTitle.length>100))
      || (item.enDetail!==undefined&&(typeof item.enDetail!=="string"||item.enDetail.length>300))
      || (item.expiresAt && !Number.isFinite(Date.parse(item.expiresAt)))
      || (item.href && !["#calendar-heading","#mail-heading"].includes(item.href))) return null;
    ids.add(item.id);
  }
  return value as unknown as SignalsEnvelope;
}

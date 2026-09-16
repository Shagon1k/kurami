import type { BriefingPayload } from "../model.ts";
import { collectAddonQuality } from "./registry.ts";

export function refreshDataQuality(payload: BriefingPayload, refreshedAt: string): void {
  const sections = collectAddonQuality(payload).map(({ label, state }) => [label, state] as const);
  const issues = sections
    .filter(([, state]) => state === "partial" || state === "stale" || state === "failed")
    .map(([label]) => label);
  const retainedMorningCaveat = payload.edition.status === "partial"
    && payload.dataQuality.state !== "ready"
    && issues.length === 0;
  const time = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: payload.edition.timezone,
  }).format(new Date(refreshedAt));
  payload.dataQuality = {
    ...payload.dataQuality,
    state: issues.length || retainedMorningCaveat ? "partial" : "ready",
    summary: issues.length
      ? `Требуют внимания: ${issues.join(", ")}. Live-данные обновлены в ${time}.`
      : retainedMorningCaveat
        ? `У утреннего среза есть оговорки; live-данные обновлены в ${time}.`
        : `Утренний срез зафиксирован; live-данные обновлены в ${time}.`,
  };
}

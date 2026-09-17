import type { BriefingPayload } from "../model.ts";
import { collectAddonMetrics, renderAddonSlot } from "../addons/registry.ts";
import { displayString, escapeHtml } from "./html.ts";
import { renderKuramiNote } from "./components/kurami-note.ts";
import {renderPageShell} from "./page-shell.ts";
import { renderMetricStrip, timeMetricCard } from "./components/metric-strip.ts";

function formatDate(payload: BriefingPayload): string {
  const value = new Date(`${payload.edition.localDate}T12:00:00`);
  if (!Number.isFinite(value.getTime())) return payload.edition.localDate;
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: payload.edition.timezone,
  }).format(value);
}

function renderQuality(payload: BriefingPayload): string {
  const summary = displayString(payload.dataQuality.summary);
  if (!summary) return "";
  const ready = payload.dataQuality.state === "ready";
  return `<aside class="quality-strip" data-state="${escapeHtml(payload.dataQuality.state)}" aria-label="Качество данных"><div class="quality-strip__heading"><span>${ready ? "READY" : "CHECK"}</span><strong>${ready ? "Источники обновлены" : "Есть оговорки по данным"}</strong></div><p>${escapeHtml(summary)}</p></aside>`;
}

export function renderBriefingPage(payload: BriefingPayload): string {
  const payloadTitle = displayString(payload.hero.title, "Утренний брифинг");
  const title = payload.edition.type === "daily" ? "Доброе утро, Alex." : payloadTitle;
  const subtitle = displayString(payload.hero.subtitle, formatDate(payload));
  const generated = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: payload.edition.timezone,
  }).format(new Date(payload.edition.generatedAt));
  const heroNote = payload.notes?.find((note) => note.target === "hero");
  const metricCards = [
    ...collectAddonMetrics(payload),
    { addonId: "core", order: 30, card: timeMetricCard(payload) },
  ].sort((left, right) => left.order - right.order || left.addonId.localeCompare(right.addonId))
    .map((value) => value.card);
  const overview = renderAddonSlot(payload, "overview");
  const afterMetrics = renderAddonSlot(payload, "after-metrics");
  const main = renderAddonSlot(payload, "main");
  const afterMain = renderAddonSlot(payload, "after-main");
  const utilityTitle = payload.edition.type === "cinema" ? "Kurami Cinema" : "Kurami Daily Briefing";
  return renderPageShell({title,brand:utilityTitle,date:payload.edition.localDate,dateLabel:formatDate(payload),generated,timezone:payload.edition.timezone,content:`\n    <section class="hero">
      <div><p class="hero__eyebrow">${escapeHtml(payloadTitle)} · ${escapeHtml(payload.edition.localDate)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="hero__subtitle">${escapeHtml(subtitle)}</p></div>
      ${renderKuramiNote(heroNote, "hero__note")}
    </section>
    ${payload.edition.type === "cinema" ? "" : renderMetricStrip(payload, metricCards)}
    ${afterMetrics}
    ${overview ? `<div class="briefing-overview">
      ${overview}
    </div>` : ""}
    ${main}
    ${afterMain ? `${afterMain}\n    ` : ""}${renderQuality(payload)}
  `});
}

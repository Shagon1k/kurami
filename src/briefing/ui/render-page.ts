import type { BriefingPayload } from "../model.ts";
import { collectAddonMetrics, collectAddonQuality, renderAddonSlot } from "../addons/registry.ts";
import {section} from "../addons/envelopes.ts";
import {parseCinemaEnvelope} from "../cinema/model.ts";
import { displayString, escapeHtml } from "./html.ts";
import { renderKuramiNote } from "./components/kurami-note.ts";
import {renderPageShell} from "./page-shell.ts";
import { renderMetricStrip, timeMetricCard } from "./components/metric-strip.ts";
import {digestLanguage,digestText} from "../i18n.ts";

function formatDate(payload: BriefingPayload): string {
  const value = new Date(`${payload.edition.localDate}T12:00:00`);
  if (!Number.isFinite(value.getTime())) return payload.edition.localDate;
  return new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
    timeZone: payload.edition.timezone,
  }).format(value);
}

function renderQuality(payload: BriefingPayload): string {
  let summary = displayString(payload.dataQuality.summary);
  if(digestLanguage()==="en"){
    if(payload.edition.type==="cinema")summary=payload.dataQuality.state==="ready"?"All Cinema sections collected and checked.":"This Cinema snapshot is partial; some sections are unavailable or incomplete.";
    else {
      const issues=collectAddonQuality(payload).filter(item=>["partial","stale","failed"].includes(item.state));
      const names:Record<string,string>={news:"news",mail:"mail",calendar:"calendar",weather:"weather",signals:"signals"};
      const refreshed=payload.live?.refreshedAt??payload.edition.generatedAt;
      const time=new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",timeZone:payload.edition.timezone}).format(new Date(refreshed));
      summary=issues.length?`Needs attention: ${issues.map(item=>names[item.id]??item.id).join(", ")}. Live data refreshed at ${time}.`:payload.dataQuality.state==="ready"?`Morning snapshot frozen; live data refreshed at ${time}.`:`Morning snapshot has caveats; live data refreshed at ${time}.`;
    }
  }
  if (!summary) return "";
  const ready = payload.dataQuality.state === "ready";
  return `<aside class="quality-strip" data-state="${escapeHtml(payload.dataQuality.state)}" aria-label="${digestText("Качество данных","Data quality")}"><div class="quality-strip__heading"><span>${ready ? "READY" : "CHECK"}</span><strong>${ready ? digestText("Источники обновлены","Sources refreshed") : digestText("Есть оговорки по данным","Data caveats")}</strong></div><p>${escapeHtml(summary)}</p></aside>`;
}

export function renderBriefingPage(payload: BriefingPayload): string {
  const cinema=payload.edition.type==="cinema"&&payload.addons.cinema?parseCinemaEnvelope(payload.addons.cinema):null;
  const originalEditorial=digestLanguage()==="en"&&(
    section(payload,"news").items.some(story=>!story.en)
    || Boolean(payload.notes?.some(note=>!note.enText))
    || Boolean(cinema?.data.news.items.some(story=>!story.en))
    || Boolean(cinema?.data.notes.some(note=>!note.enText))
  );
  const enHero=payload.hero.en&&typeof payload.hero.en==="object"?payload.hero.en as Record<string,unknown>:null;
  const defaultTitle=payload.edition.type==="cinema"?digestText("Кинообзор","Cinema briefing"):digestText("Утренний брифинг","Morning briefing");
  const payloadTitle = digestLanguage()==="en"?displayString(enHero?.title,defaultTitle):displayString(payload.hero.title,defaultTitle);
  const title = payload.edition.type === "daily" ? digestText("Доброе утро, Alex.","Good morning, Alex.") : payloadTitle;
  const subtitle = digestLanguage()==="en"?displayString(enHero?.subtitle,formatDate(payload)):displayString(payload.hero.subtitle, formatDate(payload));
  const generated = new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU", {
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
  return renderPageShell({title,brand:utilityTitle,section:payload.edition.type,date:payload.edition.localDate,dateLabel:formatDate(payload),generated,updatedAt:payload.edition.generatedAt,timezone:payload.edition.timezone,content:`\n    <section class="hero">
      <div><p class="hero__eyebrow">${escapeHtml(payloadTitle)} · ${escapeHtml(payload.edition.localDate)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="hero__subtitle">${escapeHtml(subtitle)}</p></div>
      ${renderKuramiNote(heroNote, "hero__note")}
    </section>
    ${originalEditorial?`<aside class="quality-strip" aria-label="Original-language editorial content"><p>Archived editorial text is available only in its original Russian. New editions include English copy.</p></aside>`:""}
    ${payload.edition.type === "cinema" ? "" : renderMetricStrip(payload, metricCards)}
    ${afterMetrics}
    ${overview ? `<div class="briefing-overview">
      ${overview}
    </div>` : ""}
    ${main}
    ${afterMain ? `${afterMain}\n    ` : ""}${renderQuality(payload)}
  `});
}

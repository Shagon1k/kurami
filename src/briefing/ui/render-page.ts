import type { BriefingPayload } from "../model.ts";
import { displayString, escapeHtml } from "./html.ts";
import { renderKuramiNote } from "./components/kurami-note.ts";
import { renderCalendarSection } from "./components/calendar-section.ts";
import { renderMailSection } from "./components/mail-section.ts";
import { renderPaginatedFeed } from "./components/paginated-feed.ts";
import { renderThemeToggle } from "./components/theme-toggle.ts";
import { renderMetricStrip } from "./components/metric-strip.ts";
import { BRIEFING_STYLES } from "./styles.ts";

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
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · Kurami</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=Fragment+Mono&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${BRIEFING_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#main">К содержанию</a>
  <header class="utility-header" data-utility-header>
    <div class="utility-header__inner page-shell">
      <div class="utility-brand"><span class="utility-brand__mark" aria-hidden="true">K</span><span>Kurami Daily Briefing</span></div>
      <time class="utility-meta" datetime="${escapeHtml(payload.edition.localDate)}">${escapeHtml(formatDate(payload))}</time>
      <div class="utility-actions">${renderThemeToggle()}</div>
    </div>
  </header>
  <main id="main" class="page-shell">
    <section class="hero">
      <div><p class="hero__eyebrow">${escapeHtml(payloadTitle)} · ${escapeHtml(payload.edition.localDate)}</p>
        <h1>${escapeHtml(title)}</h1>
        <p class="hero__subtitle">${escapeHtml(subtitle)}</p></div>
      ${renderKuramiNote(heroNote, "hero__note")}
    </section>
    ${renderMetricStrip(payload)}
    <div class="briefing-overview">
      ${renderCalendarSection(payload)}
      ${renderMailSection(payload)}
    </div>
    ${renderPaginatedFeed(payload)}
    ${renderQuality(payload)}
  </main>
  <footer class="page-footer page-shell"><span>Kurami · ${escapeHtml(payload.edition.localDate)}</span><span>Собрано в ${escapeHtml(generated)} · ${escapeHtml(payload.edition.timezone)}</span></footer>
  <dialog class="media-lightbox" data-media-dialog aria-label="Просмотр изображения"><button class="media-lightbox__close" type="button" data-media-close aria-label="Закрыть">×</button><img data-media-dialog-image alt=""></dialog>
</body>
</html>`;
}

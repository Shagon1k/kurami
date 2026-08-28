import type { BriefingPayload } from "../model.ts";
import { displayString, escapeHtml } from "./html.ts";
import { renderPaginatedFeed } from "./components/paginated-feed.ts";
import { renderThemeToggle } from "./components/theme-toggle.ts";
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
  return `<aside class="quality-strip" data-state="${escapeHtml(payload.dataQuality.state)}" aria-label="Качество данных"><span class="quality-strip__mark" aria-hidden="true">${payload.dataQuality.state === "ready" ? "✓" : "!"}</span><p>${escapeHtml(summary)}</p></aside>`;
}

export function renderBriefingPage(payload: BriefingPayload): string {
  const title = displayString(payload.hero.title, "Утренний брифинг");
  const subtitle = displayString(payload.hero.subtitle, formatDate(payload));
  const generated = new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: payload.edition.timezone,
  }).format(new Date(payload.edition.generatedAt));
  return `<!doctype html>
<html lang="ru" data-theme="light">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>${escapeHtml(title)} · Kurami</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fragment+Mono&family=Onest:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>${BRIEFING_STYLES}</style>
</head>
<body>
  <a class="skip-link" href="#main">К содержанию</a>
  <header class="utility-header page-shell">
    <div><div class="utility-brand">Kurami Daily Briefing</div><div class="utility-meta">${escapeHtml(formatDate(payload))}</div></div>
    <div class="utility-actions">${renderThemeToggle()}</div>
  </header>
  <main id="main" class="page-shell">
    <section class="hero">
      <p class="hero__eyebrow">${escapeHtml(payload.edition.type)} · ${escapeHtml(payload.edition.localDate)}</p>
      <h1>${escapeHtml(title)}</h1>
      <p class="hero__subtitle">${escapeHtml(subtitle)}</p>
    </section>
    ${renderQuality(payload)}
    ${renderPaginatedFeed(payload)}
  </main>
  <footer class="page-footer page-shell"><span>Kurami · ${escapeHtml(payload.edition.localDate)}</span><span>Собрано в ${escapeHtml(generated)} · ${escapeHtml(payload.edition.timezone)}</span></footer>
</body>
</html>`;
}

import type { DigestPreparation } from "../../preparation.ts";
import { RUN_STEPS } from "../../run-progress.ts";
import { digestLanguage, digestPath, digestText as t } from "../../i18n.ts";
import { escapeHtml } from "../../../ui-library/foundations/html.ts";
import { renderCallout, CALLOUT_CSS } from "../../../ui-library/components/callout.ts";
import { renderMeter, STAT_CARD_CSS } from "../../../ui-library/components/stat-card.ts";
import { renderLinkButton } from "../../../ui-library/components/button.ts";
import { LIVE_ATTRIBUTE, PROCESSING_ATTRIBUTE, surfaceAttributes } from "../../../ui-library/components/surface.ts";

export const PREPARATION_STYLES = `${CALLOUT_CSS}${STAT_CARD_CSS}
.digest-preparation { margin-block: var(--space-4) var(--space-5); }
.digest-preparation__layout { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: var(--space-3) var(--space-5); }
.digest-preparation__copy { min-width: 0; }
.digest-preparation__title { display: block; font-size: .85rem; color: var(--text-muted); }
.digest-preparation__activity { display: block; font-weight: 600; }
.digest-preparation__progress { display: grid; grid-template-columns: minmax(0,1fr) auto; align-items: center; gap: var(--space-3); width: min(100%,20rem); margin-top: var(--space-2); }
.digest-preparation__count { color: var(--text-muted); font-size: .85rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
.digest-preparation__updated { color: var(--text-muted); font-size: .75rem; overflow-wrap: anywhere; }
@media (max-width: 600px) {
  .digest-preparation__layout { grid-template-columns: minmax(0,1fr); gap: var(--space-2); }
}
`;

export function renderDigestPreparation(progress: DigestPreparation): string {
  const language = digestLanguage();
  const date = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    timeZone: "UTC", day: "numeric", month: "long",
  }).format(new Date(progress.date + "T12:00:00Z"));
  const updated = new Intl.DateTimeFormat(language === "ru" ? "ru-RU" : "en-GB", {
    timeZone: progress.timeZone, hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(progress.updatedAt));
  const preparing = progress.status === "preparing";
  return renderCallout({ tone: preparing ? "warning" : "note", className: "digest-preparation", body: { html:
    `<div class="digest-preparation__layout">
      <div class="digest-preparation__copy">
        <span class="digest-preparation__title">${escapeHtml(t("Новый дневной выпуск", "New Daily edition"))} · ${escapeHtml(date)}</span>
        <span class="digest-preparation__activity">${escapeHtml(preparing ? progress.activity : t("Выпуск готов. Кофе — и вперёд.", "Edition ready. Coffee, then off you go."))}</span>
        ${preparing ? `<div class="digest-preparation__progress">${renderMeter({ value: progress.step / RUN_STEPS * 100, tone: "warning", label: t("Завершено этапов", "Stages completed") + `: ${progress.step}/${RUN_STEPS}` })}<span class="digest-preparation__count">${progress.step}/${RUN_STEPS}</span></div>` : ""}
      </div>
      ${preparing ? `<span class="digest-preparation__updated">${t("Обновлено", "Updated")} <time datetime="${escapeHtml(progress.updatedAt)}">${updated}</time> · ${escapeHtml(progress.timeZone)}</span>` : renderLinkButton({ label: t("Открыть новый выпуск", "Open new edition"), href: digestPath(`/daily/${progress.date}`), variant: "primary", size: "compact" })}
    </div>` }}).replace("<aside", `<aside${surfaceAttributes("panel")}${LIVE_ATTRIBUTE}${preparing ? PROCESSING_ATTRIBUTE : ""}`);
}

/** Request-time status never becomes part of the frozen edition. */
export function injectDigestPreparation(html: string, progress: DigestPreparation | null): string {
  const active = progress?.status === "preparing" ? progress : null;
  const slot = `<div data-digest-preparation data-edition-id="${escapeHtml(active?.editionId ?? "")}" role="status" aria-live="polite" aria-atomic="true"${active ? "" : " hidden"}>${active ? renderDigestPreparation(active) : ""}</div>`;
  return html.replace(/<main\b[^>]*>/i, match => match + slot)
    .replace(/<\/head>/i, `<style data-digest-preparation-styles>${PREPARATION_STYLES}</style></head>`);
}

export const PREPARATION_SCRIPT = `(() => {
  const slot = document.querySelector('[data-digest-preparation]');
  if (!slot) return;
  let activeEdition = slot.dataset.editionId;
  let lastMarkup = slot.innerHTML;
  let fetching = false;
  async function refresh() {
    if (document.hidden || fetching) return;
    fetching = true;
    try {
      const language = document.documentElement.lang === 'en' ? 'en' : 'ru';
      const response = await fetch(kuramiAppUrl('/api/preparation?lang=' + language), { cache: 'no-store' });
      if (!response.ok) return;
      const result = await response.json();
      if (result.status === 'preparing') activeEdition = result.editionId;
      const markup = result.status === 'preparing' || (result.status === 'ready' && result.editionId === activeEdition) ? result.html : '';
      if (markup !== lastMarkup) {
        slot.innerHTML = markup;
        slot.hidden = !markup;
        lastMarkup = markup;
      }
    } catch { /* Keep the last observed stage when the connection is unavailable. */ }
    finally { fetching = false; }
  }
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', refresh);
  refresh();
})();`;

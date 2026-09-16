import { section } from "../../addons/envelopes.ts";
import type { BriefingPayload } from "../../model.ts";
import { escapeHtml } from "../html.ts";
import { renderKuramiNote } from "./kurami-note.ts";
import { renderNewsStory } from "./news-story.ts";
import { renderButton } from "./button.ts";
import { renderFeedOrderControl } from "./feed-order-control.ts";

export function renderPaginatedFeed(payload: BriefingPayload): string {
  const pageSize = section(payload, "news").pageSize ?? 10;
  const total = section(payload, "news").items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const newsNote = payload.notes?.find((note) => note.target === "news");
  return `<section class="digest-feed" aria-labelledby="news-heading" data-paginated-feed data-edition-id="${escapeHtml(payload.edition.id)}" data-page-size="${pageSize}" data-page-param="newsPage">
    ${renderKuramiNote(newsNote, "digest-feed__note")}
    <header class="digest-feed__header">
      <div><p class="section-kicker">Утренняя пачка</p><h2 id="news-heading" data-feed-heading>Новости</h2><p>${total} ${storyWord(total)} · ${pageSize} на странице</p></div>
      <span class="digest-feed__count">Telegram · ${total}</span>
    </header>
    ${total ? renderFeedOrderControl() : ""}
    <div class="digest-feed__items">${section(payload, "news").items.map((story, index) => renderNewsStory({ edition: payload.edition, story, index, notes: payload.notes })).join("")}</div>
    ${pages > 1 ? `<nav class="pagination" aria-label="Страницы новостей" data-feed-pagination>
      <span class="pagination__range" data-page-range>1–${Math.min(pageSize, total)} из ${total}</span>
      <div class="pagination__controls">${renderButton({ label: "Предыдущая страница", variant: "quiet", className: "pagination__button", icon: "←", ariaLabel: "Предыдущая страница", disabled: true, attributes: { "data-page-prev": true } })}${Array.from({ length: pages }, (_, index) => renderButton({ label: String(index + 1), variant: "quiet", className: "pagination__button", ariaLabel: `Страница ${index + 1}`, attributes: { "data-page": index + 1, ...(index === 0 ? { "aria-current": "page" } : {}) } })).join("")}<label class="pagination__mobile-jump"><span class="sr-only">Перейти к странице</span><input class="pagination__input" type="number" inputmode="numeric" min="1" max="${pages}" value="1" aria-label="Номер страницы из ${pages}" data-page-input><span aria-hidden="true">/ ${pages}</span></label>${renderButton({ label: "Следующая страница", variant: "quiet", className: "pagination__button", icon: "→", ariaLabel: "Следующая страница", attributes: { "data-page-next": true } })}</div>
      <span class="sr-only" aria-live="polite" data-page-status>Страница 1 из ${pages}</span>
    </nav>` : ""}
  </section>`;
}

function storyWord(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return "сюжет";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "сюжета";
  return "сюжетов";
}

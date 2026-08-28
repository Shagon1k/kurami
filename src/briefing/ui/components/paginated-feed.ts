import type { BriefingPayload } from "../../model.ts";
import { escapeHtml } from "../html.ts";
import { renderNewsStory } from "./news-story.ts";

export function renderPaginatedFeed(payload: BriefingPayload): string {
  const pageSize = payload.news.pageSize ?? 10;
  const total = payload.news.items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<section class="digest-feed" aria-labelledby="news-heading" data-paginated-feed data-page-size="${pageSize}" data-page-param="newsPage">
    <span class="kurami-note digest-feed__note">главное — рядом ↓</span>
    <header class="digest-feed__header">
      <div><p class="section-kicker">Утренняя пачка</p><h2 id="news-heading" data-feed-heading>Новости</h2><p>${total} ${storyWord(total)} · ${pageSize} на странице</p></div>
      <span class="digest-feed__count">Telegram · ${total}</span>
    </header>
    <div class="digest-feed__items">${payload.news.items.map((story, index) => renderNewsStory({ edition: payload.edition, story, index })).join("")}</div>
    ${pages > 1 ? `<nav class="pagination" aria-label="Страницы новостей" data-feed-pagination>
      <span class="pagination__range" data-page-range>1–${Math.min(pageSize, total)} из ${total}</span>
      <div class="pagination__controls"><button class="pagination__button" type="button" data-page-prev>← Новее</button>${Array.from({ length: pages }, (_, index) => `<button class="pagination__button" type="button" data-page="${index + 1}" aria-label="Страница ${index + 1}"${index === 0 ? ' aria-current="page"' : ""}>${index + 1}</button>`).join("")}<button class="pagination__button" type="button" data-page-next>Старее →</button></div>
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

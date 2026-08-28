import type { BriefingPayload } from "../../model.ts";
import { escapeHtml } from "../html.ts";
import { renderNewsStory } from "./news-story.ts";

export function renderPaginatedFeed(payload: BriefingPayload): string {
  const pageSize = payload.news.pageSize ?? 10;
  const total = payload.news.items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<section class="digest-feed" aria-labelledby="news-heading" data-paginated-feed data-page-size="${pageSize}" data-page-param="newsPage">
    <header class="digest-feed__header">
      <div><p class="section-kicker">Сводка непрочитанного</p><h2 id="news-heading" data-feed-heading>Новости</h2><p>${total} ${storyWord(total)} · ${pageSize} на странице</p></div>
      <span class="digest-feed__count">${pages} ${pageWord(pages)}</span>
    </header>
    <div class="digest-feed__items">${payload.news.items.map((story, index) => renderNewsStory({ edition: payload.edition, story, index })).join("")}</div>
    ${pages > 1 ? `<nav class="pagination" aria-label="Страницы новостей" data-feed-pagination>
      <button class="pagination__button" type="button" data-page-prev>← Новее</button>
      <span class="pagination__status" aria-live="polite" data-page-status>1 / ${pages}</span>
      <button class="pagination__button" type="button" data-page-next>Старее →</button>
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

function pageWord(count: number): string {
  return count === 1 ? "страница" : count < 5 ? "страницы" : "страниц";
}

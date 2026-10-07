// Offline reading, news only. The owner turns it on per device in Daily; the gateway's service worker then
// keeps one copy of this page (and refreshes it on visits), and shows it when Digest is opened without a
// network. Only the stories go in: no mail, calendar, stocks, signals or notes, and no images, so nothing
// personal is stored on the phone and the copy stays small.
import type { BriefingPayload } from "../model.ts";
import { section } from "../addons/envelopes.ts";
import { renderBriefingPage } from "./render-page.ts";
import { digestText } from "../i18n.ts";

export function newsOnlyPayload(payload: BriefingPayload): BriefingPayload {
  const news = structuredClone(payload.addons.news);
  const stories = section(payload, "news");
  if (news?.data && typeof news.data === "object") {
    const data = news.data as { section?: { items?: unknown[] } };
    if (data.section?.items) data.section.items = stories.items.map(story => ({ ...story, media: [] }));
  }
  return { ...structuredClone(payload), addons: news ? { news } : {}, notes: [] } as BriefingPayload;
}

export function renderOfflineNews(payload: BriefingPayload, savedAt: Date): string {
  const saved = new Intl.DateTimeFormat(digestText("ru-RU", "en-GB"), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: payload.edition.timezone }).format(savedAt);
  const banner = `<p class="offline-news-banner" role="status">${digestText(`Без сети: сохранённые новости от ${saved}. Почта, расписание и картинки — только онлайн.`, `Offline: news saved ${saved}. Mail, schedule and images need a connection.`)}</p>`;
  return renderBriefingPage(newsOnlyPayload(payload)).replace(/<main([^>]*)>/, `<main$1>${banner}`);
}

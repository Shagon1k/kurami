import type { StoryMedia } from "../../model.ts";
import { escapeHtml } from "../html.ts";
import {digestText as t} from "../../i18n.ts";

function firstImage(media: StoryMedia[]): StoryMedia | null {
  return media.find((asset) => asset.kind === "image") ?? null;
}

function storyAlt(headline: string | undefined, fallback: string): string {
  return headline ? `${t("Изображение к сюжету","Image for story")} «${headline}»` : fallback;
}

export function renderStoryCover(media: StoryMedia[] | undefined, headline?: string): string {
  if (!media?.length) return "";
  const image = firstImage(media);
  if (!image) return "";
  const alt = storyAlt(headline, image.alt);
  const count = media.length > 1
    ? `<span class="story-cover__count" aria-label="${media.length} ${t("медиафайлов","media files")}">+${media.length - 1}</span>`
    : "";
  return `<a class="story-cover" href="${escapeHtml(image.src)}" target="_blank" rel="noopener noreferrer" data-media-lightbox data-media-src="${escapeHtml(image.src)}" data-media-alt="${escapeHtml(alt)}" aria-label="${t("Открыть изображение","Open image")}: ${escapeHtml(alt)}"><img src="${escapeHtml(image.src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async">${count}</a>`;
}

export function renderStoryMediaGallery(media: StoryMedia[] | undefined, headline?: string): string {
  if (!media?.length) return "";
  const assets = media.map((asset) => {
    if (asset.kind === "image") {
      const alt = storyAlt(headline, asset.alt);
      return `<a class="story-media__item story-media__item--image" href="${escapeHtml(asset.src)}" target="_blank" rel="noopener noreferrer" data-media-lightbox data-media-src="${escapeHtml(asset.src)}" data-media-alt="${escapeHtml(alt)}"><img src="${escapeHtml(asset.src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"></a>`;
    }
    // Legacy read path only; newly generated editions never import videos.
    return `<figure class="story-media__item story-media__item--video"><video controls preload="metadata" playsinline${asset.posterSrc ? ` poster="${escapeHtml(asset.posterSrc)}"` : ""}><source src="${escapeHtml(asset.src)}" type="${escapeHtml(asset.mimeType)}">${t("Ваш браузер не поддерживает встроенное видео.","Your browser does not support embedded video.")}</video><figcaption>${escapeHtml(asset.alt)}</figcaption></figure>`;
  }).join("");
  return `<section class="story-media" aria-label="${t("Медиа к новости","Story media")}"><div class="story-media__heading"><strong>${t("Медиа","Media")}</strong><span>${media.length}</span></div><div class="story-media__grid">${assets}</div></section>`;
}

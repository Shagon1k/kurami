import type { BriefingPayload, NewsItem, Reaction } from "../../model.ts";
import { displayString, escapeHtml, externalUrl, records } from "../html.ts";
import { renderReactionGroup } from "./reaction-group.ts";
import { renderStoryPanel, renderStoryToggle } from "./story-disclosure.ts";
import { renderStoryCover } from "./story-media.ts";
import { renderTopicSet } from "./topic-set.ts";
import { renderKuramiNote } from "./kurami-note.ts";

function sourceMetadata(story: NewsItem): {
  provider: string;
  label: string;
  time: string;
  url: string | null;
} {
  const source = records(story.sources)[0];
  if (!source) return { provider: "Источник", label: "Не указан", time: "", url: null };
  const provider = displayString(source.provider);
  const label = displayString(source.sourceLabel);
  const publishedAt = displayString(source.publishedAt);
  const time = Number.isFinite(Date.parse(publishedAt))
    ? new Intl.DateTimeFormat("ru-RU", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Vilnius",
    }).format(new Date(publishedAt))
    : "";
  return {
    provider: provider || "Источник",
    label: label || "Не указан",
    time,
    url: externalUrl(source.url),
  };
}

export function renderNewsStory(input: {
  edition: BriefingPayload["edition"];
  story: NewsItem;
  index: number;
  notes?: BriefingPayload["notes"];
}): string {
  const { story, edition } = input;
  const source = sourceMetadata(story);
  const reactionValue = story.reaction;
  const reaction: Reaction | null = reactionValue === "like" || reactionValue === "dislike"
    ? reactionValue
    : null;
  const read = displayString(story.readState) === "read";
  const sourceLink = source.url
    ? `<a class="news-story__source" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" aria-label="Перейти к источнику">↗</a>`
    : "";
  const depth = displayString(story.depth, "standard");
  const safeDepth = ["featured", "standard", "compact"].includes(depth) ? depth : "standard";
  const cover = renderStoryCover(story.media);
  const storyNote = input.notes?.find((note) => note.target === `story:${story.id}`);
  return `<article class="news-story news-story--${safeDepth}${read ? " is-read" : ""}${cover ? " has-media" : ""}" data-feed-item data-item-id="${escapeHtml(story.id)}">
    <span class="news-story__index" aria-hidden="true">${String(input.index + 1).padStart(2, "0")}</span>
    ${cover}
    <div class="news-story__copy">
      <div class="news-story__meta"><span class="news-story__provider">${escapeHtml(source.provider)}</span><span class="news-story__channel">${escapeHtml(source.label)}</span>${source.time ? `<time class="news-story__time">${escapeHtml(source.time)}</time>` : ""}${read ? '<span class="sr-only" data-read-state>Прочитано</span>' : ""}</div>
      ${renderKuramiNote(storyNote, "news-story__note")}
      <h3>${escapeHtml(story.headline)}</h3>
      <p class="news-story__summary">${escapeHtml(story.summary)}</p>
      ${renderTopicSet(story.topics)}
      <p class="news-story__interest" data-interest-reason hidden></p>
    </div>
    <div class="news-story__actions">${renderStoryToggle(story.id)}${sourceLink}${renderReactionGroup({ editionId: edition.id, itemId: story.id, reaction })}</div>
    ${renderStoryPanel({ editionId: edition.id, itemId: story.id, details: story.details, sourceUrl: source.url, read, media: story.media })}
  </article>`;
}

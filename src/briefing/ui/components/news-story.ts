import type { BriefingPayload, NewsItem, Reaction } from "../../model.ts";
import { displayString, escapeHtml, externalUrl, records } from "../html.ts";
import { renderReactionGroup } from "./reaction-group.ts";
import { renderStoryPanel, renderStoryToggle } from "./story-disclosure.ts";
import { renderTopicSet } from "./topic-set.ts";

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
  return `<article class="news-story news-story--${safeDepth}${read ? " is-read" : ""}" data-feed-item data-item-id="${escapeHtml(story.id)}">
    <span class="news-story__index" aria-hidden="true">${String(input.index + 1).padStart(2, "0")}</span>
    <div class="news-story__copy">
      <div class="news-story__meta"><span class="news-story__provider">${escapeHtml(source.provider)}</span><span class="news-story__channel">${escapeHtml(source.label)}</span>${source.time ? `<time class="news-story__time">${escapeHtml(source.time)}</time>` : ""}<span class="news-story__read-state" data-read-state>✓ прочитано</span></div>
      <h3>${escapeHtml(story.headline)}</h3>
      <p class="news-story__summary">${escapeHtml(story.summary)}</p>
      ${renderTopicSet(story.topics)}
    </div>
    <div class="news-story__actions">${renderStoryToggle(story.id)}${sourceLink}${renderReactionGroup({ editionId: edition.id, itemId: story.id, reaction })}</div>
    ${renderStoryPanel({ editionId: edition.id, itemId: story.id, details: story.details, sourceUrl: source.url, read })}
  </article>`;
}

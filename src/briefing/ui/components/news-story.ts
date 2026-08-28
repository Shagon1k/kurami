import type { BriefingPayload, NewsItem, Reaction } from "../../model.ts";
import { displayString, escapeHtml, externalUrl, records } from "../html.ts";
import { renderReactionGroup } from "./reaction-group.ts";
import { renderStoryDisclosure } from "./story-disclosure.ts";
import { renderTopicSet } from "./topic-set.ts";

function sourceMetadata(story: NewsItem): { line: string; url: string | null } {
  const source = records(story.sources)[0];
  if (!source) return { line: "Источник не указан", url: null };
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
    line: [provider, label, time].filter(Boolean).join(" · ") || "Источник не указан",
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
    ? `<a class="source-link" href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">Источник ↗</a>`
    : "";
  const depth = displayString(story.depth, "standard");
  const safeDepth = ["featured", "standard", "compact"].includes(depth) ? depth : "standard";
  return `<article class="news-story news-story--${safeDepth}" data-feed-item data-item-id="${escapeHtml(story.id)}">
    <span class="news-story__index" aria-hidden="true">${String(input.index + 1).padStart(2, "0")}</span>
    <div class="news-story__copy">
      <p class="news-story__meta">${escapeHtml(source.line)}</p>
      <h3>${escapeHtml(story.headline)}</h3>
      <p class="news-story__summary">${escapeHtml(story.summary)}</p>
      <div class="news-story__footer">${renderTopicSet(story.topics)}${sourceLink}</div>
      ${renderStoryDisclosure({ editionId: edition.id, itemId: story.id, details: story.details, read })}
    </div>
    <div class="news-story__reactions">${renderReactionGroup({ editionId: edition.id, itemId: story.id, reaction })}</div>
  </article>`;
}

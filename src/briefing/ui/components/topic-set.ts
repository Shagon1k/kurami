import type { Topic } from "../../model.ts";
import { escapeHtml } from "../html.ts";

export function renderTopicSet(topics: Topic[]): string {
  return `<div class="topic-set" aria-label="Темы">${topics
    .map((topic) => `<span class="topic-chip" data-topic-id="${escapeHtml(topic.id)}">${escapeHtml(topic.label)}</span>`)
    .join("")}</div>`;
}

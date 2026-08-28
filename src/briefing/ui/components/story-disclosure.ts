import { escapeHtml } from "../html.ts";

export function renderStoryDisclosure(input: {
  editionId: string;
  itemId: string;
  details: string[];
  read?: boolean;
}): string {
  return `<details class="story-disclosure${input.read ? " is-read" : ""}" data-story-details data-edition-id="${escapeHtml(input.editionId)}" data-item-id="${escapeHtml(input.itemId)}" data-read="${input.read === true}">
    <summary><span class="when-closed">Подробнее</span><span class="when-open">Свернуть</span></summary>
    <div class="story-disclosure__body">${input.details.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}</div>
  </details>`;
}

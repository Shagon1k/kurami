import { escapeHtml } from "../html.ts";

function panelId(itemId: string): string {
  return `story-details-${itemId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function renderStoryToggle(itemId: string): string {
  return `<button class="story-toggle" type="button" aria-expanded="false" aria-controls="${escapeHtml(panelId(itemId))}" data-story-toggle><span data-disclosure-label>Читать</span></button>`;
}

export function renderStoryPanel(input: {
  editionId: string;
  itemId: string;
  details: string[];
  sourceUrl?: string | null;
  read?: boolean;
}): string {
  const source = input.sourceUrl
    ? `<a class="source-link" href="${escapeHtml(input.sourceUrl)}" target="_blank" rel="noopener noreferrer">Перейти к источнику ↗</a>`
    : "";
  return `<section id="${escapeHtml(panelId(input.itemId))}" class="story-disclosure__body${input.read ? " is-read" : ""}" data-story-details data-edition-id="${escapeHtml(input.editionId)}" data-item-id="${escapeHtml(input.itemId)}" data-read="${input.read === true}" aria-label="Подробности новости" hidden>${input.details.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${source}</section>`;
}

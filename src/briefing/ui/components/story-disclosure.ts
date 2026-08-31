import { escapeHtml } from "../html.ts";
import type { StoryMedia } from "../../model.ts";
import { renderStoryMediaGallery } from "./story-media.ts";
import { renderButton } from "./button.ts";

function panelId(itemId: string): string {
  return `story-details-${itemId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function renderStoryToggle(itemId: string): string {
  return renderButton({
    label: "Читать",
    variant: "secondary",
    className: "story-toggle",
    attributes: {
      "aria-expanded": "false",
      "aria-controls": panelId(itemId),
      "data-story-toggle": true,
    },
    labelAttributes: { "data-disclosure-label": true },
  });
}

export function renderStoryPanel(input: {
  editionId: string;
  itemId: string;
  details: string[];
  sourceUrl?: string | null;
  read?: boolean;
  media?: StoryMedia[];
}): string {
  const source = input.sourceUrl
    ? `<a class="source-link" href="${escapeHtml(input.sourceUrl)}" target="_blank" rel="noopener noreferrer">Перейти к источнику ↗</a>`
    : "";
  return `<section id="${escapeHtml(panelId(input.itemId))}" class="story-disclosure__body${input.read ? " is-read" : ""}" data-story-details data-edition-id="${escapeHtml(input.editionId)}" data-item-id="${escapeHtml(input.itemId)}" data-read="${input.read === true}" aria-label="Подробности новости" hidden><div class="story-disclosure__copy">${input.details.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}${source}</div>${renderStoryMediaGallery(input.media)}</section>`;
}

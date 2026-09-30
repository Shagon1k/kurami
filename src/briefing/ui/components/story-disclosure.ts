import { escapeHtml } from "../html.ts";
import type { StoryMedia } from "../../model.ts";
import { renderStoryMediaGallery } from "./story-media.ts";
import { renderButton } from "../../../ui-library/components/button.ts";
import {digestText} from "../../i18n.ts";

function panelId(itemId: string): string {
  return `story-details-${itemId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function renderStoryToggle(itemId: string): string {
  return renderButton({
    label: digestText("Читать","Read"),
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
  detailsLanguage?: "ru";
  sourceUrl?: string | null;
  read?: boolean;
  media?: StoryMedia[];
  headline?: string;
}): string {
  const source = input.sourceUrl
    ? `<a class="source-link" href="${escapeHtml(input.sourceUrl)}" target="_blank" rel="noopener noreferrer">${digestText("Перейти к источнику","Open source")} ↗</a>`
    : "";
  return `<section id="${escapeHtml(panelId(input.itemId))}" class="story-disclosure__body${input.read ? " is-read" : ""}" data-story-details data-edition-id="${escapeHtml(input.editionId)}" data-item-id="${escapeHtml(input.itemId)}" data-read="${input.read === true}" aria-label="${digestText("Подробности новости","Story details")}" hidden><div class="story-disclosure__copy">${input.details.map((paragraph) => `<p${input.detailsLanguage?' lang="ru"':''}>${escapeHtml(paragraph)}</p>`).join("")}${source}</div>${renderStoryMediaGallery(input.media, input.headline)}</section>`;
}

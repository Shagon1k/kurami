import type { Reaction } from "../../model.ts";
import { escapeHtml } from "../html.ts";

export function renderReactionGroup(input: {
  editionId: string;
  itemId: string;
  reaction?: Reaction | null;
}): string {
  const editionId = escapeHtml(input.editionId);
  const itemId = escapeHtml(input.itemId);
  return `<div class="reaction-group" role="group" aria-label="Оценить новость">
    <button class="icon-button" type="button" aria-label="Нравится" aria-pressed="${input.reaction === "like"}" data-reaction="like" data-edition-id="${editionId}" data-item-id="${itemId}">👍</button>
    <button class="icon-button" type="button" aria-label="Не нравится" aria-pressed="${input.reaction === "dislike"}" data-reaction="dislike" data-edition-id="${editionId}" data-item-id="${itemId}">👎</button>
  </div>`;
}

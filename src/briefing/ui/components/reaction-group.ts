import type { Reaction } from "../../model.ts";
import { renderButton } from "./button.ts";

export function renderReactionGroup(input: {
  editionId: string;
  itemId: string;
  reaction?: Reaction | null;
}): string {
  return `<div class="reaction-group" role="group" aria-label="Оценить новость">
    ${renderButton({ label: "Нравится", variant: "icon", className: "icon-button", icon: "👍", ariaLabel: "Нравится", attributes: { "aria-pressed": String(input.reaction === "like"), "data-reaction": "like", "data-edition-id": input.editionId, "data-item-id": input.itemId } })}
    ${renderButton({ label: "Не нравится", variant: "icon", className: "icon-button", icon: "👎", ariaLabel: "Не нравится", attributes: { "aria-pressed": String(input.reaction === "dislike"), "data-reaction": "dislike", "data-edition-id": input.editionId, "data-item-id": input.itemId } })}
  </div>`;
}

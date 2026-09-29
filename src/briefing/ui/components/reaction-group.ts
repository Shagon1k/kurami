import type { Reaction } from "../../model.ts";
import { renderButton } from "../../../ui-library/components/button.ts";

export function renderReactionGroup(input: {
  editionId: string;
  itemId: string;
  reaction?: Reaction | null;
}): string {
  return `<div class="reaction-group" role="group" aria-label="Настроить интересы">
    ${renderButton({ label: "Больше такого", variant: "icon", className: "icon-button", icon: "🔔", ariaLabel: "Больше такого", attributes: { title: "Больше такого", "aria-pressed": String(input.reaction === "like"), "data-reaction": "like", "data-edition-id": input.editionId, "data-item-id": input.itemId } })}
    ${renderButton({ label: "Меньше такого", variant: "icon", className: "icon-button", icon: "🔕", ariaLabel: "Меньше такого", attributes: { title: "Меньше такого", "aria-pressed": String(input.reaction === "dislike"), "data-reaction": "dislike", "data-edition-id": input.editionId, "data-item-id": input.itemId } })}
  </div>`;
}

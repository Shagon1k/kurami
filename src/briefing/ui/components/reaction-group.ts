import type { Reaction } from "../../model.ts";
import { renderButton } from "../../../ui-library/components/button.ts";
import {digestText} from "../../i18n.ts";

export function renderReactionGroup(input: {
  editionId: string;
  itemId: string;
  reaction?: Reaction | null;
}): string {
  return `<div class="reaction-group" role="group" aria-label="${digestText("Настроить интересы","Tune interests")}">
    ${renderButton({ label: digestText("Больше такого","More like this"), variant: "icon", className: "reaction-button", iconPath: "M12 19V5 M6 11l6-6 6 6", attributes: { title: digestText("Больше такого","More like this"), "aria-pressed": String(input.reaction === "like"), "data-reaction": "like", "data-edition-id": input.editionId, "data-item-id": input.itemId } })}
    ${renderButton({ label: digestText("Меньше такого","Less like this"), variant: "icon", className: "reaction-button", iconPath: "M12 5v14 m-6-6 6 6 6-6", attributes: { title: digestText("Меньше такого","Less like this"), "aria-pressed": String(input.reaction === "dislike"), "data-reaction": "dislike", "data-edition-id": input.editionId, "data-item-id": input.itemId } })}
  </div>`;
}

import { renderButton } from "../../../ui-library/components/button.ts";
import {digestText} from "../../i18n.ts";

/** Shared deterministic control; order and evidence are supplied by the runtime. */
export function renderFeedOrderControl(): string {
  return `<div class="feed-order" data-feed-order-control>
    <div class="feed-order__buttons" role="group" aria-label="${digestText("Порядок новостей","News order")}">
      ${renderButton({ label: digestText("Обзор","Briefing"), variant: "toggle", attributes: { "data-news-order": "briefing", "aria-pressed": "true" } })}
      ${renderButton({ label: digestText("Для меня","For me"), variant: "toggle", disabled: true, attributes: { "data-news-order": "for-you", "aria-pressed": "false" } })}
    </div>
    <p class="feed-order__status" data-interest-status role="status" aria-live="polite">${digestText("Обзор — утренний порядок. Все сюжеты доступны.","Briefing order. All stories remain available.")}</p>
    <details class="disclosure feed-order__explanation"><summary>${digestText("Как учитываются интересы","How interests are used")}</summary>
      <p>${digestText("Стрелка вверх — больше такого, стрелка вниз — меньше. Повторный клик снимает реакцию. Предпочтения учитываются после 10 реакций; каждой теме нужно хотя бы 3 реакции на разных сюжетах. Вес от −1 до +1 показывает направление интереса. Узкие темы и их сочетания влияют сильнее источника. Срочные важные новости сохраняют место.","Up means more like this; down means less. Click again to clear a reaction. Preferences apply after 10 reactions, with at least 3 reactions on distinct stories for each topic. A weight from −1 to +1 shows the direction of interest. Specific topics and their combinations count more than the source. Urgent important news keeps its place.")}</p>
      <p data-interest-coverage></p>
      <ul data-interest-weights></ul>
    </details>
  </div>`;
}

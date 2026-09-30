import { renderButton } from "../../../ui-library/components/button.ts";

/** Shared deterministic control; order and evidence are supplied by the runtime. */
export function renderFeedOrderControl(): string {
  return `<div class="feed-order" data-feed-order-control>
    <div class="feed-order__buttons" role="group" aria-label="Порядок новостей">
      ${renderButton({ label: "Обзор", variant: "secondary", attributes: { "data-news-order": "briefing", "aria-pressed": "true" } })}
      ${renderButton({ label: "Для меня", variant: "secondary", disabled: true, attributes: { "data-news-order": "for-you", "aria-pressed": "false" } })}
    </div>
    <p class="feed-order__status" data-interest-status role="status" aria-live="polite">Обзор — утренний порядок. Все сюжеты доступны.</p>
    <details class="disclosure feed-order__explanation"><summary>Как учитываются интересы</summary>
      <p>Стрелка вверх — больше такого, стрелка вниз — меньше. Повторный клик снимает реакцию. Предпочтения учитываются после 10 реакций; каждой теме нужно хотя бы 3 реакции на разных сюжетах. Вес от −1 до +1 показывает направление интереса. Узкие темы и их сочетания влияют сильнее источника. Срочные важные новости сохраняют место.</p>
      <p data-interest-coverage></p>
      <ul data-interest-weights></ul>
    </details>
  </div>`;
}

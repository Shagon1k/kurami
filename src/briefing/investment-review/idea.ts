import {escapeHtml as e} from "../ui/html.ts";
import {renderKuramiComment} from "../ui/components/kurami-comment.ts";
import type {ReviewCandidate,ReviewIdea} from "./model.ts";

/** Research-only card: no quote, allocation, order or position controls. */
export function renderReviewIdea(candidate:ReviewCandidate,idea:ReviewIdea,evidence:string):string {
  return `<details class="review-position review-idea"><summary><strong>${e(candidate.name)} · ${e(candidate.symbol)}</strong> · ${e(candidate.exchange)} · изучить</summary>
    <div class="review-position__body">${renderKuramiComment({context:"Идея: "+candidate.symbol,paragraphs:[
      {label:"Почему смотрим",text:idea.rationale},
      {label:"Для твоего портфеля",text:idea.portfolioMeaning},
      {label:"Что может пойти иначе",text:idea.counterargument},
      {label:"Альтернатива",text:idea.alternative},
      {label:"Чего не хватает для покупки",text:idea.valuationGap},
      {label:"За чем следить",text:idea.revisitWhen}
    ]})}${evidence}</div></details>`;
}

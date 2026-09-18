import {escapeHtml as e} from "../ui/html.ts";
import {renderKuramiComment} from "../ui/components/kurami-comment.ts";
import {renderReviewPosition,renderReviewEvidence,renderResearchCoverage} from "./position.ts";
import {renderReviewIdea} from "./idea.ts";
import {renderLearningNotes,REVIEW_LEARNING_STYLES} from "./learning-note.ts";
import {reviewFreshness,type StoredReview} from "./store.ts";
import type {ReviewInput} from "./model.ts";
export const REVIEW_PANEL_STYLES=REVIEW_LEARNING_STYLES+`
.investment-review{margin:32px 0;padding:24px;border:1px solid var(--line);background:var(--panel)}
.investment-review h2{font-size:1.5rem;margin:0 0 12px}.investment-review summary{cursor:pointer;min-height:44px;padding:12px 0}
.investment-review details{border-top:1px solid var(--line)}.investment-review__body{padding:0 0 16px;max-width:95ch}
.investment-review__status{color:var(--muted);line-height:1.5}
@media(max-width:600px){.investment-review{padding:16px}}
`;
/** Compact, cache-only, no action controls; only accepted independent slots. */
export function renderReviewPanel(reports:Array<StoredReview|null>,at:string,baseline?:ReviewInput["baseline"]):string{
  const items=reports.filter((r):r is StoredReview=>Boolean(r));
  if(!items.length)return "";
  return `<section class="investment-review" aria-labelledby="investment-review-title"><h2 id="investment-review-title">Обзор портфеля</h2>${items.map(r=>{
    const freshness=reviewFreshness(r,at,baseline),label=r.input.mode==="monthly"?"Месяц":r.input.mode==="weekly"?"Неделя":"Пробный обзор";
    const status=freshness.changedHoldings?"Состав изменился — советы требуют пересмотра":freshness.needsConfirmation?"Нужно подтвердить текущий состав":freshness.stale?"Предыдущий обзор — ожидает обновления":"Сохранённый обзор";
    return `<details><summary><strong>${label}</strong> · ${e(r.input.asOfDate)} · ${e(r.draft.headline)}</summary><div class="investment-review__body"><p class="investment-review__status">${status}. Расчёты и мнение относятся к дате отчёта.</p>
      ${renderKuramiComment({context:label,items:r.draft.summary})}
      ${renderResearchCoverage(r.input)}
      ${r.draft.positions.map(p=>`<details><summary>${e(p.symbol)}</summary>${renderReviewPosition(r.input,p)}</details>`).join("")}
      ${r.draft.ideas?.length?`<h3>Идеи для изучения</h3><p>Не предложения купить; доступность в Revolut не проверена.</p>${r.draft.ideas.map(i=>renderReviewIdea(r.input.candidates!.find(c=>c.symbol===i.symbol)!,i,renderReviewEvidence(r.input,i.factIds))).join("")}`:""}
      ${renderLearningNotes(r.draft.learningNotes,r.input.mode+"-")}
      </div></details>`;
  }).join("")}</section>`;
}

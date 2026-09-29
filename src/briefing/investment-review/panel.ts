import {escapeHtml as e} from "../ui/html.ts";
import {renderKuramiComment} from "../ui/components/kurami-comment.ts";
import {renderReviewPosition,renderReviewEvidence,renderResearchCoverage} from "./position.ts";
import {renderReviewIdea} from "./idea.ts";
import {renderLearningNotes,REVIEW_LEARNING_STYLES} from "./learning-note.ts";
import {reviewFreshness,type StoredReview} from "./store.ts";
import type {ReviewInput} from "./model.ts";
export const REVIEW_PANEL_STYLES=REVIEW_LEARNING_STYLES+`
.investment-review{margin:32px 0;border:1px solid var(--border-default);background:var(--surface-panel)}
.investment-review h2{font-size:1.5rem;margin:0}.investment-review summary{cursor:pointer;min-height:44px;padding:12px 0}
.investment-review>summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px;list-style:none}
.investment-review>summary::-webkit-details-marker{display:none}
.investment-review>summary:hover{background:var(--surface-section)}
.investment-review>summary:focus-visible{outline:2px solid var(--accent-primary);outline-offset:3px}
.investment-review__chevron{font-size:20px;line-height:1}
.investment-review[open]>summary .investment-review__chevron{transform:rotate(180deg)}
.investment-review__content{padding:0 24px 8px}
.investment-review details{border-top:1px solid var(--border-default)}.investment-review__body{padding:0 0 16px;max-width:95ch}
.investment-review__status{color:var(--text-muted);line-height:1.5}
@media(max-width:600px){.investment-review>summary{padding:16px}.investment-review__content{padding:0 16px 8px}}
`;
/** Compact, cache-only, no action controls; only accepted independent slots. */
export function renderReviewPanel(reports:Array<StoredReview|null>,at:string,baseline?:ReviewInput["baseline"]):string{
  const items=reports.filter((r):r is StoredReview=>Boolean(r));
  if(!items.length)return "";
  return `<details class="investment-review"><summary><h2>Обзор портфеля</h2><span class="investment-review__chevron" aria-hidden="true">⌄</span></summary><div class="investment-review__content">${items.map(r=>{
    const freshness=reviewFreshness(r,at,baseline),label=r.input.mode==="monthly"?"Месяц":r.input.mode==="weekly"?"Неделя":"Обзор";
    const date=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Vilnius"}).format(new Date(r.input.asOfDate+"T12:00:00Z"));
    const status=freshness.changedHoldings?"Состав изменился — советы требуют пересмотра":freshness.needsConfirmation?"Нужно подтвердить текущий состав":freshness.stale?"Предыдущий обзор — ожидает обновления":"";
    const body=`<div class="investment-review__body">${items.length===1?`<p class="investment-review__status"><time datetime="${e(r.input.asOfDate)}">${e(date)}</time></p>`:""}${status?`<p class="investment-review__status">${status}.</p>`:""}
      ${renderKuramiComment({context:label,items:r.draft.summary})}
      ${renderResearchCoverage(r.input)}
      ${r.draft.positions.map(p=>`<details><summary>${e(p.symbol)}</summary>${renderReviewPosition(r.input,p)}</details>`).join("")}
      ${r.draft.ideas?.length?`<h3>Идеи для изучения</h3><p>Не предложения купить; доступность в Revolut не проверена.</p>${r.draft.ideas.map(i=>renderReviewIdea(r.input.candidates!.find(c=>c.symbol===i.symbol)!,i,renderReviewEvidence(r.input,i.factIds))).join("")}`:""}
      ${renderLearningNotes(r.draft.learningNotes,r.input.mode+"-")}
      </div>`;
    return items.length===1?body:`<details class="investment-review__period"><summary>${label} · ${e(date)}</summary>${body}</details>`;
  }).join("")}</div></details>`;
}

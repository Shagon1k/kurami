import {escapeHtml as e} from "../ui/html.ts";
import {renderIcon} from "../../ui-library/components/icon.ts";
import {renderKuramiComment} from "../ui/components/kurami-comment.ts";
import {renderReviewPosition,renderReviewEvidence,renderResearchCoverage} from "./position.ts";
import {renderReviewIdea} from "./idea.ts";
import {renderLearningNotes,REVIEW_LEARNING_STYLES} from "./learning-note.ts";
import {reviewFreshness,type StoredReview} from "./store.ts";
import type {ReviewInput} from "./model.ts";
import {renderDisclosure} from "../../ui-library/components/disclosure.ts";
export const REVIEW_PANEL_STYLES=REVIEW_LEARNING_STYLES+`
.investment-review{margin:32px 0;border:1px solid var(--border-default);background:var(--surface-panel)}
.investment-review h2{font-size:1.5rem;margin:0}
.investment-review>summary{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:24px;list-style:none}
.investment-review>summary::-webkit-details-marker{display:none}
.investment-review>summary:hover{background:var(--surface-section)}
.investment-review>summary:focus-visible{outline:2px solid var(--accent-primary);outline-offset:3px}
.investment-review__chevron{display:inline-flex;flex:none;transition:transform var(--duration-fast)}
.investment-review[open]>summary .investment-review__chevron{transform:rotate(180deg)}
.investment-review[open]>summary{background:var(--surface-section)}
.investment-review__content{padding:0 24px 8px}
.investment-review details{border-top:1px solid var(--border-default)}.investment-review__body{padding:0 0 16px;max-width:95ch}
.investment-review__status{color:var(--text-muted);line-height:1.5}
.investment-review__heading{min-width:0;display:grid;gap:var(--space-2)}
.investment-review__meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--space-1) var(--space-3);font-size:.75rem;color:var(--text-muted);line-height:1.5}
.investment-review__warning{color:var(--status-warning)}
@media(max-width:600px){.investment-review>summary{padding:16px}.investment-review__content{padding:0 16px 8px}}
`;
/** Compact, cache-only, no action controls; only accepted independent slots. */
export function renderReviewPanel(reports:Array<StoredReview|null>,at:string,baseline?:ReviewInput["baseline"]):string{
  const items=reports.filter((r):r is StoredReview=>Boolean(r));
  if(!items.length)return "";
  const metadata=items.map(r=>{
    const freshness=reviewFreshness(r,at,baseline),label=r.input.mode==="monthly"?"Месяц":"Неделя";
    const date=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",year:"numeric",timeZone:"Europe/Vilnius"}).format(new Date(r.input.asOfDate+"T12:00:00Z"));
    const warnings=[freshness.stale?"Обзор устарел":"",freshness.changedHoldings?"Состав изменился":freshness.needsConfirmation?"Подтверди состав":""].filter(Boolean);
    return `<span class="investment-review__meta"><span>${items.length>1?label+" · ":""}<time datetime="${e(r.input.asOfDate)}">${e(date)}</time></span>${warnings.length?`<span class="investment-review__warning">${warnings.join(" · ")}</span>`:""}</span>`;
  }).join("");
  return `<details class="investment-review"><summary><span class="investment-review__heading"><h2>Обзор портфеля</h2>${metadata}</span><span class="investment-review__chevron" aria-hidden="true">${renderIcon("chevronDown")}</span></summary><div class="investment-review__content">${items.map(r=>{
    const freshness=reviewFreshness(r,at,baseline),label=r.input.mode==="monthly"?"Месяц":r.input.mode==="weekly"?"Неделя":"Обзор";
    const date=new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",year:"numeric",timeZone:"Europe/Vilnius"}).format(new Date(r.input.asOfDate+"T12:00:00Z"));
    const status=freshness.changedHoldings?"Состав изменился — советы требуют пересмотра":freshness.needsConfirmation?"Нужно подтвердить текущий состав":freshness.stale?"Предыдущий обзор — ожидает обновления":"";
    const body=`<div class="investment-review__body">${items.length===1?`<p class="investment-review__status"><time datetime="${e(r.input.asOfDate)}">${e(date)}</time></p>`:""}${status?`<p class="investment-review__status">${status}.</p>`:""}
      ${renderKuramiComment({context:label,items:r.draft.summary})}
      ${renderResearchCoverage(r.input)}
      ${r.draft.positions.map(p=>renderDisclosure({summary:p.symbol,body:renderReviewPosition(r.input,p),variant:"inline"})).join("")}
      ${r.draft.ideas?.length?`<h3>Идеи для изучения</h3><p>Не предложения купить; доступность в Revolut не проверена.</p>${r.draft.ideas.map(i=>renderReviewIdea(r.input.candidates!.find(c=>c.symbol===i.symbol)!,i,renderReviewEvidence(r.input,i.factIds))).join("")}`:""}
      ${renderLearningNotes(r.draft.learningNotes,r.input.mode+"-")}
      </div>`;
    return items.length===1?body:renderDisclosure({summary:label+" · "+date,body,variant:"inline",className:"investment-review__period"});
  }).join("")}</div></details>`;
}

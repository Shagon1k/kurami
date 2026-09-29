import {escapeHtml as e} from "../ui/html.ts";
import {renderKuramiComment} from "../ui/components/kurami-comment.ts";
import {calculateReview,type ReviewDraft,type ReviewInput} from "./model.ts";
export const investmentAdviceLabels={review:"Недостаточно данных для совета",maintain:"Оставить без изменений","no-add":"Пока не увеличивать позицию",wait:"Дождаться конкретного события","consider-add":"Рассмотреть докупку","consider-trim":"Рассмотреть частичную продажу","consider-exit":"Рассмотреть полную продажу","not-assessed":"Анализ ещё не проведён"};
export function renderResearchCoverage(input:ReviewInput):string{
  const staleFund=input.fundHoldings&&!calculateReview(input).fundHoldingsUsable;
  const coverage=input.researchCoverage??[];
  if(!coverage.length&&!staleFund)return "";
  const title=coverage.length?"Источники: "+coverage.filter(c=>c.state==="fresh"||c.state==="primary").length+"/"+coverage.length+" с обновлёнными данными"+(staleFund?" · состав фонда устарел":""):"Состав фонда устарел";
  return `<details class="disclosure review-evidence"><summary>${title}</summary><p>Проверены показатели или первичные документы, не все новости. Даты и пробелы — ниже.</p>${staleFund?"<p>Состав фонда старше 45 дней: пересечения не рассчитаны, это не нулевые доли.</p>":""}<ul>${coverage.map(c=>`<li>${e(c.symbol)}: ${e(c.note)}</li>`).join("")}</ul></details>`;
}
export function renderReviewEvidence(input:ReviewInput,ids:string[]):string{
  return ids.length?`<details class="disclosure review-evidence"><summary>Факты и источники (${ids.length})</summary><ul>${ids.map(id=>{
    const f=input.facts.find(f=>f.id===id)!,s=input.sources.find(s=>s.id===f.sourceId)!;
    return `<li>${e(f.statement)} <a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)}</a> · ${e(s.asOfDate)}</li>`;
  }).join("")}</ul></details>`:"";
}
export function renderReviewPosition(input:ReviewInput,p:ReviewDraft["positions"][number]):string{
  return renderKuramiComment({context:p.symbol,paragraphs:[
    {label:"Совет",text:investmentAdviceLabels[p.action]+" — "+p.adviceReason},
    ...(p.blockingInfo?[{label:"Чего не хватает",text:p.blockingInfo}]:[]),
    {label:"Короткий вывод",text:p.rationale},{label:"Для твоего портфеля",text:p.portfolioMeaning},
    {label:"Что может пойти иначе",text:p.counterargument},{label:"За чем следить",text:p.revisitWhen}
  ]})+renderReviewEvidence(input,p.factIds);
}

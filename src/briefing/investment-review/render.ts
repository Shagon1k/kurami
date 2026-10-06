import {renderPageShell} from "../ui/page-shell.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {calculateReview,validateReviewDraft,type ReviewInput,type ReviewDraft} from "./model.ts";
import {renderLearningNotes,REVIEW_LEARNING_STYLES,REVIEW_LEARNING_SCRIPT} from "./learning-note.ts";
import {dayShift} from "../stocks/model.ts";
import {renderKuramiComment} from "../ui/components/kurami-comment.ts";
import {renderReviewIdea} from "./idea.ts";
import {investmentAdviceLabels,renderReviewPosition,renderReviewEvidence,renderResearchCoverage} from "./position.ts";
import {THEME_RUNTIME_JS} from "../../ui-library/runtime/theme.ts";
import {renderDisclosure} from "../../ui-library/components/disclosure.ts";
import {FIGURE_ATTRIBUTE} from "../../ui-library/components/surface.ts";
export {investmentAdviceLabels} from "./position.ts";

const eur=(n:number|null)=>n===null?"недостаточно данных":new Intl.NumberFormat("ru-RU",{style:"currency",currency:"EUR",maximumFractionDigits:2}).format(n);
const pct=(n:number|null)=>n===null?"—":new Intl.NumberFormat("ru-RU",{maximumFractionDigits:2}).format(n)+"%";
export function renderInvestmentReview(input:ReviewInput,value:ReviewDraft):string {
  const draft=validateReviewDraft(input,value),m=calculateReview(input);
  const position=(symbol:string)=>m.rows.find(r=>r.symbol===symbol)!;
  const evidence=(ids:string[])=>renderReviewEvidence(input,ids);
  const assessed=draft.positions.filter(p=>p.action!=="not-assessed").length;
  const content=`<section class="hero stocks-hero"><div><p class="hero__eyebrow">Приватный пробный обзор · ${e(input.asOfDate)}</p><h1>Обзор портфеля</h1></div></section>
    <div class="stocks-status"><span>Состав подтверждён: ${e(input.baseline.asOfLocalDate)}</span><span>Цены и валютный курс: ${e(input.fx.date)}</span><span>Разобрано по доступным фактам: ${assessed}/${m.rows.length}</span></div>
    <section class="review-section"><h2>Главное</h2>${renderKuramiComment({context:"Главное",headline:draft.headline,items:draft.summary})}</section>
    ${renderResearchCoverage(input)}
    <section class="stocks-watchlist"><header class="stocks-section-heading"><h2>Подтверждённый состав</h2><span>${eur(m.totalEUR)} · только указанные позиции, без остатка денег</span></header>
    <div class="table table--numeric review-table"><table><thead><tr><th>Акция / фонд</th><th>Количество</th><th>Оценка, EUR</th><th>Доля</th></tr></thead><tbody>${m.rows.map(r=>`<tr><th>${e(r.symbol)}</th><td>${e(r.quantity)}</td><td>${eur(r.valueEUR)}</td><td>${pct(r.weight)}</td></tr>`).join("")}</tbody></table></div>
    ${renderDisclosure({summary:"Как получилась стоимость",variant:"inline",className:"review-evidence",body:`<p>Количество акций или долей фонда умножается на цену закрытия торгов. Доллары переводятся в евро делением на ${input.fx.usdPerEUR} — справочный курс ECB на указанную дату. Получается оценка стоимости твоих вложений, а не прибыль от покупок: их стоимость приобретения пока неизвестна.</p>`})}</section>
    ${m.overlap.length?`<section class="review-section"><h2>Одни и те же компании — напрямую и через VUAA</h2><p>Считаем, какая часть всего портфеля связана с компанией: отдельные акции плюс её доля внутри фонда. Это приближение по составу VUAA на ${e(m.fundHoldingsDate!)}; показаны только проверенные пересечения.</p><div class="table table--numeric review-table"><table><thead><tr><th>Компания</th><th>Напрямую</th><th>Через фонд</th><th>Вместе</th></tr></thead><tbody>${m.overlap.map(r=>`<tr><th>${e(r.symbol)}</th><td>${pct(r.directWeight)}</td><td>${pct(r.fundWeight)}</td><td>${pct(r.totalWeight)}</td></tr>`).join("")}</tbody></table></div></section>`:""}
    <section class="review-section"><h2>Проверка устойчивости</h2><div class="review-stress">${m.stress.map(s=>`<article><h3>Сценарий −${pct(s.drop*100)}</h3><strong${FIGURE_ATTRIBUTE}>${eur(s.remainingEUR)}</strong><p>Снижение оценки на ${eur(s.lossEUR)}</p></article>`).join("")}</div><p class="stocks-footnote">Это арифметические сценарии, не прогноз, не оценка вероятности и не согласованный тобой предел риска. Отдельная подушка не включена.</p></section>
    <section class="review-section"><h2>Разбор твоих вложений</h2>${draft.positions.map(p=>{
      const r=position(p.symbol);
      return renderDisclosure({summary:p.symbol+" · "+pct(r.weight)+(p.action==="not-assessed"?" · "+investmentAdviceLabels[p.action]:""),variant:"inline",className:"review-position",open:p.action!=="not-assessed",body:`<div class="review-position__body">${renderReviewPosition(input,p)}
      ${p.learningIds.length?`<div class="review-learning-links">${p.learningIds.map(id=>`<a data-review-lesson-link href="#learn-${e(id)}">Разобраться: ${e(draft.learningNotes.find(n=>n.id===id)!.term)}</a>`).join("")}</div>`:""}</div>`});
    }).join("")}</section>
    ${draft.ideas?.length?`<section class="review-section"><h2>Идеи для изучения</h2><p>Отдельно от твоих вложений. Это кандидаты для дальнейшего разбора, не предложения купить сейчас; доступность в Revolut ещё не подтверждена.</p>${draft.ideas.map(idea=>renderReviewIdea(input.candidates!.find(c=>c.symbol===idea.symbol)!,idea,evidence(idea.factIds))).join("")}</section>`:""}
    ${renderLearningNotes(draft.learningNotes)}
    <section class="review-section"><h2>Деньги и действия</h2><p>Плановый диапазон новых взносов — €100–200 за календарный месяц. Общий предел — 5 покупок и продаж, не обязательное количество.</p><p>Период учёта: с ${e(m.tradeWindow.start)} по ${e(dayShift(m.tradeWindow.endExclusive,-1))} включительно.</p><p>Остаток сделок: ${m.remainingTrades??"неизвестен"}. Остаток бюджета новых взносов: ${m.remainingNewMoneyEUR===null?"неизвестен":eur(m.remainingNewMoneyEUR)}. Прибыль от покупок, комиссии и налоговый результат продажи не рассчитаны.</p>
    ${m.scenarios.length?renderDisclosure({summary:"Как пополнение фонда изменило бы доли — без продаж",variant:"inline",body:`<ul>${m.scenarios.map(s=>`<li>Если добавить ${eur(s.newMoneyEUR)} только в ${e(s.fundSymbol)}, его доля стала бы ${pct(s.fundWeightIfAdded)}.</li>`).join("")}</ul><p>Условный пример при неизменных ценах, без комиссий. Это не доступный остаток бюджета, не целевая доля и не поручение купить.</p>`}):""}
    ${renderKuramiComment({context:"Возможные следующие шаги",items:draft.nextSteps,ordered:true})}<p>Заявок на покупку или продажу нет. Ни портфель, ни учёт операций этим отчётом не изменяются.</p></section>
    ${renderDisclosure({summary:"Источники и границы проверки",variant:"inline",className:"review-section",body:`<ul>${input.sources.map(s=>`<li><a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)}</a> · данные на ${e(s.asOfDate)}</li>`).join("")}</ul><p>Рыночные цены — сохранённый срез EODHD. Источники проверены выборочно для отмеченных позиций; отсутствие разбора остальных не означает рекомендацию держать их. Первичный источник подтверждает сообщённый факт, но не объективность прогноза компании. Оценка справедливой цены и вероятность доходности не установлены.</p><p>Версия входных данных: ${e(m.inputDigest.slice(0,16))}. Пробный выпуск не размещён на /stocks и не запускается по расписанию.</p>`})}`;
  return renderPageShell({title:"Пробный обзор портфеля",brand:"Kurami",section:"stocks",date:input.asOfDate,dateLabel:"Приватный пробный обзор",generated:input.asOfDate,timezone:"Europe/Vilnius",content})
    .replace('</style>',`.review-section{margin:36px 0}.review-section h2{font-size:1.6rem;font-weight:600}.review-section p,.review-section li{line-height:1.65}.review-table{--table-font-size:inherit;--table-cell-padding:12px}.review-stress{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:20px}.review-stress article{padding:20px;background:var(--surface-panel);border:1px solid var(--border-default)}.review-stress strong{font-size:1.8rem}.review-position{border-top:1px solid var(--border-default);padding:8px 0}.review-position summary,.review-section>summary{cursor:pointer;min-height:44px;align-content:center}.review-position__body{padding:0 20px 12px;max-width:95ch}a{overflow-wrap:anywhere}@media(max-width:600px){.review-table{--table-cell-padding:10px 6px;--table-font-size:.8rem}.review-position__body{padding-left:8px;padding-right:8px}} ${REVIEW_LEARNING_STYLES}</style>`)
    .replace('</head>',`<script>${THEME_RUNTIME_JS}</script></head>`)
    .replace('</body>',`<script>${REVIEW_LEARNING_SCRIPT}</script></body>`);
}

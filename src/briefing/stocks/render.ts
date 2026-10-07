import {FIGURE_ATTRIBUTE,surfaceAttributes} from "../../ui-library/components/surface.ts";
import type {BriefingPayload} from "../model.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {renderPageShell} from "../ui/page-shell.ts";
import {parseStocksSnapshot,stocksBrief,type StocksBrief,type StocksSnapshot} from "./model.ts";
import {stockSelection,type StockPeriod} from "./view.ts";

import {shortDate,delta,figureDelta,money,formatStockPercent} from "./format.ts";
export {formatStockPercent} from "./format.ts";
import {renderStockRow,stockHref} from "./components.ts";
import {stockInsights} from "./insights.ts";
import {renderStocksDiscovery} from "./discovery-render.ts";
import type {DiscoverySnapshot} from "./discovery-model.ts";
import type {CompanyLogoDomains} from "./logo-registry.ts";
import {renderReviewPanel,REVIEW_PANEL_STYLES} from "../investment-review/panel.ts";
import type {StoredReview} from "../investment-review/store.ts";
import {digestLanguage,digestText as t} from "../i18n.ts";
import {renderSelectField} from "../../ui-library/components/form.ts";
import {renderButton} from "../../ui-library/components/button.ts";
import {BASELINE_MAX_AGE_DAYS} from "../investment-review/portfolio-notes.ts";
const href=(ids:string[],period:StockPeriod,anchor=true)=>"/stocks?"+new URLSearchParams({symbols:ids.join(","),period}).toString()+(anchor?"#stock-"+ids[0]:"");

/** The investment review's notes for this morning: watch dates that came due, and the baseline reminder. */
function portfolioNotesBlock(brief:StocksBrief):string {
  const notes=brief.data.portfolio;
  if(!notes||(!notes.remind&&!notes.watch.length))return "";
  const watch=notes.watch.map(item=>`<p>${t("Сегодня по плану","Due today")}: <strong>${e(item.symbol)}</strong> — ${e(item.text)}</p>`).join("");
  const remind=notes.remind?`<p data-portfolio-note>${t(`Состав портфеля подтверждён ${notes.ageDays} дн. назад; без подтверждения через ${Math.max(0,BASELINE_MAX_AGE_DAYS-notes.ageDays)} дн. воскресный обзор не запустится.`,`The portfolio positions were confirmed ${notes.ageDays} days ago; without a confirmation the Sunday review stops in ${Math.max(0,BASELINE_MAX_AGE_DAYS-notes.ageDays)} days.`)} ${renderButton({label:t("Состав не менялся","Positions unchanged"),variant:"secondary",size:"compact",type:"button",busyLabel:"…",attributes:{"data-portfolio-confirm":true,"data-haptic":"confirm"}})}</p>`:"";
  return `<div class="stocks-portfolio-notes">${watch}${remind}</div>`;
}

export function renderStocksTeaser(payload:BriefingPayload):string {
  const brief=payload.addons.stocks as unknown as StocksBrief|undefined;
  if(!brief || brief.version!==1 || !Array.isArray(brief.data?.quotes))return "";
  const quotes=brief.data.quotes,benchmark=quotes.find(q=>q.asset.id===brief.data.benchmark);
  const ready=quotes.filter(q=>q.state==="ready");
  const movers=ready.filter(q=>q.asset.id!==brief.data.benchmark&&q.day!==null&&Math.abs(q.day)>=brief.data.threshold)
    .sort((a,b)=>Math.abs(b.day!)-Math.abs(a.day!)||a.asset.id.localeCompare(b.asset.id)).slice(0,3);
  const dates=[...new Set(quotes.flatMap(q=>q.date?[q.date]:[]))].sort();
  const overview=dates.length?dates.map(shortDate).join(" / "):t("даты пока недоступны","dates unavailable");
  return `<section class="stocks-teaser"${surfaceAttributes("panel")} aria-labelledby="stocks-heading">
    <header><div><p class="hero__eyebrow">${t("Закрытие сессии","Session close")} · ${e(overview)}</p><h2 id="stocks-heading">${t("Акции","Stocks")}</h2></div>
    <a class="button button--secondary" href="/stocks">${t("Открыть обзор","Open overview")} →</a></header>
    <div class="stocks-teaser__body">
      ${benchmark?`<div class="stocks-benchmark"><span>${e(benchmark.asset.id)} · S&P 500 ETF</span><strong${FIGURE_ATTRIBUTE}>${e(money(benchmark))}</strong>${figureDelta(benchmark.day)}<small>${benchmark.state==="ready"?t("за последнюю сессию","latest session"):t("последние доступные данные","last available data")}</small></div>`:""}
      <div class="stocks-movers">${movers.length?`<ul>${movers.map(q=>`<li><a href="${e(href([q.asset.id],"1m"))}">${e(q.asset.id)} <span>${e(q.asset.name)}</span></a>${figureDelta(q.day)}</li>`).join("")}</ul>`
        :`<p>${ready.length?t("Среди обновлённых акций нет движения от ","No refreshed stock moved at least ")+brief.data.threshold+t("% за сессию.","% in the session."):t("Свежие котировки пока недоступны. Дайджест продолжает работать.","Fresh quotes are unavailable. The digest continues to work.")}</p>`}
      ${ready.length<quotes.length?`<small class="stocks-warning">${t("Свежие данные","Fresh data")}: ${ready.length}/${quotes.length}. ${t("Остальные не участвуют в подборке движений.","The others are excluded from the move selection.")}</small>`:""}</div>
    </div>${portfolioNotesBlock(brief)}<p class="stocks-footnote">${t("Проценты учитывают сплиты и дивиденды. Это утренний срез списка наблюдения, не доходность портфеля.","Percentages account for splits and dividends. This is a morning watchlist snapshot, not portfolio performance.")}</p>
  </section>`;
}

export function renderStocksPage(value:StocksSnapshot|null,params=new URLSearchParams(),at=new Date().toISOString(),discovery?:DiscoverySnapshot|null,logos?:CompanyLogoDomains,reviews:Array<StoredReview|null>=[]):string {
  const snapshot=value?parseStocksSnapshot(value):null;
  const timezone="Europe/Vilnius",date=at.slice(0,10);
  if(!snapshot)return renderPageShell({title:t("Мои акции","My stocks"),brand:"Kurami Stocks",section:"stocks",date,dateLabel:t("Список наблюдения","Watchlist"),generated:"—",timezone,
    content:`<section class="hero stocks-hero"><div><p class="hero__eyebrow">${t("Акции","Stocks")}</p><h1>${t("Котировки готовятся.","Quotes are being prepared.")}</h1><p class="hero__subtitle">${t("Пока нет сохранённого среза. Остальные разделы работают независимо.","No saved snapshot yet. Other sections work independently.")}</p><a href="/">← ${t("К Daily","Daily")}</a></div></section>`});
  const selection=stockSelection(snapshot,params),brief=stocksBrief(snapshot,snapshot.data.policy,at),quotes=brief.data.quotes;
  const ready=quotes.filter(q=>q.state==="ready").length;
  // Previously shared comparison URLs still open their first symbol; no selection UI.
  const selected=params.has("symbols")?selection.ids[0]:null;
  const rows=quotes.map((quote,index)=>renderStockRow(snapshot,quote.asset.id,selection.period,quote.asset.id===selected,at,index,logos)).join("");
  const insights=stockInsights(snapshot,at);
  const observations=insights.length?`<section class="stocks-observations" aria-labelledby="stocks-observations-heading"><h2 id="stocks-observations-heading">${t("Что изменилось","What changed")}</h2><ul>${insights.map(item=>`<li><a href="${e(stockHref(item.symbol,selection.period))}" data-stock-open="${e(item.symbol)}"><strong>${e(item.symbol)}</strong> ${item.kind==="high"?t("Новый максимум закрытия за 3 месяца","New 3-month closing high"):formatStockPercent(item.value)+(item.kind==="week"?t(" за 7 дней"," over 7 days"):t(" за сессию"," in the session"))} <span aria-hidden="true">↗</span></a><small>${t("На","As of")} ${e(shortDate(item.date))}</small></li>`).join("")}</ul></section>`:"";
  const updated=new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU",{timeZone:timezone,day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(snapshot.capturedAt));
  const reviewPanel=digestLanguage()==="en"&&reviews.some(Boolean)
    ? `<aside class="callout callout--warning stocks-notice">Portfolio reviews are currently available in Russian. <a href="/ru/stocks">Open the original</a>.</aside>`
    : renderReviewPanel(reviews,at);
  const content=`<section class="hero stocks-hero"><div><p class="hero__eyebrow">${t("Твой список наблюдения","Your watchlist")}</p><h1>${t("Мои акции","My stocks")}</h1>
    <p class="hero__subtitle">${quotes.length} ${t("акций и ETF · раскрой строку, чтобы посмотреть динамику","stocks and ETFs · expand a row to view performance")}</p></div></section>
    <div class="stocks-status"><span>${t("Получено","Retrieved")}: ${e(updated)}</span><span>${t("Источник","Source")}: <a href="https://eodhd.com/" target="_blank" rel="noopener noreferrer">EODHD</a> · ${t("обновление раз в сутки","updated daily")}</span></div>
    ${ready<quotes.length?`<aside class="callout callout--warning stocks-notice">${t("Свежие котировки","Fresh quotes")}: ${ready}/${quotes.length}. ${t("Даты и состояние сохранённых котировок указаны в строках.","Dates and the status of saved quotes are shown in each row.")}</aside>`:""}
    ${observations}
    ${reviewPanel}
    <section class="stocks-watchlist"${surfaceAttributes("lead")} aria-labelledby="stocks-list-heading" data-stock-list data-stock-period="${selection.period}">
      <header class="stocks-section-heading"><div><h2 id="stocks-list-heading">${t("В твоём списке","In your watchlist")}</h2><p>${t("Цена закрытия и изменение за сессию","Closing price and session change")}</p></div>
        <div class="stocks-sort">${renderSelectField({name:"stock-sort",label:t("Порядок","Order"),value:"original",attributes:{"data-stock-sort":true},options:[{value:"original",label:t("Мой порядок","My order")},{value:"moves",label:t("Заметные движения","Notable moves")}]})}</div>
      </header>
      <div data-stock-rows>${rows}</div>
    </section>
    ${renderStocksDiscovery(discovery,at,new Set(quotes.map(q=>q.asset.id)),logos)}`;
  return renderPageShell({title:t("Мои акции","My stocks"),brand:"Kurami Stocks",section:"stocks",date,dateLabel:t("Цены закрытия · ","Closing prices · ")+ready+"/"+quotes.length+t(" актуальных"," current"),generated:updated,updatedAt:snapshot.capturedAt,timezone,content,
    ...(logos?.size?{footerLink:{label:"Logos by AllInvestView",href:"https://www.allinvestview.com/tools/ticker-logos/"}}:{})}).replace("</style>",REVIEW_PANEL_STYLES+"</style>");
}

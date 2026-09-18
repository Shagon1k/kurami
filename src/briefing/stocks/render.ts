import type {BriefingPayload} from "../model.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {renderPageShell} from "../ui/page-shell.ts";
import {parseStocksSnapshot,stocksBrief,type StocksBrief,type StocksSnapshot} from "./model.ts";
import {stockSelection,type StockPeriod} from "./view.ts";

import {shortDate,delta,money,formatStockPercent} from "./format.ts";
export {formatStockPercent} from "./format.ts";
import {renderStockRow,stockHref} from "./components.ts";
import {stockInsights} from "./insights.ts";
import {renderStocksDiscovery} from "./discovery-render.ts";
import type {DiscoverySnapshot} from "./discovery-model.ts";
import type {CompanyLogoDomains} from "./logo-registry.ts";
const href=(ids:string[],period:StockPeriod,anchor=true)=>"/stocks?"+new URLSearchParams({symbols:ids.join(","),period}).toString()+(anchor?"#stock-"+ids[0]:"");

export function renderStocksTeaser(payload:BriefingPayload):string {
  const brief=payload.addons.stocks as unknown as StocksBrief|undefined;
  if(!brief || brief.version!==1 || !Array.isArray(brief.data?.quotes))return "";
  const quotes=brief.data.quotes,benchmark=quotes.find(q=>q.asset.id===brief.data.benchmark);
  const ready=quotes.filter(q=>q.state==="ready");
  const movers=ready.filter(q=>q.asset.id!==brief.data.benchmark&&q.day!==null&&Math.abs(q.day)>=brief.data.threshold)
    .sort((a,b)=>Math.abs(b.day!)-Math.abs(a.day!)||a.asset.id.localeCompare(b.asset.id)).slice(0,3);
  const dates=[...new Set(quotes.flatMap(q=>q.date?[q.date]:[]))].sort();
  const overview=dates.length?dates.map(shortDate).join(" / "):"даты пока недоступны";
  return `<section class="stocks-teaser" aria-labelledby="stocks-heading">
    <header><div><p class="hero__eyebrow">Закрытие сессии · ${e(overview)}</p><h2 id="stocks-heading">Акции</h2></div>
    <a class="button button--secondary" href="/stocks">Открыть обзор →</a></header>
    <div class="stocks-teaser__body">
      ${benchmark?`<div class="stocks-benchmark"><span>${e(benchmark.asset.id)} · S&P 500 ETF</span><strong>${e(money(benchmark))}</strong>${delta(benchmark.day)}<small>${benchmark.state==="ready"?"за последнюю сессию":"последние доступные данные"}</small></div>`:""}
      <div class="stocks-movers">${movers.length?`<ul>${movers.map(q=>`<li><a href="${e(href([q.asset.id],"1m"))}">${e(q.asset.id)} <span>${e(q.asset.name)}</span></a>${delta(q.day)}</li>`).join("")}</ul>`
        :`<p>${ready.length?"Среди обновлённых акций нет движения от "+brief.data.threshold+"% за сессию.":"Свежие котировки пока недоступны. Дайджест продолжает работать."}</p>`}
      ${ready.length<quotes.length?`<small class="stocks-warning">Свежие данные: ${ready.length}/${quotes.length}. Остальные не участвуют в подборке движений.</small>`:""}</div>
    </div><p class="stocks-footnote">Проценты учитывают сплиты и дивиденды. Это утренний срез списка наблюдения, не доходность портфеля.</p>
  </section>`;
}

export function renderStocksPage(value:StocksSnapshot|null,params=new URLSearchParams(),at=new Date().toISOString(),discovery?:DiscoverySnapshot|null,logos?:CompanyLogoDomains):string {
  const snapshot=value?parseStocksSnapshot(value):null;
  const timezone="Europe/Vilnius",date=at.slice(0,10);
  if(!snapshot)return renderPageShell({title:"Мои акции",brand:"Kurami Stocks",section:"stocks",date,dateLabel:"Список наблюдения",generated:"—",timezone,
    content:'<section class="hero stocks-hero"><div><p class="hero__eyebrow">Акции</p><h1>Котировки готовятся.</h1><p class="hero__subtitle">Пока нет сохранённого среза. Остальные разделы работают независимо.</p><a href="/">← К Daily</a></div></section>'});
  const selection=stockSelection(snapshot,params),brief=stocksBrief(snapshot,snapshot.data.policy,at),quotes=brief.data.quotes;
  const ready=quotes.filter(q=>q.state==="ready").length;
  // Previously shared comparison URLs still open their first symbol; no selection UI.
  const selected=params.has("symbols")?selection.ids[0]:null;
  const rows=quotes.map((quote,index)=>renderStockRow(snapshot,quote.asset.id,selection.period,quote.asset.id===selected,at,index,logos)).join("");
  const insights=stockInsights(snapshot,at);
  const observations=insights.length?`<section class="stocks-observations" aria-labelledby="stocks-observations-heading"><h2 id="stocks-observations-heading">Что изменилось</h2><ul>${insights.map(item=>`<li><a href="${e(stockHref(item.symbol,selection.period))}" data-stock-open="${e(item.symbol)}"><strong>${e(item.symbol)}</strong> ${item.kind==="high"?"Новый максимум закрытия за 3 месяца":formatStockPercent(item.value)+(item.kind==="week"?" за 7 дней":" за сессию")} <span aria-hidden="true">↗</span></a><small>На ${e(shortDate(item.date))}</small></li>`).join("")}</ul></section>`:"";
  const updated=new Intl.DateTimeFormat("ru-RU",{timeZone:timezone,day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(snapshot.capturedAt));
  const content=`<section class="hero stocks-hero"><div><p class="hero__eyebrow">Твой список наблюдения</p><h1>Мои акции</h1>
    <p class="hero__subtitle">${quotes.length} акций и ETF · раскрой строку, чтобы посмотреть динамику</p></div></section>
    <div class="stocks-status"><span>Получено: ${e(updated)}</span><span>Источник: <a href="https://eodhd.com/" target="_blank" rel="noopener noreferrer">EODHD</a> · обновление раз в сутки</span></div>
    ${ready<quotes.length?`<aside class="stocks-notice">Свежие котировки: ${ready}/${quotes.length}. Даты и состояние сохранённых котировок указаны в строках.</aside>`:""}
    ${observations}
    <section class="stocks-watchlist" aria-labelledby="stocks-list-heading" data-stock-list data-stock-period="${selection.period}">
      <header class="stocks-section-heading"><div><h2 id="stocks-list-heading">В твоём списке</h2><p>Цена закрытия и изменение за сессию</p></div>
        <label class="stocks-sort">Порядок<select data-stock-sort><option value="original">Мой порядок</option><option value="moves">Заметные движения</option></select></label>
      </header>
      <div data-stock-rows>${rows}</div>
    </section>
    ${renderStocksDiscovery(discovery,at,new Set(quotes.map(q=>q.asset.id)),logos)}`;
  return renderPageShell({title:"Мои акции",brand:"Kurami Stocks",section:"stocks",date,dateLabel:"Цены закрытия · "+ready+"/"+quotes.length+" актуальных",generated:updated,timezone,content,
    ...(logos?.size?{footerLink:{label:"Logos by AllInvestView",href:"https://www.allinvestview.com/tools/ticker-logos/"}}:{})});
}

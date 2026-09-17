import type {BriefingPayload} from "../model.ts";
import {escapeHtml as e} from "../ui/html.ts";
import {renderPageShell} from "../ui/page-shell.ts";
import {renderTrendChart} from "../ui/charts/index.ts";
import {renderButton} from "../ui/components/button.ts";
import {renderSelectionControl} from "../ui/components/selection-control.ts";
import {parseStocksSnapshot,stockQuote,stocksBrief,type StockQuote,type StocksBrief,type StocksSnapshot} from "./model.ts";
import {stockSelection,stocksChart,type StockPeriod} from "./view.ts";

const shortDate=(date:string|null)=>date?new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z")):"нет даты";
export function formatStockPercent(value:number|null):string {
  if(value===null||!Number.isFinite(value))return "—";
  const rounded=Math.round(value*100)/100;
  return (rounded>0?"+":"")+new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Object.is(rounded,-0)?0:rounded)+"%";
}
const delta=(value:number|null)=>`<span class="stock-change ${value===null?"":value>0?"is-up":value<0?"is-down":""}">${e(formatStockPercent(value))}</span>`;
const money=(quote:StockQuote)=>quote.price===null?"—":new Intl.NumberFormat("ru-RU",{style:"currency",currency:quote.asset.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(quote.price);
const href=(ids:string[],period:StockPeriod,anchor=true)=>"/stocks?"+new URLSearchParams({symbols:ids.join(","),period}).toString()+(anchor?"#stocks-chart":"");

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

export function renderStocksPage(value:StocksSnapshot|null,params=new URLSearchParams(),at=new Date().toISOString()):string {
  const snapshot=value?parseStocksSnapshot(value):null;
  const timezone="Europe/Vilnius",date=at.slice(0,10);
  if(!snapshot)return renderPageShell({title:"Мои акции",brand:"Kurami Stocks",section:"stocks",date,dateLabel:"Список наблюдения",generated:"—",timezone,
    content:'<section class="hero stocks-hero"><div><p class="hero__eyebrow">Акции</p><h1>Котировки готовятся.</h1><p class="hero__subtitle">Пока нет сохранённого среза. Остальные разделы работают независимо.</p><a href="/">← К Daily</a></div></section>'});
  const selection=stockSelection(snapshot,params),brief=stocksBrief(snapshot,snapshot.data.policy,at),quotes=brief.data.quotes;
  const ready=quotes.filter(q=>q.state==="ready").length;
  const chart=stocksChart(snapshot,selection);
  const rows=quotes.map(quote=>`<tr class="${selection.ids.includes(quote.asset.id)?"is-selected":""}">
    <td class="stocks-select">${renderSelectionControl({label:"Сравнить "+quote.asset.name,checked:selection.ids.includes(quote.asset.id),disabled:quote.price===null,
      attributes:{"data-stock-select":true,value:quote.asset.id}})}</td>
    <th scope="row"><a class="stock-symbol" href="${e(href([quote.asset.id],selection.period))}">${e(quote.asset.id)}</a><span class="stock-name">${e(quote.asset.name)}</span>
      <small>${e(quote.asset.currency)} · ${e(quote.asset.exchange)}${quote.asset.kind==="etf"?" · ETF":""}</small></th>
    <td><strong>${e(money(quote))}</strong><small>${e(shortDate(quote.date))}</small>${quote.state!=="ready"?`<span class="stocks-warning">${quote.state==="stale"?"Устарело":"Нет данных"}</span>`:""}</td>
    <td>${delta(quote.day)}</td><td>${delta(quote.week)}</td><td>${delta(quote.month)}</td>
  </tr>`).join("");
  const periods=(["1m","3m","1y"] as const).map(period=>`<a class="button button--${period===selection.period?"primary":"secondary"}" href="${e(href(selection.ids,period))}"${period===selection.period?' aria-current="true"':""}>${period==="1m"?"1 месяц":period==="3m"?"3 месяца":"Год"}</a>`).join("");
  const updated=new Intl.DateTimeFormat("ru-RU",{timeZone:timezone,day:"numeric",month:"long",hour:"2-digit",minute:"2-digit"}).format(new Date(snapshot.capturedAt));
  const content=`<section class="hero stocks-hero"><div><p class="hero__eyebrow">Твой список наблюдения</p><h1>Мои акции</h1>
    <p class="hero__subtitle">${quotes.length} акций и ETF · цены закрытия · без торгового шума</p></div></section>
    <div class="stocks-status"><span>Получено: ${e(updated)}</span><span>Источник: <a href="https://eodhd.com/" target="_blank" rel="noopener noreferrer">EODHD</a> · обновление раз в сутки</span></div>
    ${ready<quotes.length?`<aside class="stocks-notice">Свежие данные доступны для ${ready} из ${quotes.length} бумаг. Последние сохранённые цены не заменены нулями; их даты и состояние указаны в таблице.</aside>`:""}
    <section class="stocks-watchlist" aria-labelledby="stocks-list-heading" data-stock-picker data-stock-period="${selection.period}">
      <header class="stocks-section-heading"><h2 id="stocks-list-heading">В твоём списке</h2><span>Выбери до пяти для сравнения</span></header>
      <div class="stocks-table-scroll" role="region" tabindex="0" aria-label="Котировки выбранных акций"><table class="stocks-table"><thead><tr><th><span class="sr-only">Сравнение</span></th><th>Акция / ETF</th><th>Цена закрытия</th><th>За день*</th><th>За 7 дней*</th><th>За 30 дней*</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="stocks-compare-actions"><span data-stock-selection-status aria-live="polite">Выбрано ${selection.ids.length} из 5</span>
      ${renderButton({label:"Сравнить выбранные",variant:"secondary",disabled:selection.ids.length<2,attributes:{"data-stock-compare":true}})}</div>
      <noscript><p>График одной бумаги открывается по её тикеру. Для сравнения нескольких нужен JavaScript.</p></noscript>
    </section>
    <section id="stocks-chart" class="stocks-chart-section" aria-label="История котировок"><div class="stocks-periods" aria-label="Период графика">${periods}</div>
      ${renderTrendChart(chart)}
      <p class="stocks-footnote">* Проценты и график рассчитаны по adjusted close — с учётом сплитов и дивидендов. Цена в таблице — обычное закрытие. Недельное и месячное изменение сравнивает с последней доступной сессией не позднее 7 и 30 календарных дней назад. Пропуски — не нули.</p>
      <p class="stocks-footnote">Котировки ориентировочные и могут отличаться от Revolut. VUAA показан по листингу Xetra в EUR. Это не стоимость твоих позиций и не рекомендация покупать или продавать.</p>
    </section>`;
  return renderPageShell({title:"Мои акции",brand:"Kurami Stocks",section:"stocks",date,dateLabel:"Цены закрытия · "+ready+"/"+quotes.length+" актуальных",generated:updated,timezone,content});
}

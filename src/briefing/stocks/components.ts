import {escapeHtml as e} from "../ui/html.ts";
import {renderTrendChart} from "../ui/charts/index.ts";
import {renderSparkline} from "../ui/charts/sparkline.ts";
import {stockQuote,dayShift,type StocksSnapshot} from "./model.ts";
import {stockSelection,stocksChart,type StockPeriod} from "./view.ts";
import {delta,money,shortDate} from "./format.ts";

export const stockHref=(id:string,period:StockPeriod)=>"/stocks?"+new URLSearchParams({symbols:id,period})+"#stock-"+id;
export function renderStockDetails(snapshot:StocksSnapshot,params:URLSearchParams,at=new Date().toISOString()):string {
  const selection=stockSelection(snapshot,params);
  if(selection.ids.length!==1)throw new Error("Invalid stock details selection");
  const id=selection.ids[0]!,series=snapshot.data.series.find(s=>s.asset.id===id)!;
  const quote=stockQuote(series,at),chart=stocksChart(snapshot,selection);
  chart.id="stock-chart-"+id;
  const values=chart.series[0]?.values.filter((v):v is number=>v!==null)??[];
  const change=values.length>1?(values.at(-1)!/values[0]!-1)*100:null;
  const last=series.points.at(-1),yearBase=last?series.points.findLast(p=>p.date<=dayShift(last.date,-365)):undefined;
  const year=last&&yearBase?(last.adjusted/yearBase.adjusted-1)*100:null;
  const periods=(["1m","3m","1y"] as const).map(period=>`<a class="button button--${period===selection.period?"primary":"secondary"}" data-stock-period="${period}" href="${e(stockHref(id,period))}"${period===selection.period?' aria-current="true"':""}>${period==="1m"?"Месяц":period==="3m"?"3 месяца":"Год"}</a>`).join("");
  return `<div data-stock-detail-content data-period="${selection.period}">
    <div class="stock-details__toolbar"><nav class="stocks-periods" aria-label="Период графика ${e(id)}">${periods}</nav><div class="stock-period-change"><span>За показанный период</span>${delta(change)}</div></div>
    ${renderTrendChart(chart)}
    <dl class="stock-stats"><div><dt>За 7 дней</dt><dd>${delta(quote.week)}</dd></div><div><dt>За 30 дней</dt><dd>${delta(quote.month)}</dd></div><div><dt>За год</dt><dd>${delta(year)}</dd></div><div><dt>Котировка</dt><dd>${e(shortDate(quote.date))} · ${e(series.asset.currency)}</dd></div></dl>
    <div class="stock-details__footer"><p>${e(series.asset.exchange)} · EODHD · ${quote.state==="ready"?"закрытие сессии":quote.state==="stale"?"сохранённые данные устарели":"данные недоступны"}. График и проценты учитывают сплиты и дивиденды; цена в строке — обычное закрытие. Неполная история не выдаётся за годовую доходность.</p><a href="https://finance.yahoo.com/quote/${encodeURIComponent(series.asset.id+(series.asset.exchange==="XETRA"?".DE":""))}/" target="_blank" rel="noopener noreferrer">Подробнее о компании / ETF ↗</a></div>
  </div>`;
}

export function renderStockRow(snapshot:StocksSnapshot,id:string,period:StockPeriod,open:boolean,at:string,index:number):string {
  const series=snapshot.data.series.find(s=>s.asset.id===id)!,quote=stockQuote(series,at);
  const last=series.points.at(-1),points=last?series.points.filter(p=>p.date>=dayShift(last.date,-30)):[];
  const status=quote.state==="ready"?"":quote.state==="stale"?"Устарело":"Нет данных";
  return `<details class="stock-row" id="stock-${e(id)}" name="stocks-watchlist" data-stock-row="${e(id)}" data-stock-index="${index}" data-stock-move="${quote.state==="ready"&&quote.day!==null?Math.abs(quote.day):-1}"${open?" open":""}>
    <summary class="stock-row__summary"><span class="stock-row__identity"><strong>${e(series.asset.name)}</strong><small>${e(id)} · ${e(series.asset.currency)}${series.asset.kind==="etf"?" · ETF":""}</small></span>
      <span class="stock-row__trend">${renderSparkline(points.map(p=>p.adjusted),id+": скорректированные закрытия за месяц; собственный масштаб")}<small>За месяц</small></span>
      <span class="stock-row__quote"><strong>${e(money(quote))}</strong><small>${e(shortDate(quote.date))}${status?` · <span class="stocks-warning">${status}</span>`:""}</small></span>
      <span class="stock-row__change">${delta(quote.day)}<small>за сессию</small></span><span class="stock-row__chevron" aria-hidden="true">⌄</span>
    </summary>
    <div class="stock-details" data-stock-details data-stock-loaded="${open?period:""}">
      ${open?renderStockDetails(snapshot,new URLSearchParams({symbols:id,period}),at):`<p>График появится при раскрытии. <a href="${e(stockHref(id,period))}">Открыть график ${e(id)} →</a></p>`}
    </div><p class="stock-load-status" data-stock-load-status role="status" aria-live="polite"></p>
  </details>`;
}

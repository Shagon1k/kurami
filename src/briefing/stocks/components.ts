import {escapeHtml as e} from "../ui/html.ts";
import {renderTrendChart} from "../ui/charts/index.ts";
import {renderSparkline} from "../ui/charts/sparkline.ts";
import {stockQuote,dayShift,type StocksSnapshot} from "./model.ts";
import {stockSelection,stocksChart,type StockPeriod} from "./view.ts";
import {delta,money,shortDate} from "./format.ts";
import {renderCompanyAvatar} from "../ui/components/company-avatar.ts";
import type {CompanyLogoDomains} from "./logo-registry.ts";
import {digestText as t} from "../i18n.ts";
import {renderLinkButton} from "../../ui-library/components/button.ts";
import {FIGURE_ATTRIBUTE} from "../../ui-library/components/surface.ts";

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
  const periods=(["1m","3m","1y"] as const).map(period=>renderLinkButton({label:period==="1m"?t("Месяц","Month"):period==="3m"?t("3 месяца","3 months"):t("Год","Year"),variant:"toggle",href:stockHref(id,period),attributes:{"data-stock-period":period,"aria-current":period===selection.period?"true":undefined}})).join("");
  return `<div data-stock-detail-content data-period="${selection.period}">
    <div class="stock-details__toolbar"><nav class="stocks-periods" aria-label="${t("Период графика","Chart period")} ${e(id)}">${periods}</nav><div class="stock-period-change"><span>${t("За показанный период","Shown period")}</span>${delta(change).replace(/^<span/,`<span${FIGURE_ATTRIBUTE}`)}</div></div>
    ${renderTrendChart(chart)}
    <dl class="stock-stats"><div><dt>${t("За 7 дней","7 days")}</dt><dd>${delta(quote.week)}</dd></div><div><dt>${t("За 30 дней","30 days")}</dt><dd>${delta(quote.month)}</dd></div><div><dt>${t("За год","Year")}</dt><dd>${delta(year)}</dd></div><div><dt>${t("Котировка","Quote")}</dt><dd>${e(shortDate(quote.date))} · ${e(series.asset.currency)}</dd></div></dl>
    <div class="stock-details__footer"><p>${e(series.asset.exchange)} · EODHD · ${quote.state==="ready"?t("закрытие сессии","session close"):quote.state==="stale"?t("сохранённые данные устарели","saved data is stale"):t("данные недоступны","data unavailable")}. ${t("График и проценты учитывают сплиты и дивиденды; цена в строке — обычное закрытие. Неполная история не выдаётся за годовую доходность.","The chart and percentage changes account for splits and dividends; the row price is the ordinary close. Incomplete history is not presented as an annual return.")}</p><a href="https://finance.yahoo.com/quote/${encodeURIComponent(series.asset.id+(series.asset.exchange==="XETRA"?".DE":""))}/" target="_blank" rel="noopener noreferrer">${t("Подробнее о компании / ETF","Company / ETF details")} ↗</a></div>
  </div>`;
}

export function renderStockRow(snapshot:StocksSnapshot,id:string,period:StockPeriod,open:boolean,at:string,index:number,logos?:CompanyLogoDomains):string {
  const series=snapshot.data.series.find(s=>s.asset.id===id)!,quote=stockQuote(series,at);
  const last=series.points.at(-1),points=last?series.points.filter(p=>p.date>=dayShift(last.date,-30)):[];
  const status=quote.state==="ready"?"":quote.state==="stale"?t("Устарело","Stale"):t("Нет данных","No data");
  return `<details class="stock-row" id="stock-${e(id)}" name="stocks-watchlist" data-stock-row="${e(id)}" data-stock-index="${index}" data-stock-move="${quote.state==="ready"&&quote.day!==null?Math.abs(quote.day):-1}"${open?" open":""}>
    <summary class="stock-row__summary"><span class="stock-row__identity">${renderCompanyAvatar(id,logos?.get(id+":"+series.asset.isin))}<span><strong>${e(series.asset.name)}</strong><small>${e(id)} · ${e(series.asset.currency)}${series.asset.kind==="etf"?" · ETF":""}</small></span></span>
      <span class="stock-row__trend">${renderSparkline(points.map(p=>p.adjusted),id+t(": скорректированные закрытия за месяц; собственный масштаб",": adjusted closes over one month; independent scale"))}<small>${t("За месяц","One month")}</small></span>
      <span class="stock-row__quote"><strong>${e(money(quote))}</strong><small>${e(shortDate(quote.date))}${status?` · <span class="stocks-warning">${status}</span>`:""}</small></span>
      <span class="stock-row__change">${delta(quote.day)}<small>${t("за сессию","session")}</small></span><span class="stock-row__chevron" aria-hidden="true">${renderIcon("chevronDown")}</span>
    </summary>
    <div class="stock-details" data-stock-details data-stock-loaded="${open?period:""}">
      ${open?renderStockDetails(snapshot,new URLSearchParams({symbols:id,period}),at):`<p>${t("График появится при раскрытии.","The chart loads when expanded.")} <a href="${e(stockHref(id,period))}">${t("Открыть график","Open chart")} ${e(id)} →</a></p>`}
    </div><p class="stock-load-status" data-stock-load-status role="status" aria-live="polite"></p>
  </details>`;
}
import {renderIcon} from "../../ui-library/components/icon.ts";

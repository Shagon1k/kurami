import {escapeHtml} from "../ui/html.ts";
import type {StockQuote} from "./model.ts";
export const shortDate=(date:string|null)=>date?new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z")):"нет даты";
export function formatStockPercent(value:number|null):string {
  if(value===null||!Number.isFinite(value))return "—";
  const rounded=Math.round(value*100)/100;
  return (rounded>0?"+":"")+new Intl.NumberFormat("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Object.is(rounded,-0)?0:rounded)+"%";
}
export const delta=(value:number|null)=>`<span class="stock-change ${value===null?"":value>0?"is-up":value<0?"is-down":""}">${escapeHtml(formatStockPercent(value))}</span>`;
export const money=(quote:StockQuote)=>quote.price===null?"—":new Intl.NumberFormat("ru-RU",{style:"currency",currency:quote.asset.currency,minimumFractionDigits:2,maximumFractionDigits:2}).format(quote.price);

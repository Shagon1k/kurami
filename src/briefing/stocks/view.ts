import type {ChartInput} from "../ui/charts/model.ts";
import {dayShift,type StocksSnapshot,type StockSeries,type StockPoint} from "./model.ts";
import {digestLanguage,digestText as t} from "../i18n.ts";
export type StockPeriod="1m"|"3m"|"1y";
export function stockSelection(snapshot:StocksSnapshot,params:URLSearchParams):{ids:string[];period:StockPeriod} {
  const allowed=new Set(snapshot.data.policy.assets.map(a=>a.id));
  const requested=(params.get("symbols")??snapshot.data.policy.benchmark).split(",");
  if(requested.length>5||new Set(requested).size!==requested.length||requested.some(id=>!allowed.has(id)))throw new Error("Invalid stock selection; choose one to five configured symbols");
  const period=params.get("period")??"1m";
  if(!["1m","3m","1y"].includes(period))throw new Error("Invalid stock period");
  return {ids:requested,period:period as StockPeriod};
}
function week(date:string):string {
  const weekday=new Date(date+"T12:00:00Z").getUTCDay();
  return dayShift(date,-((weekday+6)%7));
}
const label=(date:string)=>new Intl.DateTimeFormat(digestLanguage()==="en"?"en-GB":"ru-RU",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));

export function stocksChart(snapshot:StocksSnapshot,selection:{ids:string[];period:StockPeriod}):ChartInput {
  const chosen=selection.ids.map(id=>snapshot.data.series.find(s=>s.asset.id===id)!);
  const compare=chosen.length>1;
  const end=chosen.map(s=>s.points.at(-1)?.date??"").sort().at(-1)!;
  const base:ChartInput={id:"stocks-trend",title:compare?t("Сравнение динамики","Performance comparison"):chosen[0]!.asset.name,
    xLabel:t("Торговая дата","Trading date"),yLabel:compare?t("Изменение, %","Change, %"):t("Скорректированная цена","Adjusted price"),unit:compare?{kind:"percent"}:{kind:"currency",currency:chosen[0]!.asset.currency},
    baseline:compare?"zero":"auto",categories:[],series:[]};
  if(!end || chosen.some(s=>!s.points.length))return {...base,state:"unavailable",message:t("Для выбранных акций пока недостаточно данных.","Not enough data for the selected stocks yet.")};
  const from=dayShift(end,selection.period==="1m"?-30:selection.period==="3m"?-90:-365);
  let values=chosen.map(s=>s.points.filter(p=>p.date>=from));
  let first=values[0]!.find(p=>values.every(points=>points.some(candidate=>candidate.date===p.date)))?.date;
  if(!first)return {...base,state:"unavailable",message:t("В выбранном периоде нет общей начальной даты.","No shared start date in the selected period.")};
  values=values.map(points=>points.filter(p=>p.date>=first!));
  const starts=values.map(points=>points.find(p=>p.date===first)!.adjusted);
  let dates=[...new Set(values.flatMap(points=>points.map(p=>p.date)))].sort();
  if(selection.period==="1y") {
    // Actual last observation per calendar week, never an invented average.
    const byWeek=new Map<string,string>();
    for(const date of dates)byWeek.set(week(date),date);
    dates=[first,...new Set(byWeek.values())].filter((date,index,array)=>array.indexOf(date)===index).sort();
  }
  if(dates.length>120)throw new Error("Stock chart exceeds category limit");
  return {...base,description:(compare?t("Общая база: ","Shared baseline: ")+label(first)+t(". Значения в исходной валюте каждого вложения; без пересчёта валют. ",". Values use each asset's original currency; no FX conversion. "):"")
      +(selection.period==="1y"?t("Недельные закрытия. ","Weekly closes. "):t("Дневные закрытия. ","Daily closes. "))+t("Учтены сплиты и дивиденды.","Splits and dividends are included."),
    categories:dates.map(date=>({key:date,label:date,shortLabel:label(date),
      ...(selection.period==="1y"&&dayShift(week(date),4)>=snapshot.capturedAt.slice(0,10)?{partial:true}:{})})),
    series:chosen.map((series,index)=>{
      const byDate=new Map(values[index]!.map(point=>[point.date,point]));
      return {id:series.asset.id,label:series.asset.id,values:dates.map(date=>{
        const point=byDate.get(date);return point?compare?(point.adjusted/starts[index]!-1)*100:point.adjusted:null;
      })};
    })};
}

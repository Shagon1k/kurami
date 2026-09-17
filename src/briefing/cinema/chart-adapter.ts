import type { CinemaTrendSeries } from "./model.ts";
import type { ChartInput } from "../ui/charts/model.ts";

/** Cinema owns interpretation and currency; charts own geometry and interaction. */
export function cinemaTrendInput(series: CinemaTrendSeries[]): ChartInput {
  const dates=[...new Set(series.flatMap(item=>item.points.map(point=>point.at)))].sort();
  const currencies=new Set(series.map(item=>item.currency));
  const currency=series[0]?.currency ?? "USD";
  const base:ChartInput={id:"cinema-box-office-trend",title:"Динамика текущего топа",
    description:dates.length+" уикендов",xLabel:"Уикенд",yLabel:"Сборы за уикенд",
    unit:/^[A-Z]{3}$/.test(currency)?{kind:"currency",currency}:{kind:"number"},categories:[],series:[]};
  if(currencies.size>1)return {...base,state:"unavailable",message:"Серии разных валют нельзя сравнить на одной шкале."};
  if(!/^[A-Z]{3}$/.test(currency))return {...base,state:"unavailable",message:"Валюта данных не подтверждена."};
  return {...base,categories:dates.map(date=>({key:date,label:date,shortLabel:series.flatMap(item=>item.points).find(point=>point.at===date)!.label})),
    series:series.map(item=>{
      const values=new Map(item.points.map(point=>[point.at,point.gross]));
      return {id:item.id,label:item.label,values:dates.map(date=>values.get(date) ?? null)};
    })};
}

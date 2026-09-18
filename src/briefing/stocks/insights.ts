import {dayShift,stockQuote,type StocksSnapshot} from "./model.ts";
export type StockInsight={id:string;symbol:string;kind:"day"|"week"|"high";value:number;date:string};
/** Facts only, from fresh cached adjusted closes. No inferred news or buy signals. */
export function stockInsights(snapshot:StocksSnapshot,at:string):StockInsight[] {
  const ready=snapshot.data.series.filter(s=>stockQuote(s,at).state==="ready");
  const result:StockInsight[]=[],used=new Set<string>();
  const add=(item:StockInsight|undefined)=>{if(item){result.push(item);used.add(item.symbol);}};
  const daily=ready.map(s=>stockQuote(s,at)).filter(q=>q.day!==null&&Math.abs(q.day)>=snapshot.data.policy.moveThresholdPercent)
    .sort((a,b)=>Math.abs(b.day!)-Math.abs(a.day!)||a.asset.id.localeCompare(b.asset.id))[0];
  if(daily)add({id:"day:"+daily.asset.id,symbol:daily.asset.id,kind:"day",value:daily.day!,date:daily.date!});
  const weekly=ready.map(s=>stockQuote(s,at)).filter(q=>!used.has(q.asset.id)&&q.week!==null&&Math.abs(q.week)>=5&&Math.abs(q.week)>Math.abs(q.day??0))
    .sort((a,b)=>Math.abs(b.week!)-Math.abs(a.week!)||a.asset.id.localeCompare(b.asset.id))[0];
  if(weekly)add({id:"week:"+weekly.asset.id,symbol:weekly.asset.id,kind:"week",value:weekly.week!,date:weekly.date!});
  for(const s of ready){
    if(used.has(s.asset.id)||result.length>=3)continue;
    const last=s.points.at(-1)!,from=dayShift(last.date,-90);
    if(!s.points.some(p=>p.date<=from))continue;
    const prior=s.points.filter(p=>p.date>=from&&p.date<last.date);
    if(prior.length>=40&&prior.every(p=>p.adjusted<last.adjusted))
      add({id:"high:"+s.asset.id,symbol:s.asset.id,kind:"high",value:last.adjusted,date:last.date});
  }
  return result;
}

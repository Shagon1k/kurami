import {localDay,type LimitObservation} from "../core/codex-usage.ts";
export type LimitDay={date:string;windows:Partial<Record<string,number>>};
export function dailyLimitHistory(observations:Iterable<LimitObservation>,now:Date):LimitDay[] {
  const today=new Date(localDay(now.getTime())+"T12:00:00Z");
  const days=Array.from({length:30},(_,index)=>{const date=new Date(today);date.setUTCDate(date.getUTCDate()-29+index);return {date:date.toISOString().slice(0,10),windows:{}} as LimitDay;});
  const byDay=new Map(days.map(day=>[day.date,day]));
  for(const sample of observations){
    if(sample.at>now.getTime())continue;
    const day=byDay.get(sample.date);if(!day)continue;
    const key=String(sample.windowMinutes);
    day.windows[key]=Math.max(day.windows[key]??0,sample.usedPercent);
  }
  return days;
}

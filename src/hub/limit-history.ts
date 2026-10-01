import {localDay,type LimitObservation} from "../core/codex-usage.ts";
export type LimitDay={date:string;windows:Partial<Record<string,number>>};
export type LimitUsageDay=LimitDay&{partial:Partial<Record<string,boolean>>};
export function dailyLimitUsage(observations:Iterable<LimitObservation>,now:Date):LimitUsageDay[] {
  const days=dailyLimitHistory([],now).map(day=>({...day,partial:{}} as LimitUsageDay));
  const byDay=new Map(days.map(day=>[day.date,day]));
  const samples=[...observations].filter(sample=>sample.at<=now.getTime()&&sample.usedPercent>=0&&sample.usedPercent<=100&&sample.windowMinutes>0).sort((a,b)=>a.at-b.at||a.usedPercent-b.usedPercent);
  const previous=new Map<number,LimitObservation>();
  const high=new Map<number,number>();
  const seen=new Set<string>();
  for(const sample of samples){
    const key=String(sample.windowMinutes),identity=`${sample.at}:${key}:${sample.resetsAt}:${sample.usedPercent}`;
    if(seen.has(identity))continue;seen.add(identity);
    const day=byDay.get(sample.date),prior=previous.get(sample.windowMinutes);
    if(day&&day.windows[key]===undefined)day.windows[key]=0;
    if(!prior){if(day)day.partial[key]=true;high.set(sample.windowMinutes,sample.usedPercent);previous.set(sample.windowMinutes,sample);continue;}
    const changed=sample.resetsAt!==undefined&&prior.resetsAt!==undefined&&sample.resetsAt!==prior.resetsAt;
    if(changed&&sample.resetsAt!<prior.resetsAt!){if(day)day.partial[key]=true;continue;}
    const peak=high.get(sample.windowMinutes)!;
    const delta=changed?sample.usedPercent:Math.max(0,sample.usedPercent-peak);
    if(day){
      day.windows[key]=Math.round(((day.windows[key]??0)+delta)*10)/10;
      if(sample.date!==prior.date||sample.at-prior.at>6*3600_000||(!changed&&sample.usedPercent<peak)||changed)day.partial[key]=true;
    }
    high.set(sample.windowMinutes,changed?sample.usedPercent:Math.max(peak,sample.usedPercent));
    previous.set(sample.windowMinutes,sample);
  }
  return days;
}
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

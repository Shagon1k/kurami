import type {DatabaseSync} from "node:sqlite";
import {zonedDayBounds} from "../providers/composio-calendar.ts";
import {shiftDate,type DailyObservation,type WeeklyReview} from "./model.ts";

function reactions(database:DatabaseSync,start:string,end:string,timezone:string) {
  const from=zonedDayBounds(start,timezone).timeMin,until=zonedDayBounds(shiftDate(end,1),timezone).timeMin;
  const rows=database.prepare(`SELECT reaction,topic_ids_json FROM (
    SELECT reaction,topic_ids_json,ROW_NUMBER() OVER(PARTITION BY story_fingerprint ORDER BY event_id DESC) AS position
    FROM reaction_events WHERE recorded_at>=? AND recorded_at<?) WHERE position=1`).all(from,until) as Array<{reaction:string;topic_ids_json:string}>;
  const topics=new Map<string,{more:number;less:number}>();
  let more=0,less=0;
  for(const row of rows) {
    if(row.reaction!=="like"&&row.reaction!=="dislike")continue;
    if(row.reaction==="like")more++;else less++;
    for(const id of new Set(JSON.parse(row.topic_ids_json) as string[])){
      const value=topics.get(id)??{more:0,less:0};
      if(row.reaction==="like")value.more++;else value.less++;topics.set(id,value);
    }
  }
  return {more,less,topics};
}

export function buildWeeklyReview(database:DatabaseSync,publicationDate:string,timezone:string,at=new Date().toISOString()):WeeklyReview {
  const start=shiftDate(publicationDate,-7),end=shiftDate(publicationDate,-1);
  const observations=database.prepare("SELECT payload_json FROM weekly_daily_observations WHERE local_date>=? AND local_date<? AND timezone=? ORDER BY local_date")
    .all(shiftDate(start,-7),publicationDate,timezone) as Array<{payload_json:string}>;
  const byDate=new Map(observations.map(row=>{const value=JSON.parse(row.payload_json) as DailyObservation;return [value.date,value] as const;}));
  const days=Array.from({length:7},(_,index)=>byDate.get(shiftDate(start,index))??{
    date:shiftDate(start,index),timezone,observedAt:at,stories:null,calendar:null,inbox:null});
  const coverage={news:days.filter(day=>day.stories!==null).length,calendar:days.filter(day=>day.calendar!==null).length,mail:days.filter(day=>day.inbox!==null).length};
  const sum=(items:Array<number|null>)=>items.every(value=>value===null)?null:items.reduce<number>((total,value)=>total+(value??0),0);
  const calendarMinutes=sum(days.map(day=>day.calendar?.busyMinutes??null));
  const previous=Array.from({length:7},(_,index)=>byDate.get(shiftDate(start,index-7)));
  const previousMinutes=previous.every(day=>day?.calendar!==null&&day?.calendar!==undefined)?previous.reduce((total,day)=>total+day!.calendar!.busyMinutes,0):null;
  const currentReactions=reactions(database,start,end,timezone),priorReactions=reactions(database,shiftDate(start,-7),shiftDate(start,-1),timezone);
  const labels=new Map((database.prepare("SELECT id,label FROM topic_registry").all() as Array<{id:string;label:string}>).map(row=>[row.id,row.label]));
  const topics=[...currentReactions.topics].map(([id,value])=>({id,label:labels.get(id)??id,...value,net:value.more-value.less,
    previousNet:(priorReactions.topics.get(id)?.more??0)-(priorReactions.topics.get(id)?.less??0)}))
    .sort((a,b)=>(b.more+b.less)-(a.more+a.less)||a.id.localeCompare(b.id)).slice(0,8);
  const archived=Number((database.prepare("SELECT COALESCE(SUM(item_count),0) AS count FROM weekly_mail_actions WHERE local_date>=? AND local_date<=?").get(start,end) as {count:number}).count);
  const totals={stories:sum(days.map(day=>day.stories)),calendarMinutes,calendarEvents:sum(days.map(day=>day.calendar?.events??null)),archived,more:currentReactions.more,less:currentReactions.less};
  const insights:string[]=[];
  const busiest=days.filter(day=>day.calendar).sort((a,b)=>b.calendar!.busyMinutes-a.calendar!.busyMinutes||a.date.localeCompare(b.date))[0];
  const label=(date:string)=>new Intl.DateTimeFormat("ru-RU",{day:"numeric",month:"long",timeZone:"UTC"}).format(new Date(date+"T12:00:00Z"));
  if(busiest?.calendar?.busyMinutes)insights.push(`Самый плотный из наблюдавшихся дней — ${label(busiest.date)}: ${busiest.calendar.busyMinutes} минут занято в календаре. Это план, не измерение фактической работы.`);
  const overlap=days.reduce((total,day)=>total+(day.calendar?.overlapMinutes??0),0);
  if(overlap)insights.push(`В календарях было ${overlap} минут пересечений. Каждая пересекающаяся минута учтена один раз.`);
  const inbox=days.filter(day=>day.inbox);
  if(inbox.length>=2) {
    const first=inbox[0]!,last=inbox.at(-1)!,delta=last.inbox!.last-first.inbox!.first;
    insights.push(`Непрочитанных Primary: ${first.inbox!.first} → ${last.inbox!.last} между наблюдениями ${label(first.date)} и ${label(last.date)} (${delta>0?"+":""}${delta}). Это изменение остатка, не число обработанных писем.`);
  }
  if(currentReactions.more+currentReactions.less<3)insights.push("Реакций пока мало для выводов об изменении интересов; показываю только зафиксированные сигналы.");
  else if(topics[0])insights.push(`Чаще всего в сюжетах с реакцией встречалась тема ${topics[0].label}: 🔔 ${topics[0].more}, 🔕 ${topics[0].less}. Один сюжет может иметь несколько тем.`);
  return {version:1,state:Math.max(...Object.values(coverage))===0?"empty":Object.values(coverage).every(count=>count===7)?"ready":"partial",capturedAt:at,
    data:{publicationDate,start,end,timezone,days,coverage,totals,calendarDeltaMinutes:coverage.calendar===7&&previousMinutes!==null&&calendarMinutes!==null?calendarMinutes-previousMinutes:null,topics,insights:insights.slice(0,3)}};
}

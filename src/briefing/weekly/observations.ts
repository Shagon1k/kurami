import type {DatabaseSync} from "node:sqlite";
import type {BriefingPayload} from "../model.ts";
import {section} from "../addons/envelopes.ts";
import {zonedDayBounds} from "../providers/composio-calendar.ts";
import {localDate,shiftDate,type DailyObservation} from "./model.ts";

export function calendarObservation(payload:BriefingPayload):DailyObservation["calendar"] {
  const calendar=section(payload,"calendar");
  if(!payload.addons.calendar || !["ready","empty"].includes(calendar.state))return null;
  const bounds=zonedDayBounds(payload.edition.localDate,payload.edition.timezone),start=Date.parse(bounds.timeMin),end=Date.parse(bounds.timeMax);
  const seen=new Set<string>(),intervals:Array<[number,number]>=[];
  for(const value of calendar.events as Array<Record<string,unknown>>??[]) {
    if(value.demo || value.allDay || value.status==="cancelled" || value.responseStatus==="declined")continue;
    const a=Math.max(start,Date.parse(String(value.start))),b=Math.min(end,Date.parse(String(value.end)));
    const key=String(value.id??a+":"+b);
    if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||seen.has(key))continue;
    seen.add(key);intervals.push([a,b]);
  }
  // Sweep intervals: count occupied and overlapping minutes once, not once per pair.
  const ticks=new Map<number,number>();
  for(const [a,b] of intervals){ticks.set(a,(ticks.get(a)??0)+1);ticks.set(b,(ticks.get(b)??0)-1);}
  let active=0,previous=start,busy=0,overlap=0;
  for(const [at,delta] of [...ticks].sort((a,b)=>a[0]-b[0])){
    if(active>0)busy+=at-previous;if(active>1)overlap+=at-previous;
    active+=delta;previous=at;
  }
  return {events:intervals.length,allDay:(calendar.allDayEvents as Array<Record<string,unknown>>??[]).filter(e=>!e.demo&&e.status!=="cancelled"&&e.responseStatus!=="declined").length,
    busyMinutes:Math.round(busy/60_000),overlapMinutes:Math.round(overlap/60_000)};
}

export function observeDaily(database:DatabaseSync,payload:BriefingPayload,at=new Date().toISOString()):void {
  if(payload.edition.type!=="daily" || !payload.addons.weekly)return;
  const date=payload.edition.localDate,timezone=payload.edition.timezone;
  const prior=database.prepare("SELECT payload_json FROM weekly_daily_observations WHERE local_date=?").get(date) as {payload_json:string}|undefined;
  const old:DailyObservation|undefined=prior?JSON.parse(prior.payload_json):undefined;
  const row:DailyObservation={date,timezone,observedAt:at,
    stories:payload.addons.news&&["ready","empty","partial"].includes(section(payload,"news").state)?section(payload,"news").items.length:old?.stories??null,
    calendar:localDate(at,timezone)===date?calendarObservation(payload)??old?.calendar??null
      :old?.calendar??calendarObservation(payload),inbox:old?.inbox??null};
  const mail=section(payload,"mail"),fetchedAt=String(mail.fetchedAt??"");
  if(payload.addons.mail && ["ready","empty"].includes(mail.state) && Number.isFinite(Date.parse(fetchedAt))
    && localDate(fetchedAt,timezone)===date && Date.parse(fetchedAt)<=Date.parse(at)) {
    const count=typeof mail.count==="number"?mail.count:mail.items.length;
    if(!row.inbox)row.inbox={first:count,last:count,firstAt:fetchedAt,lastAt:fetchedAt};
    else if(fetchedAt>row.inbox.lastAt){row.inbox.last=count;row.inbox.lastAt=fetchedAt;}
  }
  database.prepare(`INSERT INTO weekly_daily_observations(local_date,timezone,payload_json,updated_at) VALUES(?,?,?,?)
    ON CONFLICT(local_date) DO UPDATE SET timezone=excluded.timezone,payload_json=excluded.payload_json,updated_at=excluded.updated_at`)
    .run(date,timezone,JSON.stringify(row),at);
}

export function pruneWeeklyObservations(database:DatabaseSync,at:string,timezone:string,days:number):void {
  // Keep completed days plus today's still-open bucket.
  const first=shiftDate(localDate(at,timezone),-days);
  database.prepare("DELETE FROM weekly_daily_observations WHERE local_date < ?").run(first);
  database.prepare("DELETE FROM weekly_mail_actions WHERE local_date < ?").run(first);
}

import { briefingAddonEnabled, type BriefingPayload } from "../../model.ts";
import { section } from "../envelopes.ts";
import { zonedDayBounds } from "../../providers/composio-calendar.ts";
import type { SignalsConfig } from "./config.ts";
import { nextLocalDate } from "../../dates.ts";
import type { SignalItem, SignalsEnvelope } from "./model.ts";

type RecordValue = Record<string, unknown>;
const records = (value: unknown): RecordValue[] => Array.isArray(value)
  ? value.filter((v): v is RecordValue => Boolean(v) && typeof v === "object" && !Array.isArray(v)) : [];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const timestamp = (value: unknown): number => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/u.test(value) ? Date.parse(value) : NaN;
const numberText = (value: number) => value.toLocaleString("ru-RU",{maximumFractionDigits:1});
const duration = (minutes: number) => minutes < 60 ? `${Math.round(minutes)} мин`
  : `${Math.floor(minutes/60)} ч${minutes%60 ? " " + Math.round(minutes%60) + " мин" : ""}`;
function localDate(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(at);
}
function clock(at: number, timezone: string): string {
  return new Intl.DateTimeFormat("ru-RU",{timeZone:timezone,hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(at);
}
type Event = { start: number; end: number; id: string };
function timedEvents(value: unknown): Event[] {
  const seen = new Set<string>();
  return records(value).flatMap(item => {
    const start = timestamp(item.start), end = timestamp(item.end);
    if (item.allDay || item.demo || item.status === "cancelled" || item.responseStatus === "declined"
      || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const id = String(item.id ?? `${start}:${end}`);
    if (seen.has(id)) return [];
    seen.add(id); return [{start,end,id}];
  }).sort((a,b)=>a.start-b.start || a.end-b.end || a.id.localeCompare(b.id));
}

export function deriveSignals(payload: BriefingPayload, config: SignalsConfig, evaluatedAt: string): SignalsEnvelope {
  const at = timestamp(evaluatedAt), date = payload.edition.localDate, timezone = payload.edition.timezone;
  if (!Number.isFinite(at)) throw new Error("Signals require an explicit UTC/offset timestamp");
  const endOfDay = Date.parse(zonedDayBounds(date,timezone).timeMax);
  const data: SignalsEnvelope["data"] = { policy: config, localDate: date, timezone, evaluatedAt,
    validUntil: new Date(Math.min(endOfDay,at+config.maxAgeMinutes*60_000)).toISOString(), items: [], unavailable: [] };
  if (config.error) return {version:1,state:"failed",capturedAt:evaluatedAt,data:{...data,unavailable:[config.error]}};
  if (!config.enabled || payload.edition.type !== "daily" || localDate(at,timezone)!==date) {
    return {version:1,state:"empty",capturedAt:evaluatedAt,data};
  }
  const candidates: SignalItem[] = [];
  const add = (item: SignalItem) => candidates.push(item);
  const fresh = (id: "calendar"|"mail"|"weather") => {
    if (!briefingAddonEnabled(payload,id)) return false;
    const value = section(payload,id), fetched = timestamp(value.fetchedAt);
    const valid = (value.state==="ready" || value.state==="empty") && Number.isFinite(fetched)
      && fetched<=at && at-fetched<=config.maxAgeMinutes*60_000;
    if (!valid) data.unavailable.push(id+"_stale_or_missing");
    else data.validUntil = new Date(Math.min(Date.parse(data.validUntil),fetched+config.maxAgeMinutes*60_000)).toISOString();
    return valid;
  };
  const rules = config.rules;
  if (Object.entries(rules).some(([id,enabled])=>enabled && ["overlap","denseDay","longMeeting","earlyTomorrow"].includes(id)) && fresh("calendar")) {
    const calendar = section(payload,"calendar");
    const events = timedEvents(calendar.events).filter(event=>event.end>at && event.start<endOfDay)
      .map(event=>({...event,end:Math.min(event.end,endOfDay)}));
    if (rules.overlap) {
      let overlaps=0, longest=0, expiresAt=endOfDay;
      for (let i=0;i<events.length;i++) for(let j=i+1;j<events.length && events[j]!.start<events[i]!.end;j++) {
        const minutes=(Math.min(events[i]!.end,events[j]!.end)-Math.max(at,events[i]!.start,events[j]!.start))/60_000;
        if(minutes>=config.overlapMinutes) {overlaps++;longest=Math.max(longest,minutes);expiresAt=Math.min(expiresAt,events[i]!.end,events[j]!.end);}
      }
      if(overlaps) add({id:"calendar-overlap",group:"calendar-today",priority:10,severity:"attention",
        title:"Встречи пересекаются",detail:`Пересечений: ${overlaps}. Самое длинное — ${duration(longest)}.`,href:"#calendar-heading",expiresAt:new Date(expiresAt).toISOString()});
    }
    if (rules.denseDay) {
      let occupied=0, until=0, chain=0, maxChain=0, chainEnd=0;
      for(const event of events) {
        const start=Math.max(at,event.start);
        occupied+=Math.max(0,event.end-Math.max(start,until));until=Math.max(until,event.end);
        chain=chain && start-chainEnd<config.gapMinutes*60_000 ? chain+1 : 1;
        chainEnd=Math.max(chainEnd,event.end);maxChain=Math.max(chain,maxChain);
      }
      if(occupied>=config.busyMinutes*60_000 || maxChain>=config.chainCount) add({
        id:"calendar-dense",group:"calendar-today",priority:30,severity:"attention",title:"Плотное расписание",
        detail:occupied>=config.busyMinutes*60_000 ? `До конца дня встречами занято ещё ${duration(occupied/60_000)}.`
          : `Цепочка из ${maxChain} встреч с перерывами менее ${config.gapMinutes} мин.`,href:"#calendar-heading",expiresAt:new Date(Math.min(...events.map(event=>event.end))).toISOString()});
    }
    if(rules.longMeeting) {
      const longest=events.filter(event=>(event.end-event.start)>=config.longMeetingMinutes*60_000)
        .sort((a,b)=>(b.end-b.start)-(a.end-a.start) || a.start-b.start)[0];
      if(longest) add({id:"calendar-long",group:"calendar-today",priority:31,severity:"info",title:"Длинная встреча",
        detail:`${clock(longest.start,timezone)}–${clock(longest.end,timezone)} · ${duration((longest.end-longest.start)/60_000)} в календаре.`,href:"#calendar-heading",expiresAt:new Date(longest.end).toISOString()});
    }
    if(rules.earlyTomorrow) {
      const tomorrow = calendar.tomorrow as {localDate?:string;state?:string;events?:unknown}|undefined;
      if(tomorrow?.localDate===nextLocalDate(date) && ["ready","empty"].includes(tomorrow.state??"")) {
        const first=timedEvents(tomorrow.events).filter(event=>localDate(event.start,timezone)===tomorrow.localDate)[0];
        if(first && Number(clock(first.start,timezone).split(":")[0])<config.earlyBeforeHour) add({
          id:"calendar-early",group:"calendar-tomorrow",priority:35,severity:"info",title:"Завтра ранний старт",
          detail:`Первая встреча завтра в ${clock(first.start,timezone)}.`});
      } else data.unavailable.push("calendar_tomorrow_missing");
    }
  }
  if ((rules.actionMail || rules.oldActionMail) && fresh("mail")) {
    const action=section(payload,"mail").items.filter(item=>item.class==="ACTION" && item.demo!==true);
    const old=action.filter(item=>Number.isFinite(timestamp(item.receivedAt)) && at-timestamp(item.receivedAt)>config.oldActionHours*3_600_000);
    if(rules.oldActionMail && old.length) {
      const age=Math.floor((at-Math.min(...old.map(item=>timestamp(item.receivedAt))))/3_600_000);
      add({id:"mail-old-action",group:"mail",priority:20,severity:"attention",title:"Письмо ждёт действия",
        detail:`Непрочитанных ACTION старше ${config.oldActionHours} ч: ${old.length}. Самому старому — ${age} ч.`,href:"#mail-heading"});
    } else if(rules.actionMail && action.length) add({id:"mail-action",group:"mail",priority:21,severity:"info",
      title:"Почта с действием",detail:`Писем с пометкой ACTION: ${action.length}.`,href:"#mail-heading"});
  }
  if ((rules.weather || rules.coolingTomorrow) && fresh("weather")) {
    const days=records(section(payload,"weather").dailyForecast);
    const today=days.find(day=>day.localDate===date), tomorrow=days.find(day=>day.localDate===nextLocalDate(date));
    if(rules.weather) {
      const parts:string[]=[];
      if(today) {
        if(finite(today.precipitationProbabilityPercent) && today.precipitationProbabilityPercent>=config.rainPercent) parts.push(`вероятность осадков до ${today.precipitationProbabilityPercent}%`);
        if(finite(today.minimumCelsius) && today.minimumCelsius<config.coldBelowC) parts.push(`минимум ${numberText(today.minimumCelsius)} °C`);
        if(finite(today.maximumCelsius) && today.maximumCelsius>=config.hotFromC) parts.push(`максимум ${numberText(today.maximumCelsius)} °C`);
        if(["minimumCelsius","maximumCelsius","precipitationProbabilityPercent"].some(key=>!finite(today[key]))) data.unavailable.push("weather_today_incomplete");
      } else data.unavailable.push("weather_today_missing");
      if(parts.length) add({id:"weather-today",group:"weather",priority:40,severity:"info",title:"Погода сегодня",detail:parts.join(" · ")+ "."});
    }
    if(rules.coolingTomorrow) {
      if(finite(today?.maximumCelsius) && finite(tomorrow?.maximumCelsius)) {
        const drop=today.maximumCelsius-tomorrow.maximumCelsius;
        if(drop>=config.coolingC) add({id:"weather-cooling",group:"weather",priority:41,severity:"info",title:"Завтра заметно холоднее",
          detail:`Максимум снизится с ${numberText(today.maximumCelsius)} до ${numberText(tomorrow.maximumCelsius)} °C — на ${numberText(drop)} °C.`});
      } else data.unavailable.push("weather_tomorrow_missing");
    }
  }
  const groups = new Set<string>();
  data.items=candidates.sort((a,b)=>a.priority-b.priority || a.id.localeCompare(b.id))
    .filter(item=>{if(groups.has(item.group))return false;groups.add(item.group);return true;}).slice(0,config.maxItems);
  return {version:1,state:data.unavailable.length?"partial":data.items.length?"ready":"empty",capturedAt:evaluatedAt,data};
}

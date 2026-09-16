import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { parseBriefingPayload } from "./payload-fixtures.ts";
import { section,setSection } from "../../src/briefing/addons/envelopes.ts";
import { deriveSignals } from "../../src/briefing/addons/signals/engine.ts";
import { parseSignalsConfig } from "../../src/briefing/addons/signals/config.ts";
import { parseSignalsEnvelope } from "../../src/briefing/addons/signals/model.ts";
import { refreshDerivedAddons } from "../../src/briefing/addons/derived.ts";
import { renderSignalStrip } from "../../src/briefing/ui/components/signal-strip.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
import { removeArchivedMail } from "../../src/briefing/addons/mail/lifecycle.ts";
import { calendarLifecycle } from "../../src/briefing/addons/calendar/lifecycle.ts";
import { normalizeOpenMeteo } from "../../src/briefing/providers/open-meteo.ts";
import { weatherValue } from "../../src/briefing/addons/weather/lifecycle.ts";
import { createBriefingServer } from "../../src/briefing/server.ts";
import { briefingPaths,initializeBriefingStore,openBriefingDatabase } from "../../src/briefing/store.ts";
const at="2026-09-16T06:00:00Z";
const date="2026-09-16";
const config=parseSignalsConfig();
const event=(id:string,start:string,end:string,day=date)=>({id,title:"Тестовая встреча",start:day+"T"+start+":00+03:00",end:day+"T"+end+":00+03:00",allDay:false});
function base() {
 return parseBriefingPayload({schemaVersion:1,edition:{id:"daily:"+date,type:"daily",localDate:date,timezone:"Europe/Vilnius",generatedAt:at,status:"complete",retentionUntil:"2026-09-21T06:00:00Z"},
 hero:{title:"Тест сигналов",subtitle:"Синтетические данные для проверки компонента"},
 calendar:{state:"ready",fetchedAt:at,events:[],allDayEvents:[],tomorrow:{localDate:"2026-09-17",state:"empty",events:[]}},
 mail:{state:"empty",fetchedAt:at,items:[]},news:{state:"empty",items:[]},
 weather:{state:"ready",fetchedAt:at,temperatureC:18,dailyForecast:[
 {localDate:date,minimumCelsius:10,maximumCelsius:20,precipitationProbabilityPercent:0},
 {localDate:"2026-09-17",minimumCelsius:10,maximumCelsius:20,precipitationProbabilityPercent:0}]},
 dataQuality:{state:"ready"}});
}
const ids=(payload:ReturnType<typeof base>, settings=config,time=at)=>deriveSignals(payload,settings,time).data.items.map(item=>item.id);
let payload=base();
assert.deepEqual(ids(payload),[]);
assert.equal(deriveSignals(payload,config,at).state,"empty");
section(payload,"calendar").events=[event("a","10:00","11:00"),event("b","10:55","11:30")];
assert.deepEqual(ids(payload),["calendar-overlap"]);
section(payload,"calendar").events=[event("a","10:00","11:00"),event("b","10:56","11:30")];
assert.deepEqual(ids(payload),[]);
section(payload,"calendar").events=[event("long","10:00","12:00")];
assert.deepEqual(ids(payload),["calendar-long"]);
section(payload,"calendar").events=[event("long","10:00","11:59")];
assert.deepEqual(ids(payload),[]);
section(payload,"calendar").events=[{...event("all","00:00","23:00"),allDay:true},
 {...event("cancel","10:00","14:00"),status:"cancelled"}, {...event("declined","10:00","14:00"),responseStatus:"declined"}];
assert.deepEqual(ids(payload),[]);
section(payload,"calendar").events=[event("long","09:00","13:00")];
assert.deepEqual(ids(payload),["calendar-dense"]);
section(payload,"calendar").events=[event("a","10:00","11:00"),event("b","11:14","12:14"),event("c","12:28","13:28")];
assert.deepEqual(ids(payload),["calendar-dense"]);
section(payload,"calendar").events=[event("a","10:00","11:00"),event("b","11:15","12:15"),event("c","12:30","13:30")];
assert.deepEqual(ids(payload),[]);
section(payload,"calendar").tomorrow={localDate:"2026-09-17",state:"ready",events:[event("early","08:59","09:30","2026-09-17")]};
assert.deepEqual(ids(payload),["calendar-early"]);
section(payload,"calendar").tomorrow={localDate:"2026-09-17",state:"ready",events:[event("early","09:00","10:00","2026-09-17")]};
assert.deepEqual(ids(payload),[]);

payload=base();
setSection(payload,"mail",{state:"ready",fetchedAt:at,items:[{id:"mail-1",provider:"gmail",providerItemId:"m1",class:"ACTION",receivedAt:"2026-09-14T06:00:00Z"}]});
assert.deepEqual(ids(payload),["mail-action"]);
section(payload,"mail").items[0]!.receivedAt="2026-09-14T05:59:59Z";
assert.deepEqual(ids(payload),["mail-old-action"]);
section(payload,"mail").items[0]!.receivedAt="invalid";
assert.deepEqual(ids(payload),["mail-action"]);
section(payload,"mail").items[0]!.receivedAt="2026-09-14T05:00:00Z";
refreshDerivedAddons(payload,{at,settings:{signals:config}});
const frozen=JSON.stringify(payload.addons.news);
assert(removeArchivedMail(payload,["m1"]));
refreshDerivedAddons(payload,{at});
assert.deepEqual(parseSignalsEnvelope(payload.addons.signals)!.data.items,[]);
assert.equal(JSON.stringify(payload.addons.news),frozen);
refreshDerivedAddons(payload,{at,settings:{signals:{enabled:false}}});
assert.equal(Object.hasOwn(payload.addons,"signals"),false);
assert.equal(parseSignalsConfig({maxItems:4}).error,"invalid_signals_config");
refreshDerivedAddons(payload,{at,settings:{signals:{maxItems:4}}});
assert.equal(payload.addons.signals?.state,"failed");

payload=base();
const days=section(payload,"weather").dailyForecast as Array<Record<string,unknown>>;
days[0]!.precipitationProbabilityPercent=60;
assert.deepEqual(ids(payload),["weather-today"]);
days[0]!.precipitationProbabilityPercent=59; days[0]!.minimumCelsius=0;
assert.deepEqual(ids(payload),[]);
days[0]!.minimumCelsius=-0.1;
assert.deepEqual(ids(payload),["weather-today"]);
days[0]!.minimumCelsius=5;days[0]!.maximumCelsius=30;
assert.deepEqual(ids(payload),["weather-today"]);
days[0]!.maximumCelsius=20;days[1]!.maximumCelsius=12;
assert.deepEqual(ids(payload),["weather-cooling"]);
days[1]!.maximumCelsius=12.1;
assert.deepEqual(ids(payload),[]);
days[1]!.maximumCelsius=undefined;
assert(deriveSignals(payload,config,at).data.unavailable.includes("weather_tomorrow_missing"));
days[0]!.precipitationProbabilityPercent=90;
section(payload,"weather").state="stale";
assert.deepEqual(ids(payload),[]);
section(payload,"weather").state="ready";
section(payload,"weather").fetchedAt="2026-09-16T02:59:59Z";
assert.deepEqual(ids(payload),[]);
section(payload,"weather").fetchedAt="2026-09-16T03:00:00Z";
assert.deepEqual(ids(payload),["weather-today"]);
section(payload,"weather").fetchedAt="2026-09-16T06:00:01Z";
assert.deepEqual(ids(payload),[]);
assert.deepEqual(ids(base(),config,"2026-09-17T06:00:00Z"),[]);

payload=base();
section(payload,"calendar").events=[event("a","10:00","14:00"),event("b","10:30","11:30")];
section(payload,"calendar").tomorrow={localDate:"2026-09-17",state:"ready",events:[event("early","08:30","09:00","2026-09-17")]};
setSection(payload,"mail",{state:"ready",fetchedAt:at,items:[{id:"m",provider:"gmail",providerItemId:"m",class:"ACTION",receivedAt:"2026-09-10T06:00:00Z"}]});
(section(payload,"weather").dailyForecast as Array<Record<string,unknown>>)[0]!.precipitationProbabilityPercent=90;
const result=deriveSignals(payload,config,at);
assert.deepEqual(result.data.items.map(item=>item.id),["calendar-overlap","mail-old-action","calendar-early"]);
assert.equal(new Set(result.data.items.map(item=>item.group)).size,3);
assert.deepEqual(deriveSignals(payload,config,at),result);
assert.equal(renderSignalStrip(result),renderSignalStrip(result));
assert.match(renderSignalStrip(result),/data-signal-until=.*hidden/s);
assert.equal(renderSignalStrip(deriveSignals(base(),config,at)),"");
const malicious=structuredClone(result);
malicious.data.items[0]!.href="javascript:alert(1)" as never;
assert.equal(parseSignalsEnvelope(malicious as never),null);

const calls:Array<Record<string,unknown>>=[];
const context={localDate:"2026-10-24",timeZone:"Europe/Vilnius",gmailQuery:"",weatherLocation:{name:"Vilnius",latitude:54,longitude:25,timeZone:"Europe/Vilnius"},
 calendars:[{key:"test",id:"primary",label:"Test",role:"personal"}],caller:async (_name:string,args:Record<string,unknown>)=>{calls.push(args);return {successful:true,data:{items:[]}}}};
await calendarLifecycle.collect({...context,includeTomorrow:false});
await calendarLifecycle.collect({...context,includeTomorrow:true});
assert.equal(Date.parse(String(calls[0]!.timeMax))-Date.parse(String(calls[0]!.timeMin)),24*3_600_000);
assert.equal(Date.parse(String(calls[1]!.timeMax))-Date.parse(String(calls[1]!.timeMin)),49*3_600_000);
const weather=normalizeOpenMeteo({current:{time:"2026-09-16T09:00",temperature_2m:18,weather_code:0},
 daily:{time:[date,"2026-09-17"],temperature_2m_min:[10,3],temperature_2m_max:[20,12],precipitation_probability_max:[0,20]}},context.weatherLocation);
const weatherPayload=base();setSection(weatherPayload,"weather",weatherValue(weather,"ready",at));
assert.deepEqual(ids(weatherPayload),["weather-cooling"]);

// Optional real-browser fixture: no provider calls and no real mailbox actions.
if(process.env.SIGNALS_PREVIEW_PORT) {
 const now=new Date(); const actualDate=new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Vilnius",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
 payload=base();payload.edition={...payload.edition,id:"daily:"+actualDate,localDate:actualDate,generatedAt:now.toISOString()};
 const future=(minutes:number)=>new Date(now.getTime()+minutes*60_000).toISOString();
 section(payload,"calendar").events=[{id:"a",title:"Тестовый созвон",start:future(10),end:future(100)},{id:"b",title:"Тестовая встреча",start:future(20),end:future(60)}];
 const tomorrow=new Date(Date.parse(actualDate+"T12:00:00Z")+86_400_000).toISOString().slice(0,10);
 section(payload,"calendar").tomorrow={localDate:tomorrow,state:"ready",events:[event("early","08:30","09:30",tomorrow)]};
 section(payload,"mail").items=[{id:"m",provider:"gmail",providerItemId:"test",class:"ACTION",subject:"Тест: согласовать документ",receivedAt:new Date(now.getTime()-72*3_600_000).toISOString()}];
 section(payload,"mail").state="ready";
 for(const id of ["mail","calendar","weather"] as const) section(payload,id).fetchedAt=now.toISOString();
 section(payload,"weather").dailyForecast=[{localDate:actualDate,minimumCelsius:10,maximumCelsius:20,precipitationProbabilityPercent:0},{localDate:tomorrow,minimumCelsius:5,maximumCelsius:12,precipitationProbabilityPercent:0}];
 refreshDerivedAddons(payload,{at:now.toISOString(),settings:{signals:config}});
 const home=await mkdtemp(resolve(tmpdir(),"kurami-signals-"));
 const paths=briefingPaths({KURAMI_HOME:home,BRIEFING_MIGRATIONS_DIR:resolve(import.meta.dirname,"../../migrations/briefing")});
 await initializeBriefingStore(paths);
 await writeFile(resolve(paths.previewDirectory,"signals.html"),renderBriefingPage(payload));
 const db=openBriefingDatabase(paths);
 db.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,is_current,prepared_at,retention_until,updated_at)
 VALUES(?,'daily',?,'Europe/Vilnius','complete',?,'pages/preview/signals.html','test',1,?,?,?)`).run(payload.edition.id,actualDate,JSON.stringify(payload),now.toISOString(),future(5000),now.toISOString());db.close();
 const server=await createBriefingServer(paths,{mailActionExecutor:null});server.listen(Number(process.env.SIGNALS_PREVIEW_PORT),"127.0.0.1");await once(server,"listening");
 console.log(JSON.stringify({preview:"http://127.0.0.1:"+process.env.SIGNALS_PREVIEW_PORT+"/daily/"+actualDate}));
}
console.log("signals thresholds, freshness, grouping, archive reconciliation and DST verified");

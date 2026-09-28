import assert from "node:assert/strict";
import {mkdtemp,mkdir,readFile,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
import {tmpdir} from "node:os";
import {once} from "node:events";
import {briefingPaths,initializeBriefingStore,openBriefingDatabase,upsertAddonSnapshot,type EditionRow,loadEdition,recordTelegramValidation,createTelegramCommitPlan,finalizeEdition} from "../../src/briefing/store.ts";
import {buildWeeklyReview} from "../../src/briefing/weekly/build.ts";
import {parseWeeklyConfig} from "../../src/briefing/weekly/config.ts";
import {observeDaily,calendarObservation,pruneWeeklyObservations} from "../../src/briefing/weekly/observations.ts";
import {parseWeeklyReview,shiftDate,isSunday} from "../../src/briefing/weekly/model.ts";
import {attachWeeklyReview,loadWeeklyReview,promoteWeeklyReview,collectWeeklyHistory} from "../../src/briefing/weekly/lifecycle.ts";
import {persistOptionalWeekly} from "../../src/briefing/weekly/persistence.ts";
import {parseBriefingPayload,preparePreview} from "./payload-fixtures.ts";
import {renderBriefingPage} from "../../src/briefing/ui/render-page.ts";
import {renderWeeklyPage,renderWeeklyTeaser} from "../../src/briefing/weekly/render.ts";
import {createBriefingServer} from "../../src/briefing/server.ts";
import {refreshBeforePublication} from "../../src/briefing/prepublication.ts";
import {startBriefingAttempt,recordBriefingRunStage} from "../../src/briefing/run-attempt.ts";
import {extendDailyRetention} from "../../src/briefing/migrations/extend-daily-retention.ts";
import type {BriefingAddonEnvelope} from "../../src/briefing/model.ts";
import type {DynamicBriefingSnapshot} from "../../src/briefing/providers/dynamic-snapshot.ts";

const root=resolve(import.meta.dirname,"../.."),home=await mkdtemp(resolve(tmpdir(),"kurami-weekly-"));
assert.equal(parseWeeklyConfig({enabled:true,observationDays:999}).enabled,false,"bad optional add-on config must not block Daily");
const env={KURAMI_HOME:home,BRIEFING_MIGRATIONS_DIR:resolve(root,"migrations/briefing")},paths=briefingPaths(env);
await initializeBriefingStore(paths);
await mkdir(resolve(home,"config"),{recursive:true});
await writeFile(resolve(home,"config/briefing.yaml"),await readFile(resolve(root,"deploy/config/briefing.yaml")));
const database=openBriefingDatabase(paths);
const sunday="2026-09-20";
const fixture=(date:string)=>{
const payload=parseBriefingPayload({
  schemaVersion:1,edition:{id:"daily:"+date,type:"daily",localDate:date,timezone:"Europe/Vilnius",generatedAt:date+"T06:00:00Z",status:"complete",retentionUntil:shiftDate(date,7)+"T00:00:00Z"},
  hero:{title:"Проверка"},news:{state:"empty",items:[]},sourceBatches:[],
  mail:{state:"ready",fetchedAt:date+"T06:00:00Z",count:8,items:[]},weather:{state:"failed"},
  calendar:{state:"ready",fetchedAt:date+"T06:00:00Z",events:[
    {id:"meeting-a",title:"Не сохранять название",start:date+"T09:00:00+03:00",end:date+"T11:00:00+03:00"},
    {id:"meeting-b",title:"Не сохранять название",start:date+"T10:00:00+03:00",end:date+"T12:00:00+03:00"},
    {id:"cancelled",title:"Cancelled",status:"cancelled",start:date+"T13:00:00+03:00",end:date+"T14:00:00+03:00"},
  ],allDayEvents:[]},dataQuality:{state:"partial"},
});
payload.addons.weekly={version:1,state:"empty",capturedAt:date+"T06:00:00Z",data:{policy:{enabled:true,observationDays:28}}};
return payload;
};
for(let offset=-14;offset<0;offset++){
  const date=shiftDate(sunday,offset),payload=fixture(date);
  observeDaily(database,payload,date+"T07:00:00Z");
  observeDaily(database,payload,date+"T08:00:00Z");
}
assert.deepEqual(calendarObservation(fixture("2026-09-13")),{events:2,allDay:0,busyMinutes:180,overlapMinutes:60});
const latest=fixture("2026-09-19");
const mail=latest.addons.mail!.data.section as Record<string,unknown>;
mail.count=3;mail.fetchedAt="2026-09-19T18:00:00Z";
observeDaily(database,latest,"2026-09-19T18:01:00Z");
mail.count=99;mail.fetchedAt="2026-09-20T06:00:00Z";
observeDaily(database,latest,"2026-09-20T06:01:00Z");
const inbox=JSON.parse((database.prepare("SELECT payload_json FROM weekly_daily_observations WHERE local_date='2026-09-19'").get() as {payload_json:string}).payload_json).inbox;
assert.equal(inbox.last,3,"today's live inbox must never replace yesterday's counters");
const reaction=database.prepare("INSERT INTO reaction_events(story_fingerprint,topic_ids_json,reaction,recorded_at) VALUES(?,?,?,?)");
reaction.run("one",'["ai","technology"]',"like","2026-09-14T09:00:00Z");
reaction.run("one",'["ai","technology"]',"dislike","2026-09-14T10:00:00Z");
reaction.run("two",'["transport"]',"like","2026-09-15T10:00:00Z");
reaction.run("three",'["transport"]',"like","2026-09-16T10:00:00Z");
reaction.run("three",'["transport"]',"clear","2026-09-16T11:00:00Z");
database.prepare("INSERT INTO weekly_mail_actions VALUES('action-1','2026-09-15',3)").run();
const review=parseWeeklyReview(buildWeeklyReview(database,sunday,"Europe/Vilnius","2026-09-20T06:00:00Z"));
assert.deepEqual(review.data.coverage,{news:7,calendar:7,mail:7});
assert.equal(review.data.totals.calendarMinutes,1260);
assert.equal(review.data.calendarDeltaMinutes,0);
assert.equal(review.data.totals.more,1);assert.equal(review.data.totals.less,1);
assert.equal(review.data.totals.archived,3);
assert(!JSON.stringify(database.prepare("SELECT * FROM weekly_daily_observations").all()).includes("Не сохранять"));
const empty=parseWeeklyReview(buildWeeklyReview(database,"2026-08-09","Europe/Vilnius"));
assert.equal(empty.state,"empty");assert.equal(empty.data.totals.calendarMinutes,null);
assert.match(renderWeeklyPage(empty),/Пока неполная история/);
const payload=fixture(sunday);
attachWeeklyReview(database,payload,{enabled:true,observationDays:28},"2026-09-20T06:00:00Z");
assert.match(renderWeeklyTeaser(payload),/href="\/weekly"/);
promoteWeeklyReview(database,payload);assert(loadWeeklyReview(database));
assert(!renderWeeklyTeaser(fixture("2026-09-21")));
assert.equal(isSunday("2026-10-25"),true);
assert.equal(shiftDate("2026-03-01",-1),"2026-02-28");
assert.throws(()=>shiftDate("2026-02-30",0));
assert.match(renderWeeklyPage(review),/data-chart-kind="bar"|chart--bar/);
assert.match(renderWeeklyPage(review),/class="weekly-metrics"/);
assert.match(renderWeeklyPage(review),/data-theme-toggle/);
assert.match(renderWeeklyPage(review),/favicon.svg/);
const attack=structuredClone(review);attack.data.insights=["<script>alert(1)</script>"];
assert(!renderWeeklyPage(attack).includes("<script>alert"));
pruneWeeklyObservations(database,"2026-09-20T06:00:00Z","Europe/Vilnius",7);
assert.equal(Number(database.prepare("SELECT COUNT(*) AS n FROM weekly_daily_observations").get()!.n),7);

const failedWeekly=fixture("2026-09-18");
failedWeekly.schemaVersion=2;
failedWeekly.notes=[{id:"weekly-failure-note",target:"hero",text:"Проверка",role:"context",tone:"signal",rotation:"none"}];
delete failedWeekly.addons.news;
await preparePreview(failedWeekly,renderBriefingPage(failedWeekly),paths);
recordTelegramValidation(database,failedWeekly.edition.id,{
  complete:true,configuredChannels:0,capturedUnread:0,fetched:0,normalized:0,
  mediaMessages:0,skippedNonImageMessages:0,albumGroups:0,channels:[],
},{raw:"empty-raw",normalized:"empty-normalized"});
const emptyPlan=createTelegramCommitPlan(database,failedWeekly.edition.id);
database.exec(`CREATE TRIGGER reject_weekly_observation BEFORE INSERT ON weekly_daily_observations
  BEGIN SELECT RAISE(ABORT, 'injected weekly persistence failure'); END`);
const dailyResult=finalizeEdition(database,failedWeekly.edition.id,[],emptyPlan.planDigest);
assert.equal(dailyResult.state,"complete","optional Weekly failure must not block Daily publication");
const failure=database.prepare("SELECT operation,error_code FROM weekly_persistence_failures WHERE edition_id=?")
  .get(failedWeekly.edition.id) as {operation:string;error_code:string}|undefined;
assert.equal(failure?.operation,"publish");
assert(failure?.error_code,"Weekly failure must leave a durable diagnostic code");
database.exec("DROP TRIGGER reject_weekly_observation");
persistOptionalWeekly(database,failedWeekly,new Date().toISOString(),"refresh");
assert.equal(database.prepare("SELECT 1 FROM weekly_persistence_failures WHERE edition_id=?")
  .get(failedWeekly.edition.id),undefined,"successful retry must clear the failure receipt");

// Late-publication debt: apply fresh providers while preserving news and envelope.
const staged=fixture("2026-09-17");
staged.schemaVersion=2;
staged.notes=[{id:"test-note",target:"hero",text:"два часа пересечения",role:"context",tone:"signal",rotation:"none"}];
const prepared=await preparePreview(staged,renderBriefingPage(staged),paths);
const {attempt}=await startBriefingAttempt(database,paths,{editionId:staged.edition.id,mode:"manual",timeZone:"Europe/Vilnius",at:new Date("2026-09-17T06:00:00Z")});
for(const stage of ["live-collected","telegram-captured","capture-validated","editorialized","prepared","media-ready"] as const)
  recordBriefingRunStage(database,{attemptId:attempt.attemptId,stage});
const good=<T>(value:T)=>({state:"ready" as const,value,fetchedAt:"2026-09-17T11:30:00Z",attempts:1,issues:[]});
const snapshot:DynamicBriefingSnapshot={localDate:"2026-09-17",refreshedAt:"2026-09-17T11:30:00Z",state:"ready",issues:[],
  gmail:good({query:"",unreadCount:0,items:[],pageCount:1}),
  calendar:good({localDate:"2026-09-17",localDateEndExclusive:"2026-09-18",timeZone:"Europe/Vilnius",timeMin:"2026-09-16T21:00:00Z",timeMax:"2026-09-17T21:00:00Z",items:[],sources:[]}),
  weather:{state:"failed",value:null,fetchedAt:"2026-09-17T11:30:00Z",attempts:1,issues:[]}};
const before=JSON.parse(loadEdition(database,{id:staged.edition.id})!.payload_json);
let collections=0;
await refreshBeforePublication(staged.edition.id,attempt.attemptId,env,async()=>{collections++;return snapshot;},()=>new Date("2026-09-17T11:30:00Z"));
const after=JSON.parse(loadEdition(database,{id:staged.edition.id})!.payload_json);
assert.deepEqual(after.addons.news,before.addons.news);assert.deepEqual(after.edition,before.edition);
assert.equal(after.addons.mail.data.section.count,0);assert.equal(collections,1);
assert.equal(after.addons.weather.data.section.state,"stale");
await refreshBeforePublication(staged.edition.id,attempt.attemptId,env,async()=>{collections++;return snapshot;},()=>new Date("2026-09-17T11:31:00Z"));
assert.equal(collections,2,"missing provider timestamps retry instead of pretending fresh");

// Existing published payload metadata is extended without changing HTML or news.
database.prepare("UPDATE editions SET state='complete',retention_until='2026-09-22T00:00:00.000Z' WHERE id=?").run(staged.edition.id);
await extendDailyRetention(paths);
assert.equal(loadEdition(database,{id:staged.edition.id})!.retention_until,"2026-09-24T00:00:00.000Z");
assert.deepEqual(JSON.parse(loadEdition(database,{id:staged.edition.id})!.payload_json).addons.news,before.addons.news);
console.log("Weekly: seven-day periods, exact calendar union, historical inbox isolation, reactions, partial data, safe rendering, late refresh and retention migration verified.");
const server=await createBriefingServer(paths,{mailActionExecutor:null,weekly:true});
server.listen(Number(process.env.WEEKLY_PREVIEW_PORT??0),"127.0.0.1");await once(server,"listening");
const base="http://127.0.0.1:"+(server.address() as {port:number}).port;
assert.equal((await fetch(base+"/weekly")).status,200);
assert.equal((await fetch(base+"/preview/weekly")).status,200);
assert.equal((await fetch(base+"/weekly/2026-09-20")).status,404);
assert.equal((await fetch(base+"/assets/briefing.js")).status,200);
if(process.env.WEEKLY_PREVIEW_PORT) {
  console.log("Synthetic Weekly preview: http://127.0.0.1:"+process.env.WEEKLY_PREVIEW_PORT+"/weekly");
} else {
  await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  const disabled=await createBriefingServer(paths,{mailActionExecutor:null,weekly:false});
  disabled.listen(0,"127.0.0.1");await once(disabled,"listening");
  assert.equal((await fetch("http://127.0.0.1:"+(disabled.address() as {port:number}).port+"/weekly")).status,404);
  await new Promise<void>((resolve,reject)=>disabled.close(error=>error?reject(error):resolve()));
  database.close();
}

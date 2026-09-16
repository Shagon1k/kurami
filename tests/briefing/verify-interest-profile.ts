import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { briefingPaths, initializeBriefingStore, openBriefingDatabase, setReaction } from "../../src/briefing/store.ts";
import { parseBriefingPayload } from "../../src/briefing/model.ts";
import { section } from "../../src/briefing/addons/envelopes.ts";
import { loadTopicPolicy } from "../../src/briefing/editorial-validation.ts";
import { buildInterestProfile, interestFeatures, personalizedNewsOrder, INTEREST_POLICY } from "../../src/briefing/interest-profile.ts";
import { backfillInterestContext } from "../../src/briefing/interest-context.ts";
import { createBriefingServer } from "../../src/briefing/server.ts";
import { renderBriefingPage } from "../../src/briefing/ui/render-page.ts";
const root=resolve(import.meta.dirname,"../..");
const policy=await loadTopicPolicy("/unused",{TOPIC_SEED:resolve(root,"deploy/config/briefing-topics.yaml")});
const home=await mkdtemp(resolve(tmpdir(),"kurami-interest-"));
const paths=briefingPaths({KURAMI_HOME:home,BRIEFING_MIGRATIONS_DIR:resolve(root,"migrations/briefing")});
await initializeBriefingStore(paths);
const db=openBriefingDatabase(paths);
const now="2026-09-16T06:00:00Z";
const stories=Array.from({length:12},(_,index)=>{
 const geo=index%2===0?"united-states":"lithuania";
 return {id:"story-"+index,fingerprint:"fp-"+index,headline:"Тест: решение администрации "+index,
 summary:"Демонстрационный сюжет для проверки интересов по темам и странам.",
 details:["Синтетические данные. Эти сюжеты используются только для проверки интерфейса."],
 topics:["politics",geo,"public-administration"].map(id=>({id,label:policy.topics.get(id)!.label})),
 sources:[{sourceKey:"telegram:test-news",sourceLabel:"Test News",itemIds:[String(index+1)]}],
 ...(index===0?{reaction:"dislike",editorialSignals:{importance:"critical",urgency:"today",publicInterest:"high",confidence:"high"}}:{}),
 };
});
const payload=parseBriefingPayload({schemaVersion:2,formatVersion:3,
 edition:{id:"daily:2026-09-16",type:"daily",localDate:"2026-09-16",timezone:"Europe/Vilnius",generatedAt:now,status:"complete",retentionUntil:"2026-09-21T06:00:00Z"},
 hero:{title:"Проверка профиля интересов",subtitle:"Синтетическая выборка для проверки интерфейса"},
 addons:{news:{version:2,state:"ready",capturedAt:now,data:{section:{state:"ready",pageSize:10,items:stories}}}},
 dataQuality:{state:"ready"},
});
await writeFile(resolve(paths.previewDirectory,"interest.html"),renderBriefingPage(payload));
db.prepare(`INSERT INTO editions(id,edition_type,local_date,timezone,state,payload_json,html_path,content_digest,is_current,prepared_at,published_at,retention_until,updated_at)
VALUES(?,'daily','2026-09-16','Europe/Vilnius','complete',?,'pages/preview/interest.html','frozen',1,?,?,?,?)`)
 .run(payload.edition.id,JSON.stringify(payload),now,now,payload.edition.retentionUntil,now);
for(const story of stories) db.prepare(`INSERT INTO edition_items(edition_id,item_id,item_type,story_fingerprint,topic_ids_json,updated_at) VALUES(?,?,'story',?,?,?)`)
 .run(payload.edition.id,story.id,story.fingerprint,JSON.stringify(story.topics.map(topic=>topic.id)),now);
const empty=buildInterestProfile(db,policy);
assert.equal(empty.ready,false);
assert.deepEqual(personalizedNewsOrder(section(payload,"news").items,empty,policy).order,stories.map(story=>story.id));
for(let i=0;i<10;i++) setReaction(db,payload.edition.id,stories[i]!.id,i%2?"like":"dislike");
let profile=buildInterestProfile(db,policy);
assert.equal(profile.reactions,10);
assert.equal(profile.ready,true);
assert.equal(profile.withSourceContext,10);
for(let repeat=0;repeat<5;repeat++) setReaction(db,payload.edition.id,"story-0","dislike");
assert.deepEqual(buildInterestProfile(db,policy).weights,profile.weights,"repeated votes cannot add evidence");
setReaction(db,payload.edition.id,"story-0","clear");
assert.equal(buildInterestProfile(db,policy).reactions,9);
assert.equal(buildInterestProfile(db,policy).ready,false);
setReaction(db,payload.edition.id,"story-0","dislike");
profile=buildInterestProfile(db,policy);
assert(profile.weights.find(weight=>weight.key==="pair:politics+united-states")!.weight<0);
assert(profile.weights.find(weight=>weight.key==="pair:lithuania+politics")!.weight>0);
const frozen=JSON.stringify(payload);
const ordered=personalizedNewsOrder(section(payload,"news").items,profile,policy);
assert.equal(ordered.order[0],"story-0","critical story keeps its exact position");
assert(ordered.order.indexOf("story-3")<ordered.order.indexOf("story-2"),"country-specific preference changes nearby ordering");
assert.deepEqual([...ordered.order].sort(),stories.map(story=>story.id).sort());
assert.equal(JSON.stringify(payload),frozen);
const urgent = structuredClone(section(payload,"news").items);
urgent[4]!.editorialSignals = { importance: "high", urgency: "today", publicInterest: "medium", confidence: "high" };
assert.equal(personalizedNewsOrder(urgent,profile,policy).order[4],urgent[4]!.id);
assert.deepEqual(personalizedNewsOrder(section(payload,"news").items,profile,policy),ordered);
assert(ordered.details.every(item=>Math.abs(item.adjustment)<=INTEREST_POLICY.maximumAdjustment));
const aliased=interestFeatures(["USA","united-states","Politics"],[],policy);
assert.equal(aliased.filter(feature=>feature.kind==="geography").length,1);
assert(aliased.some(feature=>feature.key==="pair:politics+united-states"));
assert(!interestFeatures(["ai","technology"],[],policy).some(feature=>feature.kind==="pair"),"two broad containers are not specific context");
const ambiguousPolicy={...policy,topics:new Map(policy.topics)};
ambiguousPolicy.topics.set("other",{id:"other",label:"Other",aliases:["USA"],status:"active"});
assert(!interestFeatures(["USA"],[],ambiguousPolicy).some(feature=>feature.key==="geography:united-states"));
db.prepare("UPDATE reaction_events SET context_json=NULL WHERE story_fingerprint='fp-1'").run();
const beforeBackfill=Number((db.prepare("SELECT COUNT(*) AS n FROM reaction_events").get() as {n:number}).n);
assert.equal(backfillInterestContext(db),1);
assert.equal(backfillInterestContext(db),0);
assert.equal(Number((db.prepare("SELECT COUNT(*) AS n FROM reaction_events").get() as {n:number}).n),beforeBackfill);
db.prepare("INSERT INTO reaction_events(story_fingerprint,topic_ids_json,reaction,recorded_at) VALUES('expired',?,'like',?)").run(JSON.stringify(["tea","science"]),now);
const legacy=buildInterestProfile(db,policy);
assert.equal(legacy.reactions,11);
assert.equal(legacy.withSourceContext,10);
assert.equal(legacy.weights.find(weight=>weight.key==="aspect:tea")!.weight,0,"one event cannot establish a preference");

const server=await createBriefingServer(paths,{mailActionExecutor:null});
server.listen(Number(process.env.INTEREST_PREVIEW_PORT ?? 0),"127.0.0.1");
await once(server,"listening");
const address=server.address() as {port:number};
const base="http://127.0.0.1:"+address.port;
try {
 const order=await fetch(base+"/api/news/order?editionId="+payload.edition.id+"&mode=for-you").then(r=>r.json()) as {mode:string;order:string[]};
 assert.equal(order.mode,"for-you");
 assert.deepEqual([...order.order].sort(),stories.map(story=>story.id).sort());
 const overview=await fetch(base+"/api/news/order?editionId="+payload.edition.id+"&mode=briefing").then(r=>r.json()) as {order:string[]};
 assert.deepEqual(overview.order,stories.map(story=>story.id));
 assert.equal((await fetch(base+"/api/news/order?editionId="+payload.edition.id+"&mode=hide")).status,400);
 const saved=db.prepare("SELECT payload_json,content_digest FROM editions WHERE id=?").get(payload.edition.id) as {payload_json:string;content_digest:string};
 assert.equal(saved.payload_json,frozen);
 assert.equal(saved.content_digest,"frozen");
 const response=await fetch(base+"/api/stories/reaction",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({editionId:payload.edition.id,itemId:"story-0",reaction:"clear"})});
 assert.equal(response.status,200);
 assert.equal(buildInterestProfile(db,policy).reactions,10);
 setReaction(db,payload.edition.id,"story-0","dislike");
 if(process.env.INTEREST_PREVIEW_PORT) {
   console.log(JSON.stringify({preview:base+"/daily/2026-09-16",home}));
 } else {
   db.prepare("DELETE FROM editions").run();
   assert.equal(buildInterestProfile(db,policy).reactions,11,"compact preferences survive edition deletion");
 }
} finally {
 if(!process.env.INTEREST_PREVIEW_PORT) {server.close();await once(server,"close");}
 db.close();
}
// Verify an existing event survives the additive schema migration unchanged.
const old=new DatabaseSync(":memory:");
old.exec(await readFile(resolve(root,"migrations/briefing/001_initial.sql"),"utf8"));
old.exec("INSERT INTO reaction_events(story_fingerprint,topic_ids_json,reaction,recorded_at) VALUES('old','[\"tea\"]','like','2026-09-01')");
old.exec(await readFile(resolve(root,"migrations/briefing/008_interest_profile.sql"),"utf8"));
assert.equal((old.prepare("SELECT context_json FROM reaction_events").get() as {context_json:null}).context_json,null);
assert.equal(buildInterestProfile(old,policy).reactions,1);
old.close();
console.log("interest profile, optional ordering, evidence and retention verified");

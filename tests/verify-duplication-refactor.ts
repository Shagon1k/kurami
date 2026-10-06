import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {parseEnvValue} from "../src/core/env-value.ts";
import {prepareTopicUpsert} from "../src/briefing/topic-registry-store.ts";
import * as projections from "../src/orchestrator/runtime/run-projections.ts";
import {createProjectActionRequest,PROJECT_ACTION_REQUEST_JS} from "../src/projects-site/action-request.ts";
import {browserStatusPresentation,statusPresentation,STATUS_PRESENTATION} from "../src/projects-site/action-presentation.ts";

for(const [source,key,expected] of [
  ["# ignored\nINVALID LINE\nTOKEN=' first ' \nTOKEN=second","TOKEN"," first "],
  ["TOKEN = ignored\nTOKEN=second","TOKEN","second"],
  ['TOKEN="quoted=value"',"TOKEN","quoted=value"],
  ["TOKEN=\nTOKEN=second","TOKEN",undefined],
  ['TOKEN="$UNEXPANDED"',"TOKEN","$UNEXPANDED"],
  ['NOT_TOKEN=value',"TOKEN",undefined],
] as const)assert.equal(parseEnvValue(source,key),expected);

const db=new DatabaseSync(":memory:");
try {
  db.exec(`CREATE TABLE runs(run_id TEXT); INSERT INTO runs VALUES('r1'),('r2');
    CREATE TABLE run_state_history(run_id TEXT,to_state TEXT,reason TEXT,sequence INTEGER);
    INSERT INTO run_state_history VALUES('r1','needs_attention','actual_reason',1),('r1','needs_attention','review_fix_task_archived',2),('r1','parked_review','ignored',3);
    CREATE TABLE run_autonomous_successions(run_id TEXT,succession_state TEXT,predecessor_thread_id TEXT,succession_number INTEGER);
    INSERT INTO run_autonomous_successions VALUES('r1','running','old',1),('r1','starting','new',2);
    CREATE TABLE topic_registry(id TEXT PRIMARY KEY,label TEXT,aliases_json TEXT,status TEXT,created_at TEXT,updated_at TEXT);`);
  const base=[projections.LATEST_ATTENTION_SQL,projections.LATEST_SUCCESSOR_STATE_SQL,projections.LATEST_SUCCESSOR_THREAD_SQL];
  const rows=db.prepare(`SELECT ${[...base,projections.ACTIVE_SUCCESSOR_COUNT_SQL].join(',')} FROM runs r ORDER BY r.run_id`).all();
  assert.equal(rows[0]!.latest_attention_reason,"actual_reason");assert.equal(rows[0]!.latest_autonomous_successor_state,"starting");
  assert.equal(rows[0]!.latest_autonomous_successor_predecessor_thread_id,"new");assert.equal(rows[0]!.autonomous_successor_active,2);
  assert.equal(rows[1]!.latest_attention_reason,null);assert.equal(rows[1]!.autonomous_successor_active,0);
  assert.equal(db.prepare(`SELECT ${projections.ACTIVE_SUCCESSOR_EXISTS_SQL} FROM runs r WHERE r.run_id='r1'`).get()!.autonomous_successor_active,1,"EXISTS stays boolean rather than becoming a count");
  const upsert=prepareTopicUpsert(db);
  upsert.run("topic","Before",'["alias"]',"active","t0","t0");
  upsert.run("topic","After","[]","candidate","t1","t1");
  const topic=db.prepare("SELECT * FROM topic_registry").get()!;
  assert.equal(topic.label,"After");assert.equal(topic.aliases_json,'["alias"]');assert.equal(topic.status,"active");assert.equal(topic.created_at,"t0");
  db.exec("BEGIN");upsert.run("topic","Rollback",'["new"]',"active","t2","t2");db.exec("ROLLBACK");
  assert.equal(db.prepare("SELECT label FROM topic_registry").get()!.label,"After","helper retains caller-owned transactions");
} finally {db.close();}

for(const lang of ["en","ru"] as const)for(const [state,presentation] of Object.entries(STATUS_PRESENTATION)) {
  assert.equal(browserStatusPresentation(lang)[state]!.tone,statusPresentation(state)!.tone);
  assert.ok(browserStatusPresentation(lang)[state]!.message);assert.ok(presentation.message);
}
assert.equal(statusPresentation("__proto__"),undefined);
new Function(PROJECT_ACTION_REQUEST_JS+"return createProjectActionRequest;")();
for(const kind of ["review","action","status"] as const) {
  let busy=false,calls=0;const events:string[]=[],attrs=new Set<string>();
  const button={disabled:false,setAttribute:(name:string)=>attrs.add(name),removeAttribute:(name:string)=>attrs.delete(name)} as unknown as HTMLButtonElement;
  const headers={"Content-Type":"application/json"};const body={key:"same-idempotency-key"};
  const request=createProjectActionRequest({busy:()=>busy,setBusy:(_,value)=>{busy=value;events.push(value?"busy":"idle");},headers,url:path=>"https://fixture.test"+path,
    notify:(message)=>events.push(message),fetcher:async(_url,options)=>{calls++;assert.deepEqual(options!.headers,headers);assert.equal(options!.body,JSON.stringify(body));assert.ok(options!.signal);return new Response('{"state":"created"}');}});
  const options={kind,path:"/action",body,timeout:1000,unconfirmed:"unconfirmed",response:async()=>{assert.equal(busy,true);assert.equal(attrs.has("aria-busy"),true);events.push("response");},after:()=>{assert.equal(busy,false);events.push("after");}};
  const first=request(button,options);await request(button,options);await first;
  assert.equal(calls,1);assert.deepEqual(events,["busy","response","idle","after"]);assert.equal(attrs.size,0);
  const failed=createProjectActionRequest({busy:()=>busy,setBusy:(_,value)=>{busy=value;},headers,url:path=>path,notify:message=>events.push(message),fetcher:async()=>{throw new TypeError("network");}});
  await failed(button,{...options,error:()=>events.push("recover")});
  assert.equal(busy,false);assert.equal(attrs.size,0);assert.ok(events.includes("unconfirmed"));assert.ok(events.includes("recover"));
  const timedOut=createProjectActionRequest({busy:()=>busy,setBusy:(_,value)=>{busy=value;},headers,url:path=>path,notify:message=>events.push(message),fetcher:async()=>{throw new DOMException("timeout","TimeoutError");}});
  await timedOut(button,{...options,error:()=>events.push("timeout-recover")});
  assert.equal(busy,false);assert.equal(attrs.size,0);assert.ok(events.includes("timeout-recover"));
  button.disabled=true;await request(button,options);assert.equal(calls,1);
}
console.log("Duplication refactor: env parsing, SQL projection semantics, transactional topic upserts, shared status presentation and action transport verified");

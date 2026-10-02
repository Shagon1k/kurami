import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {collectHubOperations} from "../../src/hub/operations.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {recordSystemActivity,readSystemActivity} from "../../src/core/activity.ts";
import {createProjectStore} from "./project-store.ts";
import {scanFile} from "../../src/core/codex-usage.ts";
import {collectCodexSessionActivity} from "../../src/hub/codex.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-hub-operations-"));
try {
  mkdirSync(join(home,"state"));mkdirSync(join(home,"codex/sessions"),{recursive:true});mkdirSync(join(home,"hermes"));
  mkdirSync(join(home,"config"));writeFileSync(join(home,"config/projects.yaml"),JSON.stringify({projects:{pickflick:{statuses:{backlog:"Backlog",active:"In progress",review:"Human Review",done:"Done",deferred:"Deferred"}}}}));
  const now=new Date();const at=new Date(now.getTime()-60_000).toISOString();
  const health=syntheticHubSnapshot().operations!.health!;health.checkedAt=at;
  health.issues=[{key:"server:cpu",severity:"critical",message:"one transient CPU spike"}];
  writeFileSync(join(home,"state/system-health-snapshot.json"),JSON.stringify(health));
  writeFileSync(join(home,"state/runtime-health-alert.json"),JSON.stringify({active:{}}));
  const db=new DatabaseSync(join(home,"state/orchestrator.db"));
  createProjectStore(db);
  for(const [id,issue,state,status] of [["repairing",1,"running","In progress"],["broken",2,"parked_review","Human Review"],["done",3,"failed","Done"],["old",4,"failed","In progress"],["new",4,"running","In progress"]]){
    db.prepare("INSERT INTO runs VALUES(?,?,?,?,?,?,?)").run(id,"pickflick",issue,"Shagon1k/PickFlick",`item-${issue}`,state,at);
    if(id!=="old")db.prepare("INSERT INTO project_items VALUES(?,?,?,?)").run("pickflick",`item-${issue}`,status,1);
  }
  for(const id of ["repairing","broken","done","old"]){
    db.prepare("INSERT INTO run_ci_snapshots VALUES(?,?,?,?,?,?,?,?)").run(id,"current-head","failed","https://github.com/Shagon1k/PickFlick/pull/1","Fix watchlist",at,at,now.toISOString());
  }
  db.prepare("INSERT INTO run_ci_repair_attempts VALUES(?,?,?,?,?)").run("repairing","current-head","running",1,null);
  db.prepare("INSERT INTO run_ci_repair_attempts VALUES(?,?,?,?,?)").run("broken","old-head","running",1,null);
  db.prepare("INSERT INTO run_ai_reviews VALUES(?,?,?,?,?,?,?,?,?,?,?)").run("review1","broken","old-head","ready",1,1,0,0,at,"https://github.com/Shagon1k/PickFlick/pull/1",1);
  db.prepare("INSERT INTO run_state_history VALUES(?,?,?,?)").run(1,"new",at,"running");
  db.exec("ALTER TABLE project_items ADD COLUMN title TEXT; ALTER TABLE run_ci_snapshots ADD COLUMN pull_request_number INTEGER; ALTER TABLE run_ci_snapshots ADD COLUMN checks_json TEXT; CREATE TABLE run_resources(run_id TEXT,codex_thread_id TEXT,previous_codex_thread_id TEXT)");
  db.prepare("UPDATE project_items SET title=? WHERE item_id=?").run("Fix watchlist","item-4");
  db.prepare("UPDATE run_ci_snapshots SET checks_json=?").run(JSON.stringify([{name:"unit-tests",state:"failed"}]));
  db.prepare("INSERT INTO run_resources VALUES(?,?,NULL)").run("new","thread-1");db.close();
  const rollout=join(home,"codex/sessions/thread.jsonl");
  writeFileSync(rollout,[
    JSON.stringify({type:"event_msg",timestamp:at,payload:{type:"task_started",turn_id:"turn-1"}}),
    JSON.stringify({type:"event_msg",timestamp:at,payload:{type:"agent_message",message:"PRIVATE_TRANSCRIPT_SENTINEL"}}),
  ].join("\n")+"\n");
  const codex=new DatabaseSync(join(home,"codex/state_5.sqlite"));
  codex.exec("CREATE TABLE threads(id TEXT,title TEXT,name TEXT,created_at INTEGER,updated_at INTEGER,rollout_path TEXT)");
  codex.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?)").run("thread-1","Old ongoing session",null,Math.floor(now.getTime()/1000)-30*86400,Math.floor(now.getTime()/1000),rollout);codex.close();
  const classified=new DatabaseSync(join(home,"codex/state_5.sqlite"));
  classified.exec("ALTER TABLE threads ADD COLUMN source TEXT; ALTER TABLE threads ADD COLUMN thread_source TEXT");
  const insert=classified.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)");
  insert.run("guardian-1","Not a guardian title",null,Math.floor(now.getTime()/1000),Math.floor(now.getTime()/1000),rollout,'{"subagent":{"other":"guardian"}}',null);
  insert.run("guardian-2","Another title",null,Math.floor(now.getTime()/1000),Math.floor(now.getTime()/1000),rollout,'{}','guardian_review');
  insert.run("ordinary","Guardian review",null,Math.floor(now.getTime()/1000),Math.floor(now.getTime()/1000),null,'not json','cli');
  insert.run("named-subagent","   ","Leaf reviewer",Math.floor(now.getTime()/1000),Math.floor(now.getTime()/1000),null,'{}','cli');
  classified.close();
  const snapshot=collectHubOperations(home,join(home,"codex"),join(home,"hermes"),now);
  assert(!snapshot.activity.some(event=>event.sessionId?.startsWith("guardian-")),"internal guardian metadata is excluded from the activity UI");
  assert(snapshot.activity.some(event=>event.sessionId==="ordinary"),"title alone never hides a session");
  assert.equal(snapshot.activity.find(event=>event.sessionId==="named-subagent")?.subject,"Leaf reviewer","session names are available before a task title arrives");
  const legacyHome=join(home,"legacy-codex");mkdirSync(legacyHome);
  const legacyDb=new DatabaseSync(join(legacyHome,"state_5.sqlite"));
  legacyDb.exec("CREATE TABLE threads(id TEXT,title TEXT,created_at INTEGER)");
  legacyDb.prepare("INSERT INTO threads VALUES(?,?,?)").run("old-session"," Legacy session ",Math.floor(now.getTime()/1000));legacyDb.close();
  assert.equal(collectCodexSessionActivity(legacyHome,now)[0]?.subject,"Legacy session","older databases without a name column retain session activity");
  assert.equal(snapshot.health?.server.cpuUsedPercent,health.server.cpuUsedPercent);
  assert.equal(snapshot.healthStale,false);
  assert.deepEqual(snapshot.alerts.map(alert=>alert.id),["ci-broken"],"current repair suppresses CI alerts; Done, superseded runs and stale review heads are excluded");
  assert.equal(snapshot.alerts[0]!.actor,"owner");assert.equal(snapshot.alerts[0]!.next,"inspect_task","stale busy repair needs inspection, not a second repair");
  assert.equal(snapshot.alerts[0]!.detail,"unit-tests");
  assert.equal(snapshot.alerts[0]!.itemId,"item-2","Alerts includes the actual Projects item, not an inferred PR identity");
  assert.equal(snapshot.activity.find(event=>event.source==="CI")?.at,at,"poll timestamps never masquerade as CI transitions");
  assert(snapshot.activity.some(event=>event.event==="task_started"),"new turns in older sessions appear in activity");
  const turn=snapshot.activity.find(event=>event.event==="task_started")!;
  assert.equal(turn.turnId,"turn-1","trusted turn identifiers reach structured activity");
  assert.equal(turn.group,"task:pickflick:4");assert.equal(turn.subject,"Fix watchlist");
  const cappedRollout=join(home,"codex/sessions/capped.jsonl");
  writeFileSync(cappedRollout,Array.from({length:22},(_,index)=>JSON.stringify({type:"event_msg",timestamp:at,payload:{type:"task_started",turn_id:index===21?"<invalid>":`turn-${index}`}})).join("\n")+"\n");
  const capped=scanFile(cappedRollout,join(home,"codex"))!;
  assert.equal(capped.activity.length,20);assert.equal(capped.activityTruncated,true);
  assert.equal(capped.activity.at(-1)?.turnId,undefined,"invalid identifiers do not enter turn pairing");
  const ambiguous=new DatabaseSync(join(home,"state/orchestrator.db"));
  ambiguous.prepare("INSERT INTO run_resources VALUES(?,?,NULL)").run("broken","thread-1");ambiguous.close();
  const unowned=collectHubOperations(home,join(home,"codex"),join(home,"hermes"),now).activity.find(event=>event.event==="task_started")!;
  assert.equal(unowned.group,"codex:thread-1","ambiguous session mappings never invent task ownership");
  assert(!JSON.stringify(snapshot).includes("PRIVATE_TRANSCRIPT_SENTINEL"));
  await recordSystemActivity(home,"Cinema","2026-09-30","collect_started");
  assert.equal(readSystemActivity(home,new Date(now.getTime()-86400_000).toISOString())[0]?.event,"collect_started");
  health.checkedAt=new Date(now.getTime()-60*60_000).toISOString();writeFileSync(join(home,"state/system-health-snapshot.json"),JSON.stringify(health));
  assert.equal(collectHubOperations(home,join(home,"missing"),join(home,"hermes"),now).healthStale,true);
  writeFileSync(join(home,"state/system-health-snapshot.json"),"{}");
  assert.equal(collectHubOperations(home,join(home,"missing"),join(home,"hermes"),now).health,null,"invalid health data does not break the dashboard");
}finally{rmSync(home,{recursive:true,force:true});}
console.log("Hub operations: shared health, stale data, repair attribution, durable activity and transcript exclusion verified");

import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DatabaseSync} from "node:sqlite";
import {collectHubOperations} from "../../src/hub/operations.ts";
import {syntheticHubSnapshot} from "../../src/ui-library/testing/fixtures.ts";
import {recordSystemActivity,readSystemActivity} from "../../src/core/activity.ts";
import {createProjectStore} from "./project-store.ts";

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
  db.prepare("INSERT INTO run_state_history VALUES(?,?,?,?)").run(1,"new",at,"running");db.close();
  const rollout=join(home,"codex/sessions/thread.jsonl");
  writeFileSync(rollout,[
    JSON.stringify({type:"event_msg",timestamp:at,payload:{type:"task_started"}}),
    JSON.stringify({type:"event_msg",timestamp:at,payload:{type:"agent_message",message:"PRIVATE_TRANSCRIPT_SENTINEL"}}),
  ].join("\n")+"\n");
  const codex=new DatabaseSync(join(home,"codex/state_5.sqlite"));
  codex.exec("CREATE TABLE threads(id TEXT,title TEXT,name TEXT,created_at INTEGER,updated_at INTEGER,rollout_path TEXT)");
  codex.prepare("INSERT INTO threads VALUES(?,?,?,?,?,?)").run("thread-1","Old ongoing session",null,Math.floor(now.getTime()/1000)-30*86400,Math.floor(now.getTime()/1000),rollout);codex.close();
  const snapshot=collectHubOperations(home,join(home,"codex"),join(home,"hermes"),now);
  assert.equal(snapshot.health?.server.cpuUsedPercent,health.server.cpuUsedPercent);
  assert.equal(snapshot.healthStale,false);
  assert.deepEqual(snapshot.alerts.map(alert=>alert.id),["ci-broken"],"current repair suppresses CI alerts; Done, superseded runs and stale review heads are excluded");
  assert.equal(snapshot.activity.find(event=>event.source==="CI")?.at,at,"poll timestamps never masquerade as CI transitions");
  assert(snapshot.activity.some(event=>event.event==="task_started"),"new turns in older sessions appear in activity");
  assert(!JSON.stringify(snapshot).includes("PRIVATE_TRANSCRIPT_SENTINEL"));
  await recordSystemActivity(home,"Cinema","2026-09-30","collect_started");
  assert.equal(readSystemActivity(home,new Date(now.getTime()-86400_000).toISOString())[0]?.event,"collect_started");
  health.checkedAt=new Date(now.getTime()-60*60_000).toISOString();writeFileSync(join(home,"state/system-health-snapshot.json"),JSON.stringify(health));
  assert.equal(collectHubOperations(home,join(home,"missing"),join(home,"hermes"),now).healthStale,true);
  writeFileSync(join(home,"state/system-health-snapshot.json"),"{}");
  assert.equal(collectHubOperations(home,join(home,"missing"),join(home,"hermes"),now).health,null,"invalid health data does not break the dashboard");
}finally{rmSync(home,{recursive:true,force:true});}
console.log("Hub operations: shared health, stale data, repair attribution, durable activity and transcript exclusion verified");

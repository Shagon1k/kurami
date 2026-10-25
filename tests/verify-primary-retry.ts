import { syntheticProjectsSnapshot } from "./projects-site/fixture.ts";
import { renderProjectsPage } from "../src/projects-site/render.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { capturePrimaryAttempt, capturePrimaryStoppedResult } from "../src/orchestrator/integrations/codex/primary-diagnostic.ts";
import { emptyPrimaryInput } from "../src/orchestrator/integrations/codex/primary-agent.ts";
import { primaryAgent } from "../src/orchestrator/integrations/primary-agent.ts";
import { inspectPrimaryRetry, observePrimaryAttempt, retryPrimary } from "../src/orchestrator/projects/sessions/retry-primary.ts";
import { availableRunControls, requestRunControl } from "../src/orchestrator/controls/run.ts";

const home=realpathSync(mkdtempSync(resolve(tmpdir(),"kurami-primary-retry-")));
const env={...process.env};
const database=new DatabaseSync(resolve(home,"orchestrator.db"));
const git=(dir:string,...args:string[])=>execFileSync("git",["-C",dir,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
try {
  database.exec("PRAGMA foreign_keys=ON");
  const migrations=resolve(import.meta.dirname,"../migrations");
  const files=readdirSync(migrations).filter(f=>/^\d+_.*\.sql$/.test(f)).sort();
  for(const file of files.filter(f=>f<"046"))database.exec(`BEGIN;${readFileSync(resolve(migrations,file),"utf8")}\nCOMMIT;`);
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES('e','2026-10-25T00:00:00Z','fixture','item','Issue','{}');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
      VALUES('r_retry','e','fixture','item','content','Example/Repo',1,'autonomous','running','cli','live');
    INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id,tmux_session_name)
      VALUES('r_retry','provisioned','placeholder','task','thread','cx-fixture');
    INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key,review_fix_recovery_json)
      VALUES('rq_history','r_retry','review_fix','applied','discord','history','{"retained":"exact"}');
    INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,source_head_sha,snapshot_json,summary_findings_json)
      VALUES('round','r_retry','rq_history',1,'succeeded','Example/Repo',2,'https://github.com/Example/Repo/pull/2','abcdef0','[{"requirements":"complete"}]','[{"evidence":"retained"}]');
    INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,phase,released_at)
      VALUES('old-task','r_retry','review_fix','round','old-session','placeholder','task','terminal','2026-10-25');
    INSERT INTO run_interrupted_review_fix_recoveries(request_id,round_id,predecessor_task_id,dirty_digest,dirty_snapshot_json,session_name)
      VALUES('rq_history','round','old-task','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','{"staged":"retained"}','old-session');`);
  const evidenceTables=['run_control_requests','run_review_fix_rounds','run_interrupted_review_fix_recoveries'];
  const before=evidenceTables.map(t=>database.prepare(`SELECT * FROM ${t}`).all());
  database.exec(`BEGIN;${readFileSync(resolve(migrations,"046_manual_agent_retry.sql"),"utf8")}\nCOMMIT;`);
  for(const [i,t] of evidenceTables.entries())assert.deepEqual(database.prepare(`SELECT * FROM ${t}`).all().map(r=>{delete r.retry_context_json;return r;}),before[i],`migration preserves ${t}`);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);

  const canonical=resolve(home,"repo"),root=resolve(home,"managed"),worktree=resolve(root,"task/Repo"),bin=resolve(home,"bin"),codex=resolve(home,"codex");
  for(const path of [canonical,bin,resolve(codex,"sessions"),resolve(home,"config")])mkdirSync(path,{recursive:true});
  git(canonical,"init","--initial-branch=main");git(canonical,"config","user.name","Retry Test");git(canonical,"config","user.email","retry@example.invalid");
  git(canonical,"remote","add","origin","https://github.com/Example/Repo.git");
  writeFileSync(resolve(canonical,"source.txt"),"original\n");git(canonical,"add",".");git(canonical,"commit","-m","fixture");git(canonical,"worktree","add","-b","task",worktree);
  writeFileSync(resolve(worktree,"source.txt"),"preserved dirty work\n");
  const project={repository:"Example/Repo",workspace:{canonical_repository:canonical,worktree_root:root}};
  writeFileSync(resolve(home,"config/projects.yaml"),JSON.stringify({version:1,projects:{fixture:project}}));
  writeFileSync(resolve(home,"config/orchestrator.yaml"),readFileSync(resolve(import.meta.dirname,"../deploy/config/orchestrator.yaml")));
  database.prepare("UPDATE run_resources SET worktree_path=? WHERE run_id='r_retry'").run(worktree);
  const rollout=resolve(codex,"sessions/attempt.jsonl");
  const meta={type:"session_meta",payload:{id:"thread",cwd:worktree}};
  const event=(type:string,turnId:string,error?:unknown)=>JSON.stringify({type:"event_msg",payload:{type,turn_id:turnId,...(error?{error}: {})}})+"\n";
  const resetNative=(error:unknown={message:"Wording can change",codex_error_info:"server_overloaded"})=>writeFileSync(rollout,JSON.stringify(meta)+"\n"+event("task_started","turn-1")+event("task_complete","turn-1",error));
  const nativeDb=new DatabaseSync(resolve(codex,"state_5.sqlite"));nativeDb.exec("CREATE TABLE threads(id TEXT PRIMARY KEY,rollout_path TEXT)");nativeDb.prepare("INSERT INTO threads VALUES('thread',?)").run(rollout);nativeDb.close();
  writeFileSync(resolve(bin,"tmux"),`#!${process.execPath}\nimport{appendFileSync}from'node:fs';const a=process.argv.slice(2);if(a[0]==='display-message')console.log('%1\\t123\\tcodex\\t'+process.env.RETRY_TEST_WORKTREE);else if(a[0]==='capture-pane')console.log(process.env.RETRY_TEST_TRANSCRIPT);else if(a[0]==='send-keys'){appendFileSync(process.env.RETRY_TEST_INPUT,JSON.stringify(a)+'\\n');if(process.env.RETRY_TEST_FAIL==='yes')process.exit(1);}else process.exit(2);\n`,{mode:0o700});
  process.env.PATH=bin+delimiter+env.PATH;process.env.CODEX_HOME=codex;process.env.RETRY_TEST_WORKTREE=worktree;
  process.env.RETRY_TEST_TRANSCRIPT="› Ask Codex to do anything";process.env.RETRY_TEST_INPUT=resolve(home,"input.log");process.env.KURAMI_CONTROLLER_ACTION="retry";
  for(const type of ["task_started","turn_aborted","task_complete"]){
    resetNative();appendFileSync(rollout,JSON.stringify({type:"event_msg",payload:{type}})+"\n");
    assert.equal(capturePrimaryAttempt("thread",worktree),null,"a lifecycle marker without identity invalidates previous outcomes");
  }
  resetNative();assert.equal(capturePrimaryAttempt("thread",worktree)?.state,"failed");assert.equal(capturePrimaryStoppedResult("thread",worktree),null,"a failed native task is never a completed primary result");
  observePrimaryAttempt(database,"r_retry");assert.equal(database.prepare("SELECT state FROM runs WHERE run_id='r_retry'").get()?.state,"needs_attention");
  assert.equal(inspectPrimaryRetry(database,"r_retry",project).provider,"codex");
  appendFileSync(rollout,'{"type":');assert.equal(capturePrimaryAttempt("thread",worktree),null,"incomplete native evidence refuses instead of inferring failure from prose");resetNative();
  assert.equal(primaryAgent("claude"),null,"an unsupported provider never falls back to Codex");
  database.exec("UPDATE run_resources SET primary_agent_provider='claude'");assert.throws(()=>inspectPrimaryRetry(database,"r_retry",project),/provider/);database.exec("UPDATE run_resources SET primary_agent_provider='codex'");
  for(const text of ["• Working (2s • esc to interrupt)\n› Ask Codex to do anything","Requested permission\nPress enter to confirm\n› Ask Codex to do anything","› owner is typing"]){assert.equal(emptyPrimaryInput(text),false);process.env.RETRY_TEST_TRANSCRIPT=text;assert.throws(()=>inspectPrimaryRetry(database,"r_retry",project),/busy|input|prompt/);}
  process.env.RETRY_TEST_TRANSCRIPT="› Ask Codex to do anything";
  assert.ok((availableRunControls(database,"r_retry",{home}).available_actions as string[]).includes("retry"));
  const first=requestRunControl(database,"r_retry","retry","discord",true,{home});
  const duplicate=requestRunControl(database,"r_retry","retry","discord",true,{home});assert.equal(first.requestId,duplicate.requestId??duplicate.request_id);
  const id=String(first.requestId);
  for(const [field,value,restore] of [["owner_state","none","cli"],["stop_reason","cancelled",null],["execution_mode","dry_run","live"]] as const){
    database.prepare(`UPDATE runs SET ${field}=? WHERE run_id='r_retry'`).run(value);
    assert.throws(()=>retryPrimary(database,"r_retry",id,project),/not an owner-controlled/);
    database.prepare(`UPDATE runs SET ${field}=? WHERE run_id='r_retry'`).run(restore);
  }
  git(canonical,"remote","set-url","origin","https://github.com/Other/Repo.git");
  assert.throws(()=>inspectPrimaryRetry(database,"r_retry",project,id),/wrong origin/);
  git(canonical,"remote","set-url","origin","https://github.com/Example/Repo.git");
  const head=git(worktree,"rev-parse","HEAD");git(worktree,"commit","--allow-empty","-m","changed head");
  assert.throws(()=>retryPrimary(database,"r_retry",id,project),/Git head changed/);
  git(worktree,"update-ref","refs/heads/task",head);
  assert.equal(database.prepare("SELECT json_extract(retry_context_json,'$.dispatchStartedAt') value FROM run_control_requests WHERE request_id=?").get(id)?.value,null,"refused preflight has no dispatch claim");
  const result=retryPrimary(database,"r_retry",id,project);assert.equal(result.action,"retry_requested");
  assert.equal(readFileSync(process.env.RETRY_TEST_INPUT,"utf8").trim().split("\n").length,2,"one literal message and one Enter");
  assert.equal(database.prepare("SELECT state FROM runs WHERE run_id='r_retry'").get()?.state,"needs_attention","dispatch alone is not confirmation of running");
  assert.throws(()=>retryPrimary(database,"r_retry",id,project),/already attempted/);
  database.exec("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES('r_retry','needs_attention','needs_attention','preview_slot_released','{}')");
  observePrimaryAttempt(database,"r_retry");assert.equal(database.prepare("SELECT state FROM runs WHERE run_id='r_retry'").get()?.state,"needs_attention");
  appendFileSync(rollout,event("task_started","turn-2"));observePrimaryAttempt(database,"r_retry");assert.equal(database.prepare("SELECT state FROM runs WHERE run_id='r_retry'").get()?.state,"running");
  assert.throws(()=>inspectPrimaryRetry(database,"r_retry",project),/not an owner-controlled/);
  database.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(id);
  appendFileSync(rollout,event("task_complete","turn-2",{message:"Different provider wording",codex_error_info:"future_error"}));observePrimaryAttempt(database,"r_retry");
  assert.equal(inspectPrimaryRetry(database,"r_retry",project).turnId,"turn-2","a new failed turn permits another manual request");
  const next=requestRunControl(database,"r_retry","retry","projects",true,{home});process.env.RETRY_TEST_FAIL="yes";
  assert.throws(()=>retryPrimary(database,"r_retry",String(next.requestId),project));delete process.env.RETRY_TEST_FAIL;
  assert.throws(()=>retryPrimary(database,"r_retry",String(next.requestId),project),/already attempted/,"ambiguous input is never automatically replayed");
  appendFileSync(rollout,event("task_started","turn-3")+event("turn_aborted","turn-3"));observePrimaryAttempt(database,"r_retry");
  assert.equal(database.prepare("SELECT state FROM runs WHERE run_id='r_retry'").get()?.state,"needs_attention","manual interruption is never reported as running");
  assert.throws(()=>inspectPrimaryRetry(database,"r_retry",project),/not an owner-controlled/);
  appendFileSync(rollout,event("task_started","turn-4"));observePrimaryAttempt(database,"r_retry");
  assert.equal(database.prepare("SELECT state FROM runs WHERE run_id='r_retry'").get()?.state,"running","a separately authorized chat continuation is reflected after native confirmation");
  assert.equal(readFileSync(resolve(worktree,"source.txt"),"utf8"),"preserved dirty work\n");
  for(const lang of ["en","ru"]){
    const snapshot=syntheticProjectsSnapshot();
    snapshot.items[0]!.runActions!.actions=[{action:"retry",label:"Повторить попытку",enabled:true,confirmation:null,hint:null,state:null}];
    const html=renderProjectsPage(snapshot,new URLSearchParams({item:snapshot.items[0]!.id,lang}));
    assert.match(html,/data-run-action="retry"/);
    assert.ok(html.includes(lang === "en" ? "Retry" : "Повторить попытку"));
  }
  console.log(JSON.stringify({ok:true,nativeFailure:true,manualOnly:true,providerBoundary:true,duplicateClicks:true,approvalAndBusyRefused:true,ambiguousDispatchNotReplayed:true,migrationEvidencePreserved:true,dirtyWorkPreserved:true}));
} finally {
  database.close();for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);
  rmSync(home,{recursive:true,force:true});
}

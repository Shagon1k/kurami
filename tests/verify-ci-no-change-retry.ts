import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canRetryUnchangedCi } from "../src/orchestrator/runtime/ci-no-change-retry.ts";
import { repairPrompt } from "../src/orchestrator/projects/sessions/prompts.ts";

const home=mkdtempSync(resolve(tmpdir(),"kurami-ci-no-change-"));
const env={...process.env,KURAMI_HOME:home};
execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator/state/init-run-store.ts")],{env,stdio:"pipe"});
mkdirSync(resolve(home,"config"),{recursive:true});
for(const file of ["projects.yaml","orchestrator.yaml"])copyFileSync(resolve(import.meta.dirname,"../deploy/config",file),resolve(home,"config",file));
const native=(path:string,args:string[])=>JSON.parse(execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator",path),...args],{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim());
const canonical=resolve(home,"repository"),worktree=resolve(home,"worktrees/task"),bin=resolve(home,"bin");
mkdirSync(canonical);mkdirSync(resolve(home,"worktrees"));mkdirSync(bin);
const realGit=execFileSync("which",["git"],{encoding:"utf8"}).trim();
const git=(dir:string,...args:string[])=>execFileSync(realGit,["-C",dir,...args],{encoding:"utf8",stdio:"pipe"}).trim();
git(canonical,"init","-b","main");git(canonical,"config","user.name","Fixture");git(canonical,"config","user.email","fixture@example.invalid");
writeFileSync(resolve(canonical,"README.md"),"fixture\n");git(canonical,"add","README.md");git(canonical,"commit","-m","fixture");
git(canonical,"remote","add","origin","https://github.com/Shagon1k/PickFlick.git");git(canonical,"worktree","add","-b","task",worktree);
const head=git(worktree,"rev-parse","HEAD"),runId="r_nochange";
const pullPath=resolve(home,"pull.json");
const pull={number:190,state:"open",merged:false,html_url:"https://github.com/Shagon1k/PickFlick/pull/190",
 head:{sha:head,ref:"task",repo:{full_name:"Shagon1k/PickFlick"}},base:{ref:"main",repo:{full_name:"Shagon1k/PickFlick"}}};
writeFileSync(pullPath,JSON.stringify(pull));
writeFileSync(resolve(bin,"git"),`#!${process.execPath}\nimport{execFileSync}from'node:child_process';if(process.argv[2]==='ls-remote')console.log(process.env.FIXTURE_SHA+'\\trefs/heads/task');else process.stdout.write(execFileSync(process.env.FIXTURE_GIT,process.argv.slice(2)));`,{mode:0o700});
writeFileSync(resolve(bin,"gh"),`#!${process.execPath}\nimport{readFileSync}from'node:fs';process.stdout.write(readFileSync(process.env.FIXTURE_PULL));`,{mode:0o700});
writeFileSync(resolve(bin,"tmux"),`#!${process.execPath}\nimport{existsSync,writeFileSync}from'node:fs';const cmd=process.argv[2];if(cmd==='has-session')process.exit(existsSync(process.env.FIXTURE_SESSION)?0:1);else if(cmd==='new-session')writeFileSync(process.env.FIXTURE_SESSION,'started');else if(cmd!=='list-sessions')process.exit(1);`,{mode:0o700});
Object.assign(env,{PATH:bin+":"+process.env.PATH,CODEX_BIN:process.execPath,FIXTURE_SHA:head,FIXTURE_GIT:realGit,FIXTURE_PULL:pullPath,FIXTURE_SESSION:resolve(home,"session")});
const projectFile=resolve(home,"config/projects.yaml");
writeFileSync(projectFile,readFileSync(projectFile,"utf8").replace("/home/shagon1k/_projects/PickFlick",canonical).replace("/home/shagon1k/_projects/.worktrees/pickflick",resolve(home,"worktrees")));
mkdirSync(resolve(home,"secrets"),{mode:0o700});
writeFileSync(resolve(home,"secrets/github.env"),"GH_TOKEN="+"fixture_".repeat(5)+"\n",{mode:0o600});
const database=new DatabaseSync(resolve(home,"state/orchestrator.db"));
try {
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json,processing_state)
    VALUES('e',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'pickflick','item','Issue','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
      VALUES('r_nochange','e','pickflick','item','content','Shagon1k/PickFlick',56,'autonomous','needs_attention','none','live');
    INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id)
      VALUES('r_nochange','provisioned','/tmp/fixture','task','primary');
    INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
      VALUES('rq_first','r_nochange','ci_repair','applied','cli','first');`);
  database.prepare(`INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,
    source_checks_json,attempt_state,codex_thread_id,failure_reason,completed_at)
    VALUES('cra_first',?, 'rq_first',1,?,'failed','[]','needs_attention','fixer',
      'No new PR head appeared after the fixer task',strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run(runId,head);
  database.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES(?,'Shagon1k/PickFlick',190,'https://github.com/Shagon1k/PickFlick/pull/190',?,'failed','[]','fixture',
      strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))`).run(runId,head);
  database.exec(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,thread_id,turn_id,phase,turn_status,stopped_at,released_at)
    VALUES('ct_first','r_nochange','ci_repair','cra_first','cx-fixture','/tmp/fixture','task','fixer','turn','terminal','completed',
      '2026-10-25T20:00:00Z','2026-10-25T20:00:01Z');
    INSERT INTO run_codex_task_events(task_id,event_key,method,thread_id,turn_id,status)
      VALUES('ct_first','terminal:turn','turn/completed','fixer','turn','completed');
    INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES('r_nochange','parked_review','parked_review','ci_repair_task_archived',
      '{"attemptId":"cra_first","repairCodexThreadId":"fixer","restoredCodexThreadId":"primary"}');
    INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES('r_nochange','parked_review','needs_attention','ci_repair_no_new_head','{"attemptId":"cra_first"}');`);
  database.prepare("UPDATE run_resources SET worktree_path=? WHERE run_id=?").run(worktree,runId);
  database.prepare("UPDATE run_codex_tasks SET worktree_path=? WHERE run_id=?").run(worktree,runId);
  assert.equal(canRetryUnchangedCi(database,runId),true);
  const refusals = [
    "UPDATE runs SET owner_state='cli'", "UPDATE runs SET stop_reason='cancelled'", "UPDATE runs SET completion_requested_at='pending',completion_source_event_id='e'",
    "UPDATE run_resources SET previous_codex_thread_id='old'", "UPDATE run_resources SET tmux_session_name='active'",
    "UPDATE run_codex_tasks SET released_at=NULL", "UPDATE run_codex_tasks SET released_at='2026-10-25T19:00:00Z'", "UPDATE run_codex_tasks SET turn_status='failed'",
    "UPDATE run_codex_tasks SET stop_requested='cancel'", "DELETE FROM run_codex_task_events", "DELETE FROM run_state_history WHERE reason='ci_repair_task_archived'",
    "UPDATE run_ci_snapshots SET head_sha='different'", "UPDATE run_ci_snapshots SET aggregate_state='passed'",
    "UPDATE run_ci_snapshots SET last_error='unavailable'", "UPDATE run_ci_snapshots SET last_observed_at='2000-01-01T00:00:00Z'",
    "UPDATE run_ci_repair_attempts SET attempt_number=2", "UPDATE runs SET archived_at='2026-10-25T00:00:00Z'", "UPDATE run_ci_repair_attempts SET result_head_sha='different'",
    "UPDATE run_ci_repair_attempts SET codex_thread_id='unrelated'", "UPDATE run_resources SET branch_name='other'",
    "UPDATE run_state_history SET reason='other_blocker' WHERE reason='ci_repair_no_new_head'",
  ];
  for (const sql of refusals) {
    database.exec("SAVEPOINT refusal");database.exec(sql);
    assert.equal(canRetryUnchangedCi(database,runId),false,sql);
    database.exec("ROLLBACK TO refusal; RELEASE refusal");
  }
  database.exec("SAVEPOINT pr_conflict");
  database.exec(`INSERT INTO project_items(project,item_id,status,first_seen_at,last_seen_at)
    VALUES('pickflick','item','Human Review','2026-10-25T00:00:00Z','2026-10-25T00:00:00Z');
    INSERT INTO project_pr_requests(request_id,project,item_id,run_id,actor_subject,idempotency_key,client_key,action,repository,pr_number,pr_id,head_sha,fingerprint,request_state,created_at,updated_at)
    VALUES('pr','pickflick','item','r_nochange','owner','pr','pr','merge','Shagon1k/PickFlick',190,'PR','head','fingerprint','pending','now','now');`);
  assert.equal(canRetryUnchangedCi(database,runId),false,"Pending PR action blocks a new writer");
  database.exec("ROLLBACK TO pr_conflict; RELEASE pr_conflict");
  database.exec("SAVEPOINT legacy; DROP TABLE run_codex_task_events; DROP TABLE run_codex_tasks");
  assert.equal(canRetryUnchangedCi(database,runId),false,"Legacy runs without native task receipts cannot retry");
  database.exec("ROLLBACK TO legacy; RELEASE legacy");
  const automatic=native("runtime/controller.ts",[]);
  assert.ok(!automatic.plans.some((p:{runId:string;action:string})=>p.runId===runId&&p.action==="repair_start"));
  const controls=native("controls/run.ts",["controls","--project","pickflick","--issue","56"]);
  assert.ok(controls.available_actions.includes("ci_repair"));
  const requested=native("controls/run.ts",["request","--run-id",runId,"--action","ci_repair","--via","cli","--apply"]);
  assert.equal(canRetryUnchangedCi(database,runId,String(requested.requestId)),true);
  assert.equal(canRetryUnchangedCi(database,runId),false,"A second pending control must block another retry");
  const planned=native("runtime/controller.ts",[]);
  assert.ok(planned.plans.some((p:{runId:string;action:string;requestId:string})=>p.runId===runId&&p.action==="repair_start"&&p.requestId===requested.requestId));
  assert.equal(database.prepare("SELECT attempt_state FROM run_ci_repair_attempts WHERE attempt_id='cra_first'").get()!.attempt_state,"needs_attention");
  assert.equal(database.prepare("SELECT state FROM runs WHERE run_id=?").get(runId)!.state,"needs_attention");
  const before=database.prepare("SELECT * FROM run_ci_repair_attempts WHERE attempt_id='cra_first'").get();
  writeFileSync(pullPath,JSON.stringify({...pull,head:{...pull.head,sha:"b".repeat(40)}}));
  assert.throws(()=>native("projects/sessions/manager.ts",["repair","--run-id",runId,"--request-id",requested.requestId,"--apply"]));
  assert.equal(database.prepare("SELECT state FROM runs WHERE run_id=?").get(runId)!.state,"needs_attention","Refusal must roll back the claim");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM run_ci_repair_attempts").get()!.n,1);
  writeFileSync(pullPath,JSON.stringify(pull));
  writeFileSync(resolve(worktree,"untracked.txt"),"preserve");
  assert.throws(()=>native("projects/sessions/manager.ts",["repair","--run-id",runId,"--request-id",requested.requestId,"--apply"]));
  assert.equal(readFileSync(resolve(worktree,"untracked.txt"),"utf8"),"preserve");rmSync(resolve(worktree,"untracked.txt"));
  const sourceArgs=["--run-id",runId,"--action","repair_start","--request-id",requested.requestId,"--apply"];
  const sourceBefore=database.prepare("SELECT * FROM runs WHERE run_id=?").get(runId);
  const sourceResult=native("projects/worktrees/refresh-source.ts",sourceArgs);
  assert.equal(sourceResult.fastForward,false,"A no-change retry cannot refresh or advance the preserved source");
  assert.deepEqual(database.prepare("SELECT * FROM runs WHERE run_id=?").get(runId),sourceBefore);
  database.exec("UPDATE run_state_history SET reason='other_blocker' WHERE reason='ci_repair_no_new_head'");
  assert.throws(()=>native("projects/worktrees/refresh-source.ts",sourceArgs));
  database.exec("UPDATE run_state_history SET reason='ci_repair_no_new_head' WHERE reason='other_blocker'");
  git(worktree,"commit","--allow-empty","-m","unpublished fixture commit");
  const unpublished=git(worktree,"rev-parse","HEAD");
  assert.throws(()=>native("projects/worktrees/refresh-source.ts",sourceArgs));
  assert.equal(git(worktree,"rev-parse","HEAD"),unpublished,"Admission preserves an unexpected local commit");
  git(worktree,"reset","--hard",head);
  const launched=native("runtime/controller.ts",["--apply"]);
  assert.ok(launched.results.some((r:{action:string;status:string})=>r.action==="repair_start"&&r.status==="applied"),"Controller must complete source admission and start the writer");
  assert.equal(database.prepare("SELECT request_state FROM run_control_requests WHERE request_id=?").get(requested.requestId)!.request_state,"applied");
  assert.equal(database.prepare("SELECT state FROM runs WHERE run_id=?").get(runId)!.state,"parked_review");
  assert.equal(database.prepare("SELECT owner_state FROM runs WHERE run_id=?").get(runId)!.owner_state,"cli");
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM run_ci_repair_attempts").get()!.n,2);
  assert.deepEqual(database.prepare("SELECT * FROM run_ci_repair_attempts WHERE attempt_id='cra_first'").get(),before);
  assert.equal(canRetryUnchangedCi(database,runId),false,"The second claim consumes the remaining budget");
  const prompt=repairPrompt({run_id:runId,repository:"Shagon1k/PickFlick",issue_number:56,issue_url:null},
    {attemptNumber:2,sourceHeadSha:head,sourceCiState:"failed",sourceChecks:[],pullRequestUrl:"https://github.com/Shagon1k/PickFlick/pull/190"});
  assert.match(prompt,/investigate test isolation/);assert.match(prompt,/positively verified disposable test database/);
  assert.match(prompt,/Do not disable throttling/);assert.match(prompt,/skip tests/);
  console.log(JSON.stringify({ok:true,ciNoChangeRetry:true,refusalCases:refusals.length,noAutomaticRetry:true,preservedPolicy:true}));
} finally {database.close();rmSync(home,{recursive:true,force:true});}

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { recoverCiNoNewHead, pf33NoHeadEvidence, noHeadRecoveryReason } from "../src/orchestrator/projects/sessions/recover-ci-no-new-head.ts";
import { recordTurnCompleted, taskForSession } from "../src/orchestrator/integrations/codex/task-store.ts";
import { releaseProtocolTask } from "../src/orchestrator/projects/sessions/protocol-session.ts";
import { reconcileCiRepairAttempts } from "../src/orchestrator/runtime/reconcile-ci-repair.ts";
import { baseRunSelect, type RunRow } from "../src/orchestrator/runtime/run-read-model.ts";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";
import { planForRequest } from "../src/orchestrator/runtime/request-plan.ts";

const f = protocolRepository();
const db = f.database;
const oldPath = process.env.PATH;
const oldGh = process.env.GH_BIN;
try {
  const gitBin = execFileSync("which",["git"],{encoding:"utf8"}).trim();
  const git = (...args:string[]) => execFileSync(gitBin,["-C",f.worktree,...args],{encoding:"utf8"}).trim();
  const evidence = {...pf33NoHeadEvidence,runId:"run",project:"fixture",repository:"Fixture/Repo",issueNumber:1,
    taskId:f.id,branch:"fixture",sourceSha:git("rev-parse","HEAD"),predecessorThreadId:"main-thread"};
  const project = {repository:evidence.repository,workspace:{canonical_repository:f.canonical,worktree_root:f.root,base_branch:"main"}};
  git("remote","add","origin","https://github.com/Fixture/Repo.git");
  git("update-ref","refs/remotes/origin/fixture",evidence.sourceSha);
  const prUrl=`https://github.com/${evidence.repository}/pull/${evidence.pullNumber}`;
  const reviewUrl=prUrl+"#pullrequestreview-42";
  const pull={number:evidence.pullNumber,html_url:prUrl,state:"open",merged:false,
    head:{sha:evidence.sourceSha,ref:evidence.branch,repo:{full_name:evidence.repository}},
    base:{sha:evidence.sourceSha,ref:"main",repo:{full_name:evidence.repository}}};
  const published={id:42,commit_id:evidence.sourceSha,html_url:reviewUrl,state:"COMMENTED",submitted_at:new Date().toISOString()};
  const livePath=resolve(f.root,"live.json");
  const live={pull,published,remoteSha:evidence.sourceSha};
  const save=()=>writeFileSync(livePath,JSON.stringify(live));save();
  // Only the read-only external network boundaries are substituted. Git worktree checks are real.
  writeFileSync(resolve(f.root,"git"),`#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');\nconst args=process.argv.slice(2);\nif(args[0]==='ls-remote'){const f=JSON.parse(fs.readFileSync(${JSON.stringify(livePath)},'utf8'));process.stdout.write(f.remoteSha+'\\trefs/heads/fixture\\n');}\nelse{const r=cp.spawnSync(${JSON.stringify(gitBin)},args,{stdio:'inherit'});process.exit(r.status??1);}\n`,{mode:0o700});
  writeFileSync(resolve(f.root,"gh"),`#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);\nif(args[0]!=='api'||args[1]!=='--method'||args[2]!=='GET')process.exit(2);\nconst f=JSON.parse(fs.readFileSync(${JSON.stringify(livePath)},'utf8'));process.stdout.write(JSON.stringify(args[3].endsWith('/reviews/42')?f.published:f.pull));\n`,{mode:0o700});
  const tmuxPath=resolve(f.root,"tmux");
  const noTmux=()=>writeFileSync(tmuxPath,"#!/bin/sh\nexit 1\n",{mode:0o700});noTmux();
  process.env.PATH=`${f.root}:${oldPath}`;process.env.GH_BIN=resolve(f.root,"gh");
  db.prepare("UPDATE run_codex_tasks SET context_id=?,thread_id='repair-thread',turn_id='turn' WHERE task_id=?").run(evidence.attemptId,f.id);
  db.exec("UPDATE run_resources SET codex_thread_id='repair-thread',previous_codex_thread_id='main-thread'");
  for (const [id,n,request,state,reason] of [["old",1,"old-request","needs_attention","legacy_ci_repair_completed_billing_block"],
    [evidence.attemptId,2,"latest-request","running",null]] as const) {
    db.prepare(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
      VALUES (?,'run','ci_repair','applied','cli',?)`).run(request,request);
    db.prepare(`INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,
      source_checks_json,attempt_state,codex_thread_id,failure_reason) VALUES (?,'run',?,? ,?,'failed','[]',?,'repair-thread',?)`)
      .run(id,request,n,evidence.sourceSha,state,reason);
  }
  assert.ok(recordTurnCompleted(db,f.id,{method:"turn/completed",params:{threadId:"repair-thread",turn:{id:"turn",status:"completed"}}}));
  db.prepare("UPDATE run_codex_tasks SET stopped_at=? WHERE task_id=?").run(new Date().toISOString(),f.id);
  releaseProtocolTask(db,taskForSession(db,f.task.session_name)!,"parked_review","codex_protocol_park_completed");
  db.exec("UPDATE run_resources SET codex_thread_id='main-thread',previous_codex_thread_id=NULL");
  db.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
    VALUES ('run','parked_review','parked_review','ci_repair_task_archived',?)`).run(JSON.stringify({
      attemptId:evidence.attemptId,attemptNumber:2,repairCodexThreadId:"repair-thread",restoredCodexThreadId:"main-thread"}));
  db.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,
    aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES ('run',?,?,?,'Fixture',?,'failed','[]','digest',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .run(evidence.repository,evidence.pullNumber,prUrl,evidence.sourceSha,new Date().toISOString(),new Date().toISOString());
  db.exec("UPDATE run_ci_repair_attempts SET attempt_state='waiting_ci',updated_at='2020-01-01' WHERE attempt_number=2");
  reconcileCiRepairAttempts(db);
  assert.equal(db.prepare("SELECT state FROM runs").get()?.state,"needs_attention");
  db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES ('review-request','run','ai_review','applied','cli','review-request')`);
  db.prepare(`INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,
    pull_request_url,base_ref,base_sha,head_sha,tmux_session_name,github_review_id,github_review_url,important_count,findings_json,completed_at)
    VALUES ('review','run','review-request',1,'ready',?, ?,?,'main',?,?,'review-session','42',?,1,'[{"severity":"important"}]',?)`)
    .run(evidence.repository,evidence.pullNumber,prUrl,evidence.sourceSha,evidence.sourceSha,reviewUrl,new Date().toISOString());
  const tables=["runs","run_resources","run_ci_repair_attempts","run_ai_reviews","run_codex_tasks","run_codex_task_events",
    "run_state_history","run_control_requests","run_ci_snapshots","project_events","run_review_fix_rounds","run_review_fix_threads","run_review_fix_operations"];
  const snapshot=()=>JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  const baseline=snapshot();recoverCiNoNewHead(db,project,false,evidence);assert.equal(snapshot(),baseline);
  const readonly = new DatabaseSync(f.dbPath,{readOnly:true});
  try {recoverCiNoNewHead(readonly,project,false,evidence);} finally {readonly.close();}
  assert.equal(snapshot(),baseline);
  let refusals=0;
  const refuse=(label:string,mutate:()=>void,restore:()=>void)=>{
    mutate();const before=snapshot();assert.throws(()=>recoverCiNoNewHead(db,project,true,evidence),/recovery refused/i,label);
    assert.equal(snapshot(),before,`${label} changed state`);restore();refusals++;
  };
  const sql=(s:string)=>()=>{db.exec(s);};
  const field=(table:string,name:string,wrong:string,right:string,where="")=>refuse(`${table}.${name}`,
    sql(`UPDATE ${table} SET ${name}=${wrong} ${where}`),sql(`UPDATE ${table} SET ${name}=${right} ${where}`));
  field("runs","state","'running'","'needs_attention'");
  field("runs","owner_state","'remote'","'none'");
  field("runs","stop_reason","'cancelled'","NULL");
  field("runs","repository","'Other/Repo'","'Fixture/Repo'");
  field("run_resources","previous_codex_thread_id","'wrong'","NULL");
  field("run_resources","codex_thread_id","'wrong'","'main-thread'");
  field("run_resources","tmux_session_name","'live'","NULL");
  field("run_state_history","reason","'other_attention'","'ci_repair_no_new_head'","WHERE reason='ci_repair_no_new_head' OR reason='other_attention'");
  field("run_ci_repair_attempts","attempt_id","'wrong'",`'${evidence.attemptId}'`,"WHERE attempt_number=2");
  field("run_ci_repair_attempts","source_head_sha","'0000000'",`'${evidence.sourceSha}'`,"WHERE attempt_number=2");
  field("run_ci_repair_attempts","result_head_sha","'0000000'","NULL","WHERE attempt_number=2");
  field("run_codex_tasks","turn_status","'failed'","'completed'");
  field("run_codex_tasks","phase","'running'","'terminal'");
  field("run_codex_tasks","failure_code","'permission_request_denied'","NULL");
  for(const name of ["stopped_at","released_at"]){const value=String(db.prepare(`SELECT ${name} value FROM run_codex_tasks`).get()?.value);field("run_codex_tasks",name,"NULL",`'${value}'`);}
  field("run_codex_tasks","kind","'review_fix'","'ci_repair'");
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json)
    VALUES ('other-event','2026-01-01','fixture','other-item','Issue','{}');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
    VALUES ('other-run','other-event','fixture','other-item','other-content','Fixture/Repo',2,'autonomous','running','live')`);
  field("run_codex_tasks","run_id","'other-run'","'run'");
  db.exec("DELETE FROM runs WHERE run_id='other-run'; DELETE FROM project_events WHERE event_id='other-event'");
  field("run_codex_tasks","context_id","'wrong'",`'${evidence.attemptId}'`);
  field("run_codex_tasks","thread_id","'wrong'","'repair-thread'");
  field("run_codex_tasks","turn_id","'wrong'","'turn'");
  field("run_codex_tasks","worktree_path","'/tmp/wrong'",`'${f.worktree}'`);
  field("run_codex_tasks","branch_name","'wrong'","'fixture'");
  field("run_codex_task_events","status","'failed'","'completed'");
  field("run_state_history","details_json","'{}'",`'${JSON.stringify({attemptId:evidence.attemptId,attemptNumber:2,repairCodexThreadId:"repair-thread",restoredCodexThreadId:"main-thread"})}'`,"WHERE reason='ci_repair_task_archived'");
  field("run_ai_reviews","review_state","'superseded'","'ready'");
  field("run_ai_reviews","head_sha","'0000000'",`'${evidence.sourceSha}'`);
  field("run_ai_reviews","base_sha","'0000000'",`'${evidence.sourceSha}'`);
  field("run_ai_reviews","findings_json","NULL","'[{\"severity\":\"important\"}]'");
  field("run_ai_reviews","completed_at","NULL",`'${db.prepare("SELECT completed_at FROM run_ai_reviews").get()?.completed_at}'`);
  field("run_ci_snapshots","last_observed_at","'2020-01-01'",`'${new Date().toISOString()}'`);
  field("run_ci_snapshots","head_sha","'0000000'",`'${evidence.sourceSha}'`);
  field("run_ci_snapshots","aggregate_state","'passed'","'failed'");
  refuse("pending control",sql("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES ('pending','run','review_fix','cli','pending')"),sql("DELETE FROM run_control_requests WHERE request_id='pending'"));
  refuse("newer attention",sql("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES ('run','needs_attention','needs_attention','other_attention','{}')"),sql("DELETE FROM run_state_history WHERE reason='other_attention'"));
  refuse("unreleased competing task",()=>db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name)
    VALUES ('competing','run','ci_repair','unknown','other-session',?,'fixture')`).run(f.worktree),sql("DELETE FROM run_codex_tasks WHERE task_id='competing'"));
  refuse("pending Project mutation",sql(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,from_status,to_status,payload_json)
    VALUES ('pending-event','2026-01-01','fixture','item','Issue','Human Review','Done','{}')`),sql("DELETE FROM project_events WHERE event_id='pending-event'"));
  const oldAttempt=db.prepare("SELECT * FROM run_ci_repair_attempts WHERE attempt_number=1").get()!;
  refuse("unexhausted budget",sql("DELETE FROM run_ci_repair_attempts WHERE attempt_number=1"),()=>{
    const keys=Object.keys(oldAttempt);db.prepare(`INSERT INTO run_ci_repair_attempts(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(oldAttempt));
  });
  const readyReview=db.prepare("SELECT * FROM run_ai_reviews").get()!;
  refuse("missing ready review",sql("DELETE FROM run_ai_reviews"),()=>{
    const keys=Object.keys(readyReview);db.prepare(`INSERT INTO run_ai_reviews(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(readyReview));
  });
  field("run_ai_reviews","findings_json","'[]'","'[{\"severity\":\"important\"}]'");
  field("run_ci_snapshots","last_error","'unavailable'","NULL");
  field("run_codex_tasks","stop_requested","'timeout'","NULL");
  refuse("dirty copy",()=>writeFileSync(resolve(f.worktree,"dirty"),"dirty"),()=>rmSync(resolve(f.worktree,"dirty")));
  refuse("local branch",()=>git("symbolic-ref","HEAD","refs/heads/main"),()=>git("symbolic-ref","HEAD","refs/heads/fixture"));
  refuse("tracking SHA",()=>git("update-ref","-d","refs/remotes/origin/fixture"),()=>git("update-ref","refs/remotes/origin/fixture",evidence.sourceSha));
  refuse("live remote SHA",()=>{live.remoteSha="0000000";save();},()=>{live.remoteSha=evidence.sourceSha;save();});
  refuse("live PR SHA",()=>{pull.head.sha="0000000";save();},()=>{pull.head.sha=evidence.sourceSha;save();});
  refuse("live PR branch",()=>{pull.head.ref="wrong";save();},()=>{pull.head.ref=evidence.branch;save();});
  refuse("live PR closed",()=>{pull.state="closed";save();},()=>{pull.state="open";save();});
  refuse("live review dismissed",()=>{published.state="DISMISSED";save();},()=>{published.state="COMMENTED";save();});
  refuse("live review commit",()=>{published.commit_id="0000000";save();},()=>{published.commit_id=evidence.sourceSha;save();});
  refuse("live supervisor",()=>writeFileSync(tmuxPath,"#!/bin/sh\nexit 0\n",{mode:0o700}),noTmux);
  refuse("other worktree pane",()=>writeFileSync(tmuxPath,`#!/bin/sh\nif [ "$1" = list-panes ]; then echo '${f.worktree}'; exit 0; fi\nexit 1\n`,{mode:0o700}),noTmux);
  const writer=resolve(f.root,"codex");writeFileSync(writer,"#!/bin/sh\nsleep 30\n",{mode:0o700});
  const child=spawn(writer,[],{cwd:f.worktree,stdio:"ignore"});
  try {await new Promise<void>(done=>setTimeout(done,100));const before=snapshot();
    assert.throws(()=>recoverCiNoNewHead(db,project,true,evidence),/live writer/);assert.equal(snapshot(),before);refusals++;
  } finally {child.kill("SIGTERM");await new Promise<void>(done=>child.once("exit",()=>done()));}
  const before=snapshot();recoverCiNoNewHead(db,project,false,evidence);assert.equal(snapshot(),before);
  const preserved=tables.filter(t=>t!=="runs"&&t!=="run_state_history");
  const preservedBefore=JSON.stringify(preserved.map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  const historyBefore=db.prepare("SELECT * FROM run_state_history ORDER BY sequence").all();
  db.exec(`CREATE TRIGGER recovery_failure BEFORE INSERT ON run_state_history WHEN NEW.reason='${noHeadRecoveryReason}'
    BEGIN SELECT RAISE(ABORT,'fixture recovery persistence failure'); END`);
  const atomicBefore=snapshot();assert.throws(()=>recoverCiNoNewHead(db,project,true,evidence),/fixture recovery persistence failure/);
  assert.equal(snapshot(),atomicBefore);db.exec("DROP TRIGGER recovery_failure");
  recoverCiNoNewHead(db,project,true,evidence);
  assert.equal(db.prepare("SELECT state FROM runs").get()?.state,"parked_review");
  assert.equal(db.prepare("SELECT owner_state FROM runs").get()?.owner_state,"none");
  assert.equal(JSON.stringify(preserved.map(t=>db.prepare(`SELECT * FROM ${t}`).all())),preservedBefore);
  const historyAfter=db.prepare("SELECT * FROM run_state_history ORDER BY sequence").all();
  assert.deepEqual(historyAfter.slice(0,-1),historyBefore);assert.equal(historyAfter.at(-1)?.reason,noHeadRecoveryReason);
  const after=snapshot();assert.equal((recoverCiNoNewHead(db,project,true,evidence) as {alreadyRecovered:boolean}).alreadyRecovered,true);
  assert.equal(snapshot(),after);recoverCiNoNewHead(db,project,false,evidence);assert.equal(snapshot(),after);
  // The existing controller/request actions remain safe across repeated reconciliations.
  for(let i=0;i<3;i++)reconcileCiRepairAttempts(db);
  assert.equal(snapshot(),after);
  const run=db.prepare(baseRunSelect()+" WHERE r.run_id='run'").get() as RunRow;
  assert.equal(run.repair_attempt_count,2);
  assert.equal(planAutomatic(run,{projects:{fixture:{statuses:{active:"In progress",review:"Human Review",backlog:"Backlog"}}}},()=>false),null);
  assert.equal(planForRequest({...run,request_id:"retry",requested_action:"ci_repair"},{limits:{preview_expiry_warning_hours:1}}).action,"request_reject");
  assert.equal(planForRequest({...run,request_id:"fix",requested_action:"review_fix"},{limits:{preview_expiry_warning_hours:1}}).action,"review_fix_start");
  // Replays do not bypass current guards.
  refuse("replay after drift",()=>{pull.head.sha="0000000";save();},()=>{pull.head.sha=evidence.sourceSha;save();});
  assert.throws(()=>execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator/projects/sessions/recover-ci-no-new-head.ts"),"--run-id","wrong"],
    {encoding:"utf8",stdio:["ignore","pipe","pipe"]}),error => String((error as {stderr?:unknown}).stderr).includes("use --run-id <allowlisted run>"));
  process.stdout.write(JSON.stringify({ok:true,protocolCiNoHeadRecovery:true,refusals,dryRunReadOnly:true,historyPreserved:true,idempotent:true,repairRetry:false})+"\n");
} finally {
  process.env.PATH=oldPath;if(oldGh===undefined)delete process.env.GH_BIN;else process.env.GH_BIN=oldGh;
  f.database.close();rmSync(f.root,{recursive:true,force:true});
}

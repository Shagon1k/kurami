import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { recoverExternalCiDelivery, pf34ExternalEvidence, externalDeliveryReason, externalDeliveryChecks } from "../src/orchestrator/projects/sessions/recover-external-ci-delivery.ts";
import { recordTurnCompleted, taskForSession } from "../src/orchestrator/integrations/codex/task-store.ts";
import { releaseProtocolTask } from "../src/orchestrator/projects/sessions/protocol-session.ts";
import { reconcileCiRepairAttempts } from "../src/orchestrator/runtime/reconcile-ci-repair.ts";
import { baseRunSelect, type RunRow } from "../src/orchestrator/runtime/run-read-model.ts";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";

const f = protocolRepository();
const db = f.database;
const oldPath = process.env.PATH;
const oldGh = process.env.GH_BIN;
try {
  const gitBin = execFileSync("which",["git"],{encoding:"utf8"}).trim();
  const git = (...args:string[]) => execFileSync(gitBin,["-C",f.worktree,...args],{encoding:"utf8"}).trim();
  const evidence = {...pf34ExternalEvidence,runId:"run",project:"fixture",repository:"Fixture/Repo",issueNumber:1,
    taskId:f.id,branch:"fixture",sourceSha:git("rev-parse","HEAD"),predecessorThreadId:"main-thread",
    itemId:"item",worktree:f.worktree,canonical:f.canonical,threadId:"repair-thread",turnId:"turn",
    sessionName:f.task.session_name, externalSha:"", completedAt:"",stoppedAt:"",releasedAt:"",releaseSequence:0,archiveSequence:0,attentionSequence:0};
  const tree=git("mktree");
  evidence.externalSha=git("-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit-tree",tree,
    "-p",evidence.sourceSha,"-m","Owner-approved external delivery");
  git("update-ref","refs/heads/fixture",evidence.externalSha);

  const project = {repository:evidence.repository,workspace:{canonical_repository:f.canonical,worktree_root:f.root,base_branch:"main"}};
  git("remote","add","origin","https://github.com/Fixture/Repo.git");
  git("update-ref","refs/remotes/origin/fixture",evidence.externalSha);
  const prUrl=`https://github.com/${evidence.repository}/pull/${evidence.pullNumber}`;
  const pull={number:evidence.pullNumber,html_url:prUrl,state:"open",merged:false,draft:true,
    head:{sha:evidence.externalSha,ref:evidence.branch,repo:{full_name:evidence.repository}},
    base:{sha:evidence.sourceSha,ref:"main",repo:{full_name:evidence.repository}}};
  const native={total_count:6,check_runs:externalDeliveryChecks.map((name,i)=>({name,head_sha:evidence.externalSha,
    check_suite:{id:123},app:{slug:"github-actions"},status:"completed",conclusion:"success",
    html_url:`https://github.com/${evidence.repository}/actions/runs/123/job/${i+1}`,
    completed_at:new Date().toISOString()}))};
  const checks=()=>JSON.stringify(native.check_runs.map(c=>({name:c.name,state:"passed",source:"check_run",detailsUrl:c.html_url})));
  const livePath=resolve(f.root,"live.json");
  const live={pull,native,remoteSha:evidence.externalSha};
  const save=()=>writeFileSync(livePath,JSON.stringify(live));save();
  // Only the read-only external network boundaries are substituted. Git worktree checks are real.
  writeFileSync(resolve(f.root,"git"),`#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');\nconst args=process.argv.slice(2);\nif(args[0]==='ls-remote'){const f=JSON.parse(fs.readFileSync(${JSON.stringify(livePath)},'utf8'));process.stdout.write(f.remoteSha+'\\trefs/heads/fixture\\n');}\nelse{const r=cp.spawnSync(${JSON.stringify(gitBin)},args,{stdio:'inherit'});process.exit(r.status??1);}\n`,{mode:0o700});
  writeFileSync(resolve(f.root,"gh"),`#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);\nif(args[0]!=='api'||args[1]!=='--method'||args[2]!=='GET')process.exit(2);\nconst f=JSON.parse(fs.readFileSync(${JSON.stringify(livePath)},'utf8'));process.stdout.write(JSON.stringify(args[3].includes('/check-runs?')?f.native:f.pull));\n`,{mode:0o700});
  const tmuxPath=resolve(f.root,"tmux");
  const noTmux=()=>writeFileSync(tmuxPath,"#!/bin/sh\nexit 1\n",{mode:0o700});noTmux();
  process.env.PATH=`${f.root}:${oldPath}`;process.env.GH_BIN=resolve(f.root,"gh");
  db.prepare("UPDATE run_codex_tasks SET context_id=?,thread_id='repair-thread',turn_id='turn' WHERE task_id=?").run(evidence.attemptId,f.id);
  db.exec("UPDATE run_resources SET codex_thread_id='repair-thread',previous_codex_thread_id='main-thread'");
  db.prepare(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES (?,'run','ci_repair','applied','cli',?)`).run(evidence.requestId,evidence.requestId);
  db.prepare(`INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,
    source_checks_json,attempt_state,codex_thread_id) VALUES (?,'run',?,1,?,'failed','[]','running','repair-thread')`)
    .run(evidence.attemptId,evidence.requestId,evidence.sourceSha);
  db.exec("UPDATE runs SET state='parked_review',preview_required=1,preview_required_label='preview-required'");
  assert.ok(recordTurnCompleted(db,f.id,{method:"turn/completed",params:{threadId:"repair-thread",turn:{id:"turn",status:"completed"}}}));
  db.prepare("UPDATE run_codex_tasks SET stopped_at=? WHERE task_id=?").run(new Date().toISOString(),f.id);
  releaseProtocolTask(db,taskForSession(db,f.task.session_name)!,"parked_review","codex_protocol_park_completed");
  db.exec("UPDATE run_resources SET codex_thread_id='main-thread',previous_codex_thread_id=NULL");
  db.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
    VALUES ('run','parked_review','parked_review','ci_repair_task_archived',?)`).run(JSON.stringify({
      attemptId:evidence.attemptId,attemptNumber:1,repairCodexThreadId:"repair-thread",restoredCodexThreadId:"main-thread"}));
  db.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,
    aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES ('run',?,?,?,'Fixture',?,'failed','[]','digest',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .run(evidence.repository,evidence.pullNumber,prUrl,evidence.sourceSha,new Date().toISOString(),new Date().toISOString());
  db.exec("UPDATE run_ci_repair_attempts SET attempt_state='waiting_ci',updated_at='2020-01-01' WHERE attempt_number=1");
  reconcileCiRepairAttempts(db);
  assert.equal(db.prepare("SELECT state FROM runs").get()?.state,"needs_attention");
  const taskRow=db.prepare("SELECT * FROM run_codex_tasks WHERE task_id=?").get(f.id)!;
  evidence.stoppedAt=String(taskRow.stopped_at);evidence.releasedAt=String(taskRow.released_at);
  evidence.completedAt=String(db.prepare("SELECT completed_at FROM run_ci_repair_attempts").get()!.completed_at);
  const seq=(reason:string)=>Number(db.prepare("SELECT sequence FROM run_state_history WHERE reason=?").get(reason)!.sequence);
  evidence.releaseSequence=seq("codex_protocol_park_completed");evidence.archiveSequence=seq("ci_repair_task_archived");
  evidence.attentionSequence=seq("ci_repair_no_new_head");
  // Existing release fixture emits undefined restoredThreadId when none was restored.
  const receipt=JSON.parse(String(db.prepare("SELECT details_json FROM run_state_history WHERE reason='codex_protocol_park_completed'").get()!.details_json));
  receipt.restoredThreadId=null;
  db.prepare("UPDATE run_state_history SET details_json=? WHERE reason='codex_protocol_park_completed'").run(JSON.stringify(receipt));
  db.prepare("UPDATE run_ci_snapshots SET head_sha=?,aggregate_state='passed',checks_json=?,last_observed_at=?")
    .run(evidence.externalSha,checks(),new Date().toISOString());
  const tables=["runs","run_resources","run_ci_repair_attempts","run_ai_reviews","run_codex_tasks","run_codex_task_events",
    "run_state_history","run_control_requests","run_ci_snapshots","project_events","run_review_fix_rounds","run_review_fix_threads","run_review_fix_operations"];
  const snapshot=()=>JSON.stringify(tables.map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  const baseline=snapshot();recoverExternalCiDelivery(db,project,false,evidence);assert.equal(snapshot(),baseline);
  const readonly = new DatabaseSync(f.dbPath,{readOnly:true});
  try {recoverExternalCiDelivery(readonly,project,false,evidence);} finally {readonly.close();}
  assert.equal(snapshot(),baseline);
  let refusals=0;
  const refuse=(label:string,mutate:()=>void,restore:()=>void)=>{
    mutate();const before=snapshot();assert.throws(()=>recoverExternalCiDelivery(db,project,true,evidence),/recovery refused/i,label);
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
  field("run_ci_repair_attempts","attempt_id","'wrong'",`'${evidence.attemptId}'`,"WHERE attempt_number=1");
  field("run_ci_repair_attempts","source_head_sha","'0000000'",`'${evidence.sourceSha}'`,"WHERE attempt_number=1");
  field("run_ci_repair_attempts","result_head_sha","'0000000'","NULL","WHERE attempt_number=1");
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
  field("run_state_history","details_json","'{}'",`'${JSON.stringify({attemptId:evidence.attemptId,attemptNumber:1,repairCodexThreadId:"repair-thread",restoredCodexThreadId:"main-thread"})}'`,"WHERE reason='ci_repair_task_archived'");
  field("run_ci_snapshots","last_observed_at","'2020-01-01'",`'${new Date().toISOString()}'`);
  field("run_ci_snapshots","head_sha","'0000000'",`'${evidence.externalSha}'`);
  field("run_ci_snapshots","aggregate_state","'failed'","'passed'");
  refuse("pending control",sql("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES ('pending','run','review_fix','cli','pending')"),sql("DELETE FROM run_control_requests WHERE request_id='pending'"));
  refuse("newer attention",sql("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES ('run','needs_attention','needs_attention','other_attention','{}')"),sql("DELETE FROM run_state_history WHERE reason='other_attention'"));
  refuse("unreleased competing task",()=>db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name)
    VALUES ('competing','run','ci_repair','unknown','other-session',?,'fixture')`).run(f.worktree),sql("DELETE FROM run_codex_tasks WHERE task_id='competing'"));
  refuse("pending Project mutation",sql(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,from_status,to_status,payload_json)
    VALUES ('pending-event','2026-01-01','fixture','item','Issue','Human Review','Done','{}')`),sql("DELETE FROM project_events WHERE event_id='pending-event'"));
  refuse("unexpected AI lineage",sql(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES ('review','run','ai_review','applied','cli','review');
    INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,repository,tmux_session_name,review_state,
      pull_request_number,pull_request_url,base_ref,base_sha,head_sha)
    VALUES ('review','run','review',1,'Fixture/Repo','rv-fixture','running',157,
      'https://github.com/Fixture/Repo/pull/157','main','0000000','0000000')`),sql("DELETE FROM run_ai_reviews; DELETE FROM run_control_requests WHERE request_id='review'"));
  for(const owner of ["cli","remote"])field("runs","owner_state",`'${owner}'`,"'none'");
  field("run_codex_tasks","final_summary","'invented worker output'","NULL");
  field("run_ci_repair_attempts","attempt_number","2","1");
  field("run_control_requests","request_state","'rejected'","'applied'");
  field("run_codex_task_events","event_key","'terminal:wrong'","'terminal:turn'");
  field("run_state_history","sequence","9999",String(evidence.archiveSequence),"WHERE reason='ci_repair_task_archived'");
  field("run_ci_snapshots","last_error","'unavailable'","NULL");
  field("run_codex_tasks","stop_requested","'timeout'","NULL");
  refuse("dirty copy",()=>writeFileSync(resolve(f.worktree,"dirty"),"dirty"),()=>rmSync(resolve(f.worktree,"dirty")));
  refuse("local branch",()=>git("symbolic-ref","HEAD","refs/heads/main"),()=>git("symbolic-ref","HEAD","refs/heads/fixture"));
  refuse("tracking SHA",()=>git("update-ref","-d","refs/remotes/origin/fixture"),()=>git("update-ref","refs/remotes/origin/fixture",evidence.externalSha));
  refuse("live remote SHA",()=>{live.remoteSha="0000000";save();},()=>{live.remoteSha=evidence.externalSha;save();});
  refuse("live PR SHA",()=>{pull.head.sha="0000000";save();},()=>{pull.head.sha=evidence.externalSha;save();});
  refuse("live PR branch",()=>{pull.head.ref="wrong";save();},()=>{pull.head.ref=evidence.branch;save();});
  refuse("live PR closed",()=>{pull.state="closed";save();},()=>{pull.state="open";save();});
  refuse("native check failed",()=>{native.check_runs[0].conclusion="failure";save();},()=>{native.check_runs[0].conclusion="success";save();});
  refuse("native check stale SHA",()=>{native.check_runs[0].head_sha=evidence.sourceSha;save();},()=>{native.check_runs[0].head_sha=evidence.externalSha;save();});
  const link=native.check_runs[0].html_url;
  refuse("native bad receipt link",()=>{native.check_runs[0].html_url="https://evil.invalid/secret";save();},()=>{native.check_runs[0].html_url=link;save();});
  refuse("native incomplete pagination",()=>{native.total_count=100;save();},()=>{native.total_count=6;save();});
  refuse("PR ready rather than draft",()=>{pull.draft=false;save();},()=>{pull.draft=true;save();});
  field("run_ci_snapshots","checks_json","'[]'",`'${checks()}'`);
  field("run_ci_snapshots","last_observed_at","'2999-01-01'",`'${new Date().toISOString()}'`);
  refuse("live supervisor",()=>writeFileSync(tmuxPath,"#!/bin/sh\nexit 0\n",{mode:0o700}),noTmux);
  refuse("other worktree pane",()=>writeFileSync(tmuxPath,`#!/bin/sh\nif [ "$1" = list-panes ]; then echo '${f.worktree}'; exit 0; fi\nexit 1\n`,{mode:0o700}),noTmux);
  const writer=resolve(f.root,"codex");writeFileSync(writer,"#!/bin/sh\nsleep 30\n",{mode:0o700});
  const child=spawn(writer,[],{cwd:f.worktree,stdio:"ignore"});
  try {await new Promise<void>(done=>setTimeout(done,100));const before=snapshot();
    assert.throws(()=>recoverExternalCiDelivery(db,project,true,evidence),/live writer/);assert.equal(snapshot(),before);refusals++;
  } finally {child.kill("SIGTERM");await new Promise<void>(done=>child.once("exit",()=>done()));}
  const before=snapshot();recoverExternalCiDelivery(db,project,false,evidence);assert.equal(snapshot(),before);
  const preserved=tables.filter(t=>t!=="runs"&&t!=="run_state_history");
  const preservedBefore=JSON.stringify(preserved.map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  const historyBefore=db.prepare("SELECT * FROM run_state_history ORDER BY sequence").all();
  db.exec(`CREATE TRIGGER recovery_failure BEFORE INSERT ON run_state_history WHEN NEW.reason='${externalDeliveryReason}'
    BEGIN SELECT RAISE(ABORT,'fixture recovery persistence failure'); END`);
  const atomicBefore=snapshot();assert.throws(()=>recoverExternalCiDelivery(db,project,true,evidence),/fixture recovery persistence failure/);
  assert.equal(snapshot(),atomicBefore);db.exec("DROP TRIGGER recovery_failure");
  recoverExternalCiDelivery(db,project,true,evidence);
  assert.equal(db.prepare("SELECT state FROM runs").get()?.state,"parked_review");
  assert.equal(db.prepare("SELECT owner_state FROM runs").get()?.owner_state,"none");
  assert.equal(JSON.stringify(preserved.map(t=>db.prepare(`SELECT * FROM ${t}`).all())),preservedBefore);
  const historyAfter=db.prepare("SELECT * FROM run_state_history ORDER BY sequence").all();
  assert.deepEqual(historyAfter.slice(0,-1),historyBefore);assert.equal(historyAfter.at(-1)?.reason,externalDeliveryReason);
  const after=snapshot();assert.equal((recoverExternalCiDelivery(db,project,true,evidence) as {alreadyRecovered:boolean}).alreadyRecovered,true);
  assert.equal(snapshot(),after);recoverExternalCiDelivery(db,project,false,evidence);assert.equal(snapshot(),after);
  // The existing controller/request actions remain safe across repeated reconciliations.
  for(let i=0;i<3;i++)reconcileCiRepairAttempts(db);
  assert.equal(snapshot(),after);
  const run=db.prepare(baseRunSelect()+" WHERE r.run_id='run'").get() as RunRow;
  assert.equal(run.repair_attempt_count,1);
  assert.equal(planAutomatic(run,{projects:{fixture:{statuses:{active:"In progress",review:"Human Review",backlog:"Backlog"}}}},()=>false),null);
  assert.equal(run.latest_review_state,null);
  assert.equal(run.preview_required,1);
  assert.equal(db.prepare("SELECT attempt_state FROM run_ci_repair_attempts").get()!.attempt_state,"needs_attention");
  const audit=JSON.parse(String(historyAfter.at(-1)!.details_json));
  assert.equal(audit.workerProducedHead,false);assert.equal(audit.externalHeadSha,evidence.externalSha);
  // Replays do not bypass current guards.
  refuse("replay after drift",()=>{pull.head.sha="0000000";save();},()=>{pull.head.sha=evidence.externalSha;save();});
  assert.throws(()=>execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator/projects/sessions/recover-external-ci-delivery.ts"),"--run-id","wrong"],
    {encoding:"utf8",stdio:["ignore","pipe","pipe"]}),error => String((error as {stderr?:unknown}).stderr).includes("use --run-id <allowlisted run>"));
  process.stdout.write(JSON.stringify({ok:true,externalCiDeliveryRecovery:true,refusals,dryRunReadOnly:true,historyPreserved:true,idempotent:true,repairRetry:false})+"\n");
} finally {
  process.env.PATH=oldPath;if(oldGh===undefined)delete process.env.GH_BIN;else process.env.GH_BIN=oldGh;
  f.database.close();rmSync(f.root,{recursive:true,force:true});
}


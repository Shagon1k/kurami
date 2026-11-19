import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { reconcileExternalCiRepairs } from "../src/orchestrator/projects/ci/reconcile-external-repair.ts";
import { ownerSourceEffects } from "../src/orchestrator/projects/worktrees/refresh-source.ts";
import { externalCiRepairCandidate } from "../src/orchestrator/runtime/reconcile-ci-repair.ts";
const externalDeliveryChecks = ["Secret scan", "Lint", "Integration", "UI", "Images", "Delivery", "Dependency audit", "Architecture"];
const fixtureEvidence = {attemptId:"attempt",requestId:"request",pullNumber:211};
import { recordTurnCompleted, taskForSession } from "../src/orchestrator/integrations/codex/task-store.ts";
import { releaseProtocolTask } from "../src/orchestrator/projects/sessions/protocol-session.ts";
import { reconcileCiRepairAttempts } from "../src/orchestrator/runtime/reconcile-ci-repair.ts";

const f = protocolRepository();
const db = f.database;
const oldPath = process.env.PATH;
const oldGh = process.env.GH_BIN;
try {
  const gitBin = execFileSync("which",["git"],{encoding:"utf8"}).trim();
  const git = (...args:string[]) => execFileSync(gitBin,["-C",f.worktree,...args],{encoding:"utf8"}).trim();
  const evidence = {...fixtureEvidence,runId:"run",project:"fixture",repository:"Fixture/Repo",issueNumber:1,
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
  db.prepare("UPDATE run_ci_snapshots SET head_sha=?,aggregate_state='passed',checks_json=?,last_observed_at=?")
    .run(evidence.externalSha,checks(),new Date().toISOString());
  const reconcile = () => reconcileExternalCiRepairs(db, {fixture:project}, f.root,
    async () => ownerSourceEffects("fixture-token"));
  const snapshot = () => JSON.stringify(["runs","run_resources","run_ci_repair_attempts","run_codex_tasks",
    "run_state_history","run_ci_snapshots","run_control_requests"].map(t=>db.prepare(`SELECT * FROM ${t}`).all()));
  assert.ok(externalCiRepairCandidate(db,"run"), "real archived/released protocol fixture is eligible");
  let refusals = 0;
  const refuse = async (label:string, mutate:()=>void, restore:()=>void) => {
    mutate(); const before=snapshot(); assert.deepEqual(await reconcile(),[],label);
    assert.equal(snapshot(),before,`${label}: no state changes`); restore(); refusals++;
  };
  const field = async (table:string,name:string,wrong:string) => {
    const before=db.prepare(`SELECT ${name} value FROM ${table} LIMIT 1`).get()!.value;
    await refuse(`${table}.${name}`,()=>db.prepare(`UPDATE ${table} SET ${name}=?`).run(wrong),
      ()=>db.prepare(`UPDATE ${table} SET ${name}=?`).run(before!));
  };
  for (const [table,name,value] of [
    ["runs","owner_state","remote"],["runs","state","running"],["runs","execution_mode","dry_run"],
    ["runs","stop_reason","cancelled"],["runs","archived_at","2026-01-01"],
    
    ["run_resources","resource_state","released"],["run_resources","codex_thread_id","wrong"],
    ["run_resources","previous_codex_thread_id","wrong"],["run_resources","tmux_session_name","writer"],
    ["run_codex_tasks","phase","running"],["run_codex_tasks","turn_status","failed"],
    ["run_codex_tasks","context_id","wrong"],["run_codex_tasks","stop_requested","timeout"],
    ["run_ci_repair_attempts","failure_reason","other failure"],["run_ci_repair_attempts","result_head_sha","0000000"],
    ["run_ci_snapshots","last_observed_at","2020-01-01"],["run_ci_snapshots","last_observed_at","2999-01-01"],
    ["run_ci_snapshots","aggregate_state","failed"],["run_ci_snapshots","head_sha",evidence.sourceSha],
    ["run_ci_snapshots","last_error","unavailable"],["run_ci_snapshots","checks_json","[]"],
    ["run_ci_snapshots","checks_json",'[{"state":"failed"}]'],
    ["run_ci_snapshots","repository","Other/Repo"],
  ]) await field(table!,name!,value!);
  await refuse("completion intent",()=>db.exec("UPDATE runs SET completion_requested_at='2026-01-01',completion_source_event_id='event'"),
    ()=>db.exec("UPDATE runs SET completion_requested_at=NULL,completion_source_event_id=NULL"));
  await refuse("newer non-bookkeeping cause",()=>db.exec(`INSERT INTO run_state_history(run_id,from_state,to_state,reason)
    VALUES ('run','needs_attention','needs_attention','other_attention')`),()=>db.exec("DELETE FROM run_state_history WHERE reason='other_attention'"));
  await refuse("pending control",()=>db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key)
    VALUES ('pending','run','ci_repair','cli','pending')`),()=>db.exec("DELETE FROM run_control_requests WHERE request_id='pending'"));
  await refuse("dirty checkout",()=>writeFileSync(resolve(f.worktree,"dirty"),"dirty"),()=>rmSync(resolve(f.worktree,"dirty")));
  await refuse("local head drift",()=>git("update-ref","refs/heads/fixture",evidence.sourceSha),()=>git("update-ref","refs/heads/fixture",evidence.externalSha));
  await refuse("tracking drift",()=>git("update-ref","refs/remotes/origin/fixture",evidence.sourceSha),()=>git("update-ref","refs/remotes/origin/fixture",evidence.externalSha));
  for (const [label,mutate,restore] of [
    ["closed PR",()=>{pull.state="closed";save();},()=>{pull.state="open";save();}],
    ["fork PR",()=>{pull.head.repo.full_name="Other/Repo";save();},()=>{pull.head.repo.full_name=evidence.repository;save();}],
    ["wrong branch",()=>{pull.head.ref="wrong";save();},()=>{pull.head.ref=evidence.branch;save();}],
    ["wrong PR head",()=>{pull.head.sha=evidence.sourceSha;save();},()=>{pull.head.sha=evidence.externalSha;save();}],
    ["wrong remote",()=>{live.remoteSha=evidence.sourceSha;save();},()=>{live.remoteSha=evidence.externalSha;save();}],
    ["tmux writer",()=>writeFileSync(tmuxPath,"#!/bin/sh\nexit 0\n",{mode:0o700}),noTmux],
  ] as const) await refuse(label,mutate,restore);
  for (const [table,where] of [
    ["run_codex_task_events","1=1"],
    ["run_state_history","reason='codex_protocol_park_completed'"],
    ["run_state_history","reason='ci_repair_task_archived'"],
  ]) {
    const rows=db.prepare(`SELECT * FROM ${table} WHERE ${where}`).all();
    await refuse(`missing ${table} ${where}`,()=>db.exec(`DELETE FROM ${table} WHERE ${where}`),()=>{
      for(const row of rows){const keys=Object.keys(row);db.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES (${keys.map(()=>'?').join(',')})`).run(...Object.values(row));}
    });
  }
  await refuse("wrong attempt in attention",()=>db.exec(`UPDATE run_state_history SET details_json='{"attemptId":"wrong"}' WHERE reason='ci_repair_no_new_head'`),
    ()=>db.prepare("UPDATE run_state_history SET details_json=? WHERE reason='ci_repair_no_new_head'").run(JSON.stringify({attemptId:evidence.attemptId,attemptNumber:1,sourceHeadSha:evidence.sourceSha})));
  await refuse("superseding run",()=>db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json)
    VALUES ('new-event','2026-01-01','fixture','item','Issue','{}');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
    VALUES ('new-run','new-event','fixture','item','content','Fixture/Repo',1,'autonomous','cancelled','live')`),
    ()=>db.exec("DELETE FROM runs WHERE run_id='new-run'; DELETE FROM project_events WHERE event_id='new-event'"));
  await refuse("pending Project mutation",()=>db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,from_status,to_status,payload_json)
    VALUES ('pending-event','2026-01-01','fixture','item','Issue','Human Review','Done','{}')`),
    ()=>db.exec("DELETE FROM project_events WHERE event_id='pending-event'"));
  await refuse("unreleased task",()=>db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name)
    VALUES ('competitor','run','ci_repair','other','other-session',?,'fixture')`).run(f.worktree),
    ()=>db.exec("DELETE FROM run_codex_tasks WHERE task_id='competitor'"));
  await refuse("existing review",()=>db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES ('review','run','ai_review','applied','cli','review');
    INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,repository,tmux_session_name,review_state,pull_request_number,pull_request_url,base_ref,base_sha,head_sha)
    VALUES ('review','run','review',1,'Fixture/Repo','rv-fixture','ready',211,'https://github.com/Fixture/Repo/pull/211','main','0000000','0000000')`),
    ()=>db.exec("DELETE FROM run_ai_reviews; DELETE FROM run_control_requests WHERE request_id='review'"));
  await refuse("ambiguous task",()=>db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,released_at)
    VALUES ('duplicate','run','ci_repair',?,'duplicate-session',?,'fixture','2026-01-01')`).run(evidence.attemptId,f.worktree),
    ()=>db.exec("DELETE FROM run_codex_tasks WHERE task_id='duplicate'"));
  await refuse("active successor",()=>db.prepare(`INSERT INTO run_autonomous_successions(succession_id,run_id,request_id,succession_number,succession_state,
    predecessor_thread_id,worktree_path,branch_name,source_head_sha,handoff_context_json)
    VALUES ('successor','run',?,1,'running','main-thread',?,'fixture',?,'{}')`).run(evidence.requestId,f.worktree,evidence.sourceSha),
    ()=>db.exec("DELETE FROM run_autonomous_successions WHERE succession_id='successor'"));
  // PF-69 already has a completed successor; historical lineage is not an active writer.
  db.prepare(`INSERT INTO run_autonomous_successions(succession_id,run_id,request_id,succession_number,succession_state,
    predecessor_thread_id,worktree_path,branch_name,source_head_sha,handoff_context_json)
    VALUES ('parked-successor','run',?,1,'parked','predecessor-thread',?,'fixture',?,'{}')`).run(evidence.requestId,f.worktree,evidence.sourceSha);
  assert.ok(externalCiRepairCandidate(db,"run"), "a parked predecessor succession does not block recovery");
  const candidate=externalCiRepairCandidate(db,"run")!;
  const beforeRace=snapshot();
  assert.deepEqual(await reconcileExternalCiRepairs(db,{fixture:project},f.root,async()=>{
    const effects=ownerSourceEffects("fixture-token");
    return {...effects,remoteHead:(repo,branch)=>{
      const head=effects.remoteHead(repo,branch);
      db.exec("UPDATE run_ci_snapshots SET content_digest='raced'");return head;
    }};
  }),[],"DB changed during network read");
  db.exec("UPDATE run_ci_snapshots SET content_digest='digest'");assert.equal(snapshot(),beforeRace);
  const writer=resolve(f.root,"codex");writeFileSync(writer,"#!/bin/sh\nsleep 30\n",{mode:0o700});
  const child=spawn(writer,[],{cwd:f.worktree,stdio:"ignore"});
  try { await new Promise(done=>setTimeout(done,100));assert.deepEqual(await reconcile(),[]);refusals++; }
  finally {child.kill("SIGTERM");await new Promise(done=>child.once("exit",done));}
  // Production cleanup can archive after the timeout, as needs_attention bookkeeping.
  // Both normal parked cleanup above and this late cleanup must retain the exact cause.
  db.exec(`UPDATE run_state_history SET sequence=(SELECT MAX(sequence)+1 FROM run_state_history),
    from_state='needs_attention',to_state='needs_attention' WHERE reason='ci_repair_task_archived'`);
  assert.ok(externalCiRepairCandidate(db,"run"),"late archive bookkeeping does not replace attention cause");
  const attemptBefore=db.prepare("SELECT * FROM run_ci_repair_attempts").get();
  const historyBefore=db.prepare("SELECT * FROM run_state_history ORDER BY sequence").all();
  db.exec(`CREATE TRIGGER recovery_failure BEFORE INSERT ON run_state_history
    WHEN NEW.reason='ci_repair_external_head_recovered' BEGIN SELECT RAISE(ABORT,'test persistence failure'); END`);
  const beforeFailure=snapshot();
  await assert.rejects(reconcile(), /test persistence failure/);
  assert.equal(snapshot(),beforeFailure);
  db.exec("DROP TRIGGER recovery_failure");
  assert.deepEqual(await reconcile(),["run"]);
  assert.equal(db.prepare("SELECT state FROM runs").get()!.state,"parked_review");
  assert.deepEqual(db.prepare("SELECT * FROM run_ci_repair_attempts").get(),attemptBefore);
  const history=db.prepare("SELECT * FROM run_state_history ORDER BY sequence").all();
  assert.deepEqual(history.slice(0,-1),historyBefore);
  assert.equal(history.at(-1)!.reason,"ci_repair_external_head_recovered");
  assert.equal(JSON.parse(String(history.at(-1)!.details_json)).workerProducedHead,false);
  const after=snapshot();for(let i=0;i<3;i++){assert.deepEqual(await reconcile(),[]);reconcileCiRepairAttempts(db);}
  assert.equal(snapshot(),after);
  assert.equal(candidate.head_sha,evidence.externalSha);
  process.stdout.write(JSON.stringify({ok:true,externalCiOrchestratorRecovery:true,refusals,idempotent:true})+"\n");
} finally {
  process.env.PATH=oldPath;if(oldGh===undefined)delete process.env.GH_BIN;else process.env.GH_BIN=oldGh;
  f.database.close();rmSync(f.root,{recursive:true,force:true});
}

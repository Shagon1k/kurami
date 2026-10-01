import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { pf33RecoveryEvidence, recoverLegacyCiTimeout, legacyCiBillingReason, assertNoLegacyWriter } from "../src/orchestrator/projects/sessions/recover-legacy-ci-timeout.ts";
import { transcriptHasCompletedTurn } from "../src/orchestrator/runtime/codex-terminal.ts";
import { baseRunSelect, type RunRow } from "../src/orchestrator/runtime/run-read-model.ts";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";
import { planForRequest } from "../src/orchestrator/runtime/request-plan.ts";

const f = protocolRepository();
const oldPath = process.env.PATH;
try {
  const git = (...args:string[]) => execFileSync("git",["-C",f.worktree,...args],{encoding:"utf8"}).trim();
  const transcript = "Billing or spending limit blocked CI. No files changed or retries.\nWorked for 50s • 09:50\n\n› Ask Codex to do anything\n";
  assert.ok(transcriptHasCompletedTurn(transcript));
  assert.equal(transcriptHasCompletedTurn(transcript + "Working (esc to interrupt)\n"),false);
  assert.equal(transcriptHasCompletedTurn(transcript + "Would you like to run this command?\n"),false);
  const evidence = {...pf33RecoveryEvidence,runId:"run",project:"fixture",repository:"Fixture/Repo",issueNumber:1,
    branch:"fixture",sourceSha:git("rev-parse","HEAD"),transcriptSha256:createHash("sha256").update(transcript).digest("hex")};
  git("remote","add","origin","https://github.com/Fixture/Repo.git");
  git("update-ref","refs/remotes/origin/fixture",evidence.sourceSha);
  const project = {repository:evidence.repository,workspace:{canonical_repository:f.canonical,worktree_root:f.root}};
  const tailPath=resolve(f.root,`logs/runtime-timeouts/ci_repair-${evidence.attemptId}.txt`);
  mkdirSync(resolve(f.root,"logs/runtime-timeouts"),{recursive:true});writeFileSync(tailPath,transcript);
  writeFileSync(resolve(f.root,"tmux"),"#!/bin/sh\nexit 1\n",{mode:0o700});process.env.PATH=`${f.root}:${oldPath}`;
  const db=f.database;
  db.exec("DELETE FROM run_codex_tasks; UPDATE runs SET state='needs_attention',owner_state='none'; UPDATE run_resources SET tmux_session_name=NULL");
  db.prepare("UPDATE run_resources SET codex_thread_id=?,previous_codex_thread_id=?").run(evidence.threadId,evidence.previousThreadId);
  db.prepare("INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key) VALUES (?,'run','ci_repair','applied','cli','original')").run(evidence.requestId);
  const created="2026-10-01T09:49:49.241Z";
  db.prepare(`INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,source_checks_json,
    attempt_state,codex_thread_id,failure_reason,created_at) VALUES (?,'run',?,1,?,'failed','[]','needs_attention',?,'runtime_budget_exceeded',?)`)
    .run(evidence.attemptId,evidence.requestId,evidence.sourceSha,evidence.threadId,created);
  db.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,aggregate_state,
    checks_json,content_digest,first_observed_at,last_observed_at,completed_at) VALUES ('run',?,?,?,'Fixture PR',?,'failed','[]','fixture',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))`)
    .run(evidence.repository,evidence.pullNumber,`https://github.com/${evidence.repository}/pull/${evidence.pullNumber}`,evidence.sourceSha,new Date().toISOString(),new Date().toISOString());
  db.prepare("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES ('run','parked_review','needs_attention','ci_repair_runtime_budget_exceeded',?)")
    .run(JSON.stringify({runtimeKind:"ci_repair",runtimeId:evidence.attemptId,startedAt:created,tmuxSessionName:evidence.sessionName,
      terminalTailPath:tailPath,tmuxAliveAtStart:true,forced:true,timeoutMinutes:90}));
  const snapshot=()=>JSON.stringify({runs:db.prepare("SELECT * FROM runs").all(),resources:db.prepare("SELECT * FROM run_resources").all(),
    attempts:db.prepare("SELECT * FROM run_ci_repair_attempts").all(),history:db.prepare("SELECT * FROM run_state_history").all()});
  let refusals=0;
  const refuse=(label:string,mutate:()=>void,restore:()=>void)=>{
    mutate();const before=snapshot();assert.throws(()=>recoverLegacyCiTimeout(db,f.root,project,true,evidence),/Legacy CI recovery refused/,label);
    assert.equal(snapshot(),before,`${label} changed state`);restore();refusals++;
  };
  const sql=(value:string)=>()=>{db.exec(value);};
  refuse("cancel",sql("UPDATE runs SET stop_reason='cancelled'"),sql("UPDATE runs SET stop_reason=NULL"));
  refuse("remote",sql("UPDATE runs SET owner_state='remote'"),sql("UPDATE runs SET owner_state='none'"));
  refuse("arbitrary attention",sql("UPDATE run_state_history SET reason='approval_blocked'"),sql("UPDATE run_state_history SET reason='ci_repair_runtime_budget_exceeded'"));
  refuse("task identity",sql("UPDATE run_resources SET codex_thread_id='wrong'"),()=>db.prepare("UPDATE run_resources SET codex_thread_id=?").run(evidence.threadId));
  refuse("source SHA",sql("UPDATE run_ci_repair_attempts SET source_head_sha='0000000000000000000000000000000000000000'"),()=>db.prepare("UPDATE run_ci_repair_attempts SET source_head_sha=?").run(evidence.sourceSha));
  refuse("PR SHA",sql("UPDATE run_ci_snapshots SET head_sha='0000000000000000000000000000000000000000'"),()=>db.prepare("UPDATE run_ci_snapshots SET head_sha=?").run(evidence.sourceSha));
  refuse("wrong PR",sql("UPDATE run_ci_snapshots SET pull_request_number=999"),()=>db.prepare("UPDATE run_ci_snapshots SET pull_request_number=?").run(evidence.pullNumber));
  refuse("stale CI",sql("UPDATE run_ci_snapshots SET last_observed_at='2020-01-01'"),()=>db.prepare("UPDATE run_ci_snapshots SET last_observed_at=?").run(new Date().toISOString()));
  refuse("pending control",sql("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES ('pending','run','stop','cli','pending')"),sql("DELETE FROM run_control_requests WHERE request_id='pending'"));
  refuse("dirty worktree",()=>writeFileSync(resolve(f.worktree,"dirty.txt"),"dirty"),()=>rmSync(resolve(f.worktree,"dirty.txt")));
  refuse("remote SHA",()=>git("update-ref","-d","refs/remotes/origin/fixture"),()=>git("update-ref","refs/remotes/origin/fixture",evidence.sourceSha));
  refuse("changed transcript",()=>writeFileSync(tailPath,transcript+"Requested permission\n"),()=>writeFileSync(tailPath,transcript));
  refuse("live supervisor",()=>writeFileSync(resolve(f.root,"tmux"),"#!/bin/sh\nexit 0\n",{mode:0o700}),()=>writeFileSync(resolve(f.root,"tmux"),"#!/bin/sh\nexit 1\n",{mode:0o700}));
  const bin=resolve(f.root,"codex");writeFileSync(bin,"#!/bin/sh\nsleep 30\n",{mode:0o700});
  const child=spawn(bin,[],{cwd:f.worktree,stdio:"ignore"});
  try { await new Promise<void>(done=>setTimeout(done,100));assert.throws(()=>assertNoLegacyWriter(f.worktree,evidence.sessionName),/live writer/);refusals++; }
  finally {child.kill("SIGTERM");await new Promise<void>(done=>child.once("exit",()=>done()));}
  const before=snapshot();recoverLegacyCiTimeout(db,f.root,project,false,evidence);assert.equal(snapshot(),before);
  recoverLegacyCiTimeout(db,f.root,project,true,evidence);
  const result=db.prepare("SELECT state,owner_state,stop_reason FROM runs").get();assert.deepEqual({...result},{state:"parked_review",owner_state:"none",stop_reason:null});
  const attempt=db.prepare("SELECT attempt_state,source_head_sha,result_head_sha,failure_reason FROM run_ci_repair_attempts").get();
  assert.deepEqual({...attempt},{attempt_state:"needs_attention",source_head_sha:evidence.sourceSha,result_head_sha:null,failure_reason:legacyCiBillingReason});
  const mapping=db.prepare("SELECT codex_thread_id,previous_codex_thread_id,tmux_session_name FROM run_resources").get();
  assert.deepEqual({...mapping},{codex_thread_id:evidence.threadId,previous_codex_thread_id:evidence.previousThreadId,tmux_session_name:null});
  const projected=db.prepare(baseRunSelect()+" WHERE r.run_id='run'").get() as RunRow;
  assert.equal(planAutomatic(projected,{projects:{fixture:{statuses:{backlog:"Backlog",active:"In progress",review:"Human Review"}}}},()=>false),null,
    "Recovery must not schedule cleanup or another writer");
  const config={limits:{preview_expiry_warning_hours:1}};
  assert.equal(planForRequest({...projected,request_id:"retry",requested_action:"ci_repair"},config).action,"request_reject",
    "Preserved identity must fence a new repair attempt");
  assert.equal(planForRequest({...projected,request_id:"control",requested_action:"take_control"},config).reason,"ci_repair_cleanup_pending",
    "Legacy handoff must retain its existing technical-cleanup prerequisite");
  assert.throws(()=>recoverLegacyCiTimeout(db,f.root,project,true,evidence),/fence changed/);
  process.stdout.write(JSON.stringify({ok:true,allowlistedLegacyCiRecovery:true,refusals,dryRunReadOnly:true,identityPreserved:true,cleanupFenced:true,legacyControlFencesPreserved:true,repairRetry:false})+"\n");
} finally {process.env.PATH=oldPath;f.database.close();rmSync(f.root,{recursive:true,force:true});}

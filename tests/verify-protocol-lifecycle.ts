import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { taskForSession } from "../src/orchestrator/integrations/codex/task-store.ts";
import type { StartPlan } from "../src/orchestrator/projects/sessions/session-types.ts";
import { baseRunSelect, type RunRow } from "../src/orchestrator/runtime/run-read-model.ts";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";

const scenario=process.argv[2];
const kind=scenario?.match(/^(ci_repair|review_fix)/u)?.[0];
if(!scenario) {
  const scenarios=["ci_repair","review_fix","ci_repair_cancel","review_fix_cancel","ci_repair_timeout","review_fix_timeout"];
  for (const kind of ["ci_repair","review_fix"]) {
    for (const failure of ["init_failure","thread_start_failure"]) scenarios.push(`${kind}_${failure}`);
    for (const stop of ["cancelled","completed"])
      for (const receipt of ["failed","interrupted"]) scenarios.push(`${kind}_stop_${stop}_${receipt}`);
  }
  for(const scenario of scenarios)
    execFileSync(process.execPath,[import.meta.filename,scenario],{stdio:"inherit",env:process.env});
  process.stdout.write(JSON.stringify({ok:true,launcherWorkerIntegration:true,primary:false,ciRepair:true,reviewFix:true,cancelRelease:true,timeoutRelease:true,exactBinding:true,independentCiOutcome:true,reconcileBeforeCancelCases:8,preBindingFailureCases:4,githubWrites:0})+"\n");
} else {
  assert.ok(kind);
  const preBindingFailure=scenario.endsWith("init_failure") || scenario.endsWith("thread_start_failure");
  const stop=scenario.match(/_stop_(cancelled|completed)_(failed|interrupted)$/u);
  const f=protocolRepository();const oldEnvironment={...process.env};
  try {
    f.database.prepare("DELETE FROM run_codex_tasks WHERE task_id=?").run(f.id);
    f.database.exec(`UPDATE run_resources SET tmux_session_name=NULL;
      UPDATE runs SET state='parked_review',owner_state='none'`);
    const source=execFileSync("git",["-C",f.worktree,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
    f.database.exec(`UPDATE run_resources SET codex_thread_id='previous-human-thread';
      INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key)
      VALUES ('request','run','${kind==="ci_repair" ? "ci_repair" : "review_fix"}','cli','request');
      INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,pull_request_title,head_sha,aggregate_state,
        checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
      VALUES ('run','Fixture/Repo',1,'https://example.invalid/pr/1','Fixture PR','${source}','failed','[]','fixture','2026-01-01','2026-01-01','2026-01-01');`);
    const supervisor=resolve(f.root,"supervisor");mkdirSync(supervisor);
    const bin=resolve(f.root,"bin");mkdirSync(bin);
    mkdirSync(resolve(f.root,"secrets"));writeFileSync(resolve(f.root,"secrets/github.env"),"GH_TOKEN=fixture-writer\n",{mode:0o600});
    const codex=resolve(bin,"codex");
    writeFileSync(codex,`#!/bin/sh\nexec "${process.execPath}" "${resolve(import.meta.dirname,"fixtures/codex-protocol-server.mjs")}"\n`,{mode:0o700});
    writeFileSync(resolve(bin,"tmux"),`#!/bin/sh\nexec "${process.execPath}" "${resolve(import.meta.dirname,"fixtures/protocol-tmux.mjs")}" "$@"\n`,{mode:0o700});
    Object.assign(process.env,{KURAMI_HOME:f.root,PATH:`${bin}:${process.env.PATH}`,PROTOCOL_SUPERVISOR_ROOT:supervisor,
      PROTOCOL_SCENARIO:preBindingFailure ? scenario.slice(kind.length+1) : stop ? stop[2]==="failed" ? "failure" : "interrupted" :
        scenario.endsWith("cancel") ? "cancel" : scenario.endsWith("timeout") ? "timeout" : "success",PROTOCOL_LOG:resolve(f.root,"rpc.log")});
    const {startSession}=await import("../src/orchestrator/projects/sessions/session-start.ts");
    const {loadRun}=await import("../src/orchestrator/projects/sessions/session-shared.ts");
    const {leaveCliSession,cancelCliSession}=await import("../src/orchestrator/projects/sessions/session-stop.ts");
    const {reconcileProtocolTasks,releaseProtocolTask}=await import("../src/orchestrator/projects/sessions/protocol-session.ts");
    const {reconcileCiRepairAttempts}=await import("../src/orchestrator/runtime/reconcile-ci-repair.ts");
    const {reconcileReviewFixRounds}=await import("../src/orchestrator/runtime/reconcile-review-fix.ts");
    const plan:StartPlan={runId:"run",project:"fixture",repository:"Fixture/Repo",issueNumber:1,
      worktreePath:f.worktree,canonicalRepository:f.canonical,branchName:"fixture",tmuxSessionName:`cx-protocol-${kind.replaceAll("_","-")}`,
      launcherPath:resolve(import.meta.dirname,"../bin/launch-codex-session.sh"),codexBin:codex,codexTitle:"Protocol fixture",
      initialPrompt:"Local protocol integration",repair:kind==="ci_repair" ? {
        requestId:"request",attemptId:"attempt",attemptNumber:1,sourceHeadSha:source,sourceCiState:"failed",
        sourceChecks:[],pullRequestNumber:1,pullRequestUrl:"https://example.invalid/pr/1",
      } : null,reviewFix:kind==="review_fix" ? {
        requestId:"request",roundId:"round",roundNumber:1,sourceHeadSha:source,pullRequestNumber:1,
        pullRequestUrl:"https://example.invalid/pr/1",threads:[],summaryOnlyFindings:[],
      } : null};
    await startSession(f.database,loadRun(f.database,"run"),plan,{version:1,mode:"live",limits:{max_tmux_sessions_global:3,
      technical_worker_timeout_minutes:scenario.endsWith("timeout") ? 0 : 90}},true);
    if(scenario.endsWith("cancel")) {
      f.database.exec("UPDATE runs SET stop_reason='cancelled',state='stopping'");
      await cancelCliSession(f.database,loadRun(f.database,"run"),true);
    }
    let task=taskForSession(f.database,plan.tmuxSessionName)!;
    for(let i=0;i<80 && !task.stopped_at;i++) {
      await new Promise<void>((done)=>setTimeout(done,100));task=taskForSession(f.database,plan.tmuxSessionName)!;
    }
    assert.ok(task.stopped_at,JSON.stringify(task));
    assert.equal(task.kind,kind);
    const contextSql=kind==="ci_repair" ? "SELECT attempt_state AS state,failure_reason,codex_thread_id FROM run_ci_repair_attempts" :
      "SELECT round_state AS state,failure_reason,codex_thread_id FROM run_review_fix_rounds";
    const projection=()=>f.database.prepare(baseRunSelect()).get() as RunRow;
    const nextAction=()=>planAutomatic(projection(),{projects:{fixture:{statuses:{backlog:"Backlog",active:"In progress",review:"Human Review"}}}},()=>false)?.action;
    if (preBindingFailure) {
      assert.equal(task.thread_id,null);assert.equal(task.turn_id,null);assert.equal(task.turn_status,null);
      assert.equal(task.failure_code,"protocol_disconnect_or_ambiguous_dispatch");
      const before=loadRun(f.database,"run");
      assert.equal(before.codex_thread_id,null);assert.equal(before.previous_codex_thread_id,"previous-human-thread");
      assert.throws(()=>releaseProtocolTask(f.database,{...task,context_id:"stale-context"},"needs_attention","fixture"),/mapping changed/);
      const blocked=(change:string,restore:string,pattern:RegExp)=>{
        f.database.exec(change);
        try {
          assert.throws(()=>releaseProtocolTask(f.database,taskForSession(f.database,plan.tmuxSessionName)!,"needs_attention","fixture"),pattern);
          const mapping=loadRun(f.database,"run");
          assert.equal(mapping.codex_thread_id,null);assert.equal(mapping.previous_codex_thread_id,"previous-human-thread");
          assert.equal(mapping.tmux_session_name,plan.tmuxSessionName);
          assert.equal(taskForSession(f.database,plan.tmuxSessionName)?.released_at,null);
        } finally { f.database.exec(restore); }
      };
      blocked("UPDATE run_codex_tasks SET stopped_at=NULL",`UPDATE run_codex_tasks SET stopped_at='${task.stopped_at}'`,/stop or ownership fence/);
      blocked("UPDATE runs SET owner_state='remote'","UPDATE runs SET owner_state='cli'",/mapping changed/);
      blocked("UPDATE run_resources SET branch_name='changed'","UPDATE run_resources SET branch_name='fixture'",/mapping changed/);
      blocked("UPDATE run_codex_tasks SET context_id='missing-context'",`UPDATE run_codex_tasks SET context_id='${task.context_id}'`,/task context changed/);
      const contextTable=kind==="ci_repair" ? "run_ci_repair_attempts" : "run_review_fix_rounds";
      blocked(`UPDATE ${contextTable} SET codex_thread_id='other-thread'`,`UPDATE ${contextTable} SET codex_thread_id=NULL`,/task context changed/);
      await reconcileProtocolTasks(f.database,codex);
      const restored=loadRun(f.database,"run");
      assert.equal(restored.run_state,"needs_attention");assert.equal(restored.owner_state,"none");
      assert.equal(restored.tmux_session_name,null);assert.equal(restored.codex_thread_id,"previous-human-thread");
      assert.equal(restored.previous_codex_thread_id,null);assert.equal(restored.worktree_path,f.worktree);
      assert.ok(taskForSession(f.database,plan.tmuxSessionName)?.released_at);
      const context=f.database.prepare(contextSql).get();
      assert.equal(context?.state,"needs_attention");assert.equal(context?.failure_reason,task.failure_code);
      assert.equal(context?.codex_thread_id,null);assert.equal(nextAction(),undefined);
      const rpc=readFileSync(resolve(f.root,"rpc.log"),"utf8");
      const methods=rpc.trim().split("\n").map((line)=>JSON.parse(line).method);
      assert.equal(methods.filter((method)=>method==="initialize").length,1);
      assert.equal(methods.filter((method)=>method==="thread/start").length,scenario.endsWith("thread_start_failure") ? 1 : 0);
      assert.equal(methods.filter((method)=>method==="turn/start").length,0);
      await reconcileProtocolTasks(f.database,codex);
      await assert.rejects(startSession(f.database,restored,plan,{version:1,mode:"live",limits:{max_tmux_sessions_global:3}},true),/not ready for session start/);
      assert.equal(readFileSync(resolve(f.root,"rpc.log"),"utf8"),rpc,"Recovery must not retry, resume or archive an unbound thread");
      assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM run_codex_tasks").get()?.count,1);
    } else if (stop) {
      assert.equal(task.thread_id,"thread-exact");assert.equal(task.turn_id,"turn-exact");
      assert.equal(task.turn_status,stop[2]);
      f.database.prepare("UPDATE runs SET state='stopping',stop_reason=? WHERE run_id='run'").run(stop[1]);
      assert.equal(nextAction(),"cancel_cli");
      // Match controller order: reconciliation runs before cancellation is planned/dispatched.
      await reconcileProtocolTasks(f.database,codex);
      const stopped=loadRun(f.database,"run");
      assert.equal(stopped.run_state,"stopping");assert.equal(stopped.stop_reason,stop[1]);
      assert.equal(stopped.owner_state,"none");assert.equal(stopped.tmux_session_name,null);
      assert.equal(stopped.codex_thread_id,"thread-exact");assert.equal(stopped.previous_codex_thread_id,"previous-human-thread");
      assert.ok(taskForSession(f.database,plan.tmuxSessionName)?.released_at);
      const context=f.database.prepare(contextSql).get();
      assert.equal(context?.state,"needs_attention");assert.equal(context?.failure_reason,task.failure_code);
      assert.equal(nextAction(),kind==="ci_repair" ? "repair_cleanup" : "review_fix_cleanup");
      await reconcileProtocolTasks(f.database,codex);
      assert.equal(loadRun(f.database,"run").run_state,"stopping");
      assert.equal(f.database.prepare("SELECT COUNT(*) AS count FROM run_state_history WHERE to_state='needs_attention'").get()?.count,0);
    } else if(scenario.endsWith("cancel") || scenario.endsWith("timeout")) {
      assert.equal(task.turn_status,"interrupted");
      assert.equal(task.thread_id,"thread-exact");assert.equal(task.turn_id,"turn-exact");
      if(scenario.endsWith("timeout")) await reconcileProtocolTasks(f.database,codex);
      const run=f.database.prepare("SELECT state,owner_state,stop_reason FROM runs").get();
      assert.equal(run?.owner_state,"none");
      assert.equal(run?.state,scenario.endsWith("cancel") ? "stopping" : "needs_attention");
      assert.ok(taskForSession(f.database,plan.tmuxSessionName)?.released_at);
      const context=f.database.prepare(kind==="ci_repair" ? "SELECT attempt_state AS state,failure_reason FROM run_ci_repair_attempts" :
        "SELECT round_state AS state,failure_reason FROM run_review_fix_rounds").get();
      assert.equal(context?.state,"needs_attention");
      assert.equal(context?.failure_reason,scenario.endsWith("cancel") ? "protocol_cancelled" : "runtime_budget_exceeded");
    } else {
    assert.equal(task.turn_status,"completed");
    assert.equal(task.thread_id,"thread-exact");assert.equal(task.turn_id,"turn-exact");
    await leaveCliSession(f.database,loadRun(f.database,"run"),{version:1,projects:{
      fixture:{owner:"fixture",repository:"Fixture/Repo",statuses:{review:"Human Review"},
        workspace:{canonical_repository:f.canonical,worktree_root:f.root,branch_prefix:"fixture",base_branch:"main"}},
    }},true,"none");
    assert.ok(taskForSession(f.database,plan.tmuxSessionName)?.released_at);
    const run=f.database.prepare("SELECT state,owner_state FROM runs").get();
    assert.equal(run?.state,"parked_review");assert.equal(run?.owner_state,"none");
    if(kind==="ci_repair") {
      reconcileCiRepairAttempts(f.database);
      assert.equal(f.database.prepare("SELECT attempt_state FROM run_ci_repair_attempts").get()?.attempt_state,"waiting_ci");
    }
    if(kind==="review_fix") {
      reconcileReviewFixRounds(f.database);
      assert.equal(f.database.prepare("SELECT round_state FROM run_review_fix_rounds").get()?.round_state,"waiting_ci",
        "Turn completion alone must not certify delivery of a new PR head");
    }
    }
  } finally {process.env=oldEnvironment;f.database.close();rmSync(f.root,{recursive:true,force:true});}
}

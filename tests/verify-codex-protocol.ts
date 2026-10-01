import assert from "node:assert/strict";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { executeManagedTask } from "../src/orchestrator/integrations/codex/managed-worker.ts";
import { claimProtocolTask, protocolTurnSucceeded, recordTurnCompleted, taskForSession } from "../src/orchestrator/integrations/codex/task-store.ts";
import { reconcileProtocolTasks, releaseProtocolTask, stopProtocolTask, protocolRemoteBlocker } from "../src/orchestrator/projects/sessions/protocol-session.ts";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { leaveCliSession } from "../src/orchestrator/projects/sessions/session-stop.ts";
import { loadRun } from "../src/orchestrator/projects/sessions/session-shared.ts";

for (const scenario of ["success","early","stale","failure","billing","approval","permission","unknown_request","disconnect","lost_ack","cancel","timeout"]) {
  const f = protocolRepository();
  try {
    const bin=resolve(f.root,"codex");
    writeFileSync(bin,`#!/bin/sh\nexec "${process.execPath}" "${resolve(import.meta.dirname,"fixtures/codex-protocol-server.mjs")}"\n`,{mode:0o700});
    chmodSync(bin,0o700);
    const log=resolve(f.root,"rpc.jsonl");
    const environment={...process.env,PROTOCOL_SCENARIO:scenario,PROTOCOL_LOG:log,
      GH_TOKEN:"fixture-writer",GITHUB_APP_PRIVATE_KEY:"must-not-leak",UNRELATED_SECRET:"must-not-leak"};
    let timer:NodeJS.Timeout | undefined;
    if (scenario==="cancel") timer=setInterval(()=>{
      if(taskForSession(f.database,f.task.session_name)?.turn_id) {
        f.database.prepare("UPDATE run_codex_tasks SET stop_requested='cancel'").run(); clearInterval(timer);
      }
    },20);
    await executeManagedTask(f.database,f.task,{codexBin:bin,cwd:f.worktree,canonicalRepository:f.canonical,
      prompt:"Test exact turn",title:"Fixture",timeoutMs:scenario==="timeout" ? 0 : 5_000,environment});
    if(timer) clearTimeout(timer);
    const task=taskForSession(f.database,f.task.session_name)!;
    assert.ok(task.stopped_at,scenario);
    assert.equal(Boolean(task.failure_code),!["success","early","stale"].includes(scenario),scenario);
    assert.equal(protocolTurnSucceeded(f.database,task.session_name),["success","early","stale"].includes(scenario));
    if(scenario==="billing") assert.equal(task.failure_code,"external_billing_block");
    if(scenario==="timeout") assert.equal(task.failure_code,"runtime_budget_exceeded");
    if(scenario==="lost_ack") { assert.equal(task.turn_id,null); assert.equal(task.phase,"disconnected"); }
    const rpc=readFileSync(log,"utf8").trim().split("\n").map((line)=>JSON.parse(line));
    const env=rpc.find((row)=>row.environment).environment;
    assert.deepEqual(env,{writerToken:true,leakedApp:false,leakedOther:false});
    assert.equal(rpc.filter((row)=>row.method==="turn/start").length,1);
    const turnRequest=rpc.find((row)=>row.method==="turn/start").params;
    assert.equal(turnRequest.approvalPolicy,"never");
    assert.equal(turnRequest.sandboxPolicy.type,"workspaceWrite");
    assert.equal(turnRequest.sandboxPolicy.networkAccess,true);
    assert.equal(turnRequest.sandboxPolicy.writableRoots[0],f.worktree);
    if(scenario==="permission") assert.deepEqual(rpc.find((row)=>row.id==="approval").result,{permissions:{},scope:"turn"});
    if(scenario==="approval") assert.equal(rpc.find((row)=>row.id==="approval").result.decision,"decline");
    if(["success","early","stale"].includes(scenario)) {
      assert.equal((f.database.prepare("SELECT COUNT(*) n FROM run_codex_task_events").get() as {n:number}).n,1);
      // Durable controller restart sees the same receipt. Terminal status is immutable.
      f.database.close();
      const restarted=new DatabaseSync(f.dbPath);
      assert.ok(protocolTurnSucceeded(restarted,task.session_name));
      recordTurnCompleted(restarted,task.task_id,{method:"turn/completed",params:{threadId:task.thread_id,turn:{id:task.turn_id,status:"failed"}}});
      assert.equal(taskForSession(restarted,task.session_name)?.turn_status,"completed");
      const oldEnv=process.env.PATH;
      const tmux=resolve(f.root,"tmux");
      writeFileSync(tmux,"#!/bin/sh\nexit 1\n",{mode:0o700});process.env.PATH=`${f.root}:${oldEnv}`;
      try {
        const run=loadRun(restarted,"run");
        await assert.rejects(leaveCliSession(restarted,run,{version:1,projects:{}},true,"remote"),/protocol_remote_handoff_unverified/);
        assert.equal((restarted.prepare("SELECT owner_state FROM runs").get() as {owner_state:string}).owner_state,"cli");
        releaseProtocolTask(restarted,task,"parked_review","codex_protocol_park_completed");
        assert.equal(recordTurnCompleted(restarted,task.task_id,{method:"turn/completed",params:{threadId:task.thread_id,turn:{id:task.turn_id,status:"completed"}}}),false);
      } finally { process.env.PATH=oldEnv; restarted.close(); }
    } else f.database.close();
  } finally { rmSync(f.root,{recursive:true,force:true}); }
}

// Lost worker: read exact stored history once, but never resume or dispatch.
{
  const f=protocolRepository(); const oldPath=process.env.PATH;
  try {
    const bin=resolve(f.root,"codex");const log=resolve(f.root,"rpc.jsonl");
    writeFileSync(bin,`#!/bin/sh\nPROTOCOL_SCENARIO=history PROTOCOL_LOG="${log}" exec "${process.execPath}" "${resolve(import.meta.dirname,"fixtures/codex-protocol-server.mjs")}"\n`,{mode:0o700});
    writeFileSync(resolve(f.root,"tmux"),"#!/bin/sh\nexit 1\n",{mode:0o700});
    process.env.PATH=`${f.root}:${oldPath}`;
    f.database.exec("UPDATE run_codex_tasks SET thread_id='thread-exact',turn_id='turn-exact',phase='running'; UPDATE run_resources SET codex_thread_id='thread-exact'");
    await reconcileProtocolTasks(f.database,bin);
    const task=taskForSession(f.database,f.task.session_name)!;
    assert.equal(task.turn_status,"completed");assert.equal(task.stopped_at,null);
    assert.equal(task.failure_code,"protocol_process_stop_unacknowledged");
    await reconcileProtocolTasks(f.database,bin);
    const rpc=readFileSync(log,"utf8");
    assert.ok(!rpc.includes("turn/start") && !rpc.includes("thread/resume"));
    f.database.exec("UPDATE runs SET owner_state='remote',state='remote_owned'");
    assert.equal(recordTurnCompleted(f.database,task.task_id,{method:"turn/completed",params:{threadId:task.thread_id,turn:{id:task.turn_id,status:"failed"}}}),false);
    const before=readFileSync(log,"utf8");await reconcileProtocolTasks(f.database,bin);
    assert.equal(readFileSync(log,"utf8"),before);
  } finally {process.env.PATH=oldPath;f.database.close();rmSync(f.root,{recursive:true,force:true});}
}
assert.ok(protocolRemoteBlocker.includes("No Remote ownership"));
// A process may acknowledge exit between the controller's DB read and tmux's exit probe.
{
  const f=protocolRepository();const oldPath=process.env.PATH;
  try {
    const tmux=resolve(f.root,"tmux");
    process.env.PATH=`${f.root}:${oldPath}`;
    writeFileSync(tmux,"#!/bin/sh\nexit 1\n",{mode:0o700});
    await assert.rejects(stopProtocolTask(f.database,f.task,"cancel"),/not acknowledged/);
    assert.equal(f.database.prepare("SELECT owner_state FROM runs").get()?.owner_state,"cli");
    writeFileSync(tmux,`#!${process.execPath}\nimport { DatabaseSync } from "node:sqlite";\nconst db=new DatabaseSync(${JSON.stringify(f.dbPath)});\ndb.prepare("UPDATE run_codex_tasks SET stopped_at='2026-01-01' WHERE task_id=?").run(${JSON.stringify(f.id)});\ndb.close();process.exit(1);\n`,{mode:0o700});
    const stopped=await stopProtocolTask(f.database,f.task,"cancel");
    assert.ok(stopped.stopped_at,"Exit acknowledgement from the final probe must not be lost");
  } finally {process.env.PATH=oldPath;f.database.close();rmSync(f.root,{recursive:true,force:true});}
}
// Reuse the legacy supervisor name across technical rounds without losing durable identities.
{
  const f=protocolRepository();
  try {
    assert.throws(()=>claimProtocolTask(f.database,"run",f.task.session_name,"main_writer" as never,"run"),/restricted/);
    assert.throws(()=>claimProtocolTask(f.database,"run",f.task.session_name,"successor" as never,"run"),/restricted/);
    assert.throws(()=>claimProtocolTask(f.database,"run",f.task.session_name,"review_fix","next"),/UNIQUE/);
    f.database.exec("UPDATE run_codex_tasks SET released_at='2026-01-01',stopped_at='2026-01-01'");
    const next=claimProtocolTask(f.database,"run",f.task.session_name,"review_fix","next");
    assert.equal(taskForSession(f.database,f.task.session_name)?.task_id,next);
    assert.equal(recordTurnCompleted(f.database,f.id,{method:"turn/completed",params:{threadId:"old",turn:{id:"old",status:"completed"}}}),false);
    await assert.rejects(stopProtocolTask(f.database,f.task,"release"),/mapping changed/);
    assert.throws(()=>releaseProtocolTask(f.database,f.task,"parked_review","stale"),/mapping changed/);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM run_codex_tasks").get()?.n,2);
  } finally {f.database.close();rmSync(f.root,{recursive:true,force:true});}
}
process.stdout.write(JSON.stringify({ok:true,protocolFixtures:12,technicalOnly:true,sequentialTasks:true,exitReceiptRace:true,exactIdentity:true,replay:true,restart:true,permissionFailClosed:true,billingDistinct:true,remoteFence:true})+"\n");

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { once } from "node:events";
import { protocolRepository } from "./fixtures/protocol-repository.ts";
import { recoverPf64UnauthorizedSuccessor, inspectPf64Rollout, inspectPf64ExternalEvidence, assertPf64NoLocalProcesses, pf64RecoveryEvidence, pf64RecoveryReason }
  from "../src/orchestrator/projects/sessions/recover-pf64-unauthorized-successor.ts";

const f = protocolRepository();
const db = f.database;
const previous = { PATH:process.env.PATH, GH_BIN:process.env.GH_BIN };
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const gitBin = execFileSync("which",["git"],{encoding:"utf8"}).trim();
const git = (...args: string[]) => execFileSync(gitBin,["-C",f.worktree,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const tables = ["runs","run_resources","run_autonomous_successions","run_control_requests","project_action_requests",
  "run_state_history","run_codex_tasks","run_codex_task_events","run_ci_repair_attempts","run_review_fix_rounds","preview_leases"];
const snapshot = () => JSON.stringify(tables.map(table => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
const rowHash = (table: string) => hash(JSON.stringify(db.prepare(`SELECT * FROM ${table} WHERE run_id='run' ORDER BY rowid`).all()));
let checks = 0;
try {
  const e = {...pf64RecoveryEvidence,successionHash:"",requestsHash:"",historyHash:"",projectRequestsHash:"",predecessorRolloutHash:"",successorRolloutHash:"",
    runId:"run",project:"fixture",repository:"Fixture/Repo",issueNumber:1,itemId:"item",
    canonical:f.canonical,worktree:f.worktree,branch:"fixture",sourceSha:git("rev-parse","HEAD"),sessionName:"cx-pf64-fixture",
    predecessorRollout:resolve(f.root,"predecessor.jsonl"),successorRollout:resolve(f.root,"successor.jsonl")};
  const project = {repository:e.repository,workspace:{canonical_repository:f.canonical,worktree_root:f.root,base_branch:"main"}};
  db.exec("DELETE FROM run_codex_task_events; DELETE FROM run_codex_tasks; UPDATE runs SET interaction_policy='human_control',state='remote_owned',owner_state='remote';");
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,payload_json)
    VALUES ('new-event','2026-01-02','fixture','item','content','Issue','Fixture/Repo',1,'{}')`);
  db.prepare("UPDATE run_resources SET codex_thread_id=?,tmux_session_name=NULL").run(e.successorThreadId);
  for (const id of [e.requestId,e.claimRequestId]) db.prepare(`INSERT INTO run_control_requests
    (request_id,run_id,action,request_state,requested_via,idempotency_key) VALUES (?,'run','take_control','applied','cli',?)`).run(id,id);
  db.prepare(`INSERT INTO run_autonomous_successions(succession_id,run_id,request_id,succession_number,succession_state,
    predecessor_thread_id,successor_thread_id,worktree_path,branch_name,source_head_sha,tmux_session_name,handoff_context_json)
    VALUES (?,'run',?,1,'parked',?,?,?,'fixture',?,?,'{}')`)
    .run(e.successionId,e.requestId,e.predecessorThreadId,e.successorThreadId,e.worktree,e.sourceSha,e.sessionName);
  db.prepare(`INSERT INTO project_action_requests(idempotency_key,run_id,actor_subject,action,fingerprint,confirmed,request_id)
    VALUES ('fixture-action','run','owner','take_control','fingerprint',0,?)`).run(e.requestId);
  db.exec(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
    VALUES ('run','parked_review','remote_owned','remote_claim_completed','{}')`);
  e.successionHash=rowHash("run_autonomous_successions");e.requestsHash=rowHash("run_control_requests");
  e.historyHash=rowHash("run_state_history");e.projectRequestsHash=rowHash("project_action_requests");
  const rollout = (path:string,threadId:string,turnId:string) => {
    writeFileSync(path,[{type:"session_meta",payload:{id:threadId,cwd:e.worktree}},
      {type:"event_msg",payload:{type:"task_started",turn_id:turnId}},
      {type:"event_msg",payload:{type:"task_complete",turn_id:turnId}}].map(value=>JSON.stringify(value)).join("\n")+"\n");
    return hash(readFileSync(path));
  };
  e.predecessorRolloutHash=rollout(e.predecessorRollout,e.predecessorThreadId,e.predecessorTurnId);
  e.successorRolloutHash=rollout(e.successorRollout,e.successorThreadId,e.successorTurnId);
  git("remote","add","origin",`https://github.com/${e.repository}.git`);
  git("update-ref","refs/remotes/origin/fixture",e.sourceSha);
  const networkPath=resolve(f.root,"network.json");
  const network = {sha:e.sourceSha,pulls:[] as object[]};
  const saveNetwork = () => writeFileSync(networkPath,JSON.stringify(network));saveNetwork();
  // Only network boundaries and tmux availability are substituted; native DB, Git linked-tree,
  // rollout reads, and /proc process detection are exercised, never the live Remote service.
  writeFileSync(resolve(f.root,"git"),`#!/usr/bin/env node\nconst fs=require('node:fs'),cp=require('node:child_process');const a=process.argv.slice(2);if(a[0]==='ls-remote'){process.stdout.write(JSON.parse(fs.readFileSync(${JSON.stringify(networkPath)},'utf8')).sha+'\\trefs/heads/fixture\\n');}else{const r=cp.spawnSync(${JSON.stringify(gitBin)},a,{stdio:'inherit'});process.exit(r.status??1);}\n`,{mode:0o700});
  writeFileSync(resolve(f.root,"gh"),`#!/usr/bin/env node\nconst fs=require('node:fs');const a=process.argv.slice(2);if(a[0]!=='api'||a[1]!=='--method'||a[2]!=='GET'||!a[3].includes('state=all'))process.exit(2);process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync(${JSON.stringify(networkPath)},'utf8')).pulls));\n`,{mode:0o700});
  const tmux = resolve(f.root,"tmux");
  const noTmux=()=>writeFileSync(tmux,"#!/bin/sh\nexit 1\n",{mode:0o700});noTmux();
  process.env.PATH=`${f.root}:${previous.PATH}`;process.env.GH_BIN=resolve(f.root,"gh");
  // The host's non-dumpable gpg-agent is deliberately not evidence about this disposable tree.
  // Enumerate an isolated inventory backed by real /proc entries, using the production guard.
  const procRoot=resolve(f.root,"proc");mkdirSync(procRoot);
  symlinkSync(`/proc/${process.pid}`,resolve(procRoot,String(process.pid)));
  const external=(p:typeof project,v:Parameters<typeof inspectPf64ExternalEvidence>[1])=>inspectPf64ExternalEvidence(p,v,value=>assertPf64NoLocalProcesses(value,procRoot));
  const confirmation = {remoteIdle:true,launchersQuiescent:true};
  const recover=(apply=false)=>recoverPf64UnauthorizedSuccessor(db,project,apply,confirmation,e,external);
  const baseline=snapshot();recover();assert.equal(snapshot(),baseline);checks++;
  const ro=new DatabaseSync(f.dbPath,{readOnly:true});
  try {recoverPf64UnauthorizedSuccessor(ro,project,false,undefined,e,external);} finally {ro.close();}
  assert.equal(snapshot(),baseline);checks++;
  const refuse=(label:string,change:()=>void,restore:()=>void)=>{
    change();const before=snapshot();assert.throws(()=>recover(true),/recovery refused/i,label);
    assert.equal(snapshot(),before,`${label}: mutation on refusal`);restore();assert.equal(snapshot(),baseline);checks++;
  };
  refuse("wrong successor",()=>db.prepare("UPDATE run_resources SET codex_thread_id='other'").run(),()=>db.prepare("UPDATE run_resources SET codex_thread_id=?").run(e.successorThreadId));
  refuse("CLI owner",()=>db.exec("UPDATE runs SET owner_state='cli'"),()=>db.exec("UPDATE runs SET owner_state='remote'"));
  refuse("cancelled",()=>db.exec("UPDATE runs SET stop_reason='cancelled'"),()=>db.exec("UPDATE runs SET stop_reason=NULL"));
  refuse("tmux mapping",()=>db.exec("UPDATE run_resources SET tmux_session_name='active'"),()=>db.exec("UPDATE run_resources SET tmux_session_name=NULL"));
  refuse("base SHA",()=>db.exec("UPDATE run_resources SET base_sha='0000000'"),()=>db.prepare("UPDATE run_resources SET base_sha=?").run(e.sourceSha));
  refuse("predecessor mapping",()=>db.exec("UPDATE run_resources SET previous_codex_thread_id='other'"),()=>db.exec("UPDATE run_resources SET previous_codex_thread_id=NULL"));
  refuse("succession receipt edited",()=>db.exec("UPDATE run_autonomous_successions SET succession_state='running'"),()=>db.exec("UPDATE run_autonomous_successions SET succession_state='parked'"));
  refuse("predecessor receipt edited",()=>db.exec("UPDATE run_autonomous_successions SET predecessor_thread_id='other'"),()=>db.prepare("UPDATE run_autonomous_successions SET predecessor_thread_id=?").run(e.predecessorThreadId));
  refuse("request receipt edited",()=>db.prepare("UPDATE run_control_requests SET request_state='pending' WHERE request_id=?").run(e.requestId),()=>db.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(e.requestId));
  refuse("fake approval",()=>db.exec("UPDATE project_action_requests SET confirmed=1"),()=>db.exec("UPDATE project_action_requests SET confirmed=0"));
  refuse("pending Project status mutation",()=>db.exec("UPDATE project_events SET from_status='Human Review',to_status='In progress' WHERE event_id='new-event'"),
    ()=>db.exec("UPDATE project_events SET from_status=NULL,to_status=NULL WHERE event_id='new-event'"));
  refuse("changed branch mapping",()=>db.exec("UPDATE run_resources SET branch_name='other'"),()=>db.exec("UPDATE run_resources SET branch_name='fixture'"));
  refuse("history receipt edited",()=>db.exec("UPDATE run_state_history SET details_json='{} '"),()=>db.exec("UPDATE run_state_history SET details_json='{}'"));
  refuse("new request",()=>db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES ('new','run','take_control','pending','cli','new')`),()=>db.exec("DELETE FROM run_control_requests WHERE request_id='new'"));
  refuse("newer run",()=>db.exec(`INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
    VALUES ('new','new-event','fixture','item','content','Fixture/Repo',1,'human_control','archived','none','live')`),()=>db.exec("DELETE FROM runs WHERE run_id='new'"));
  refuse("active task",()=>db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,phase)
    VALUES ('new','run','ci_repair','new','new',?,'fixture','claimed')`).run(e.worktree),()=>db.exec("DELETE FROM run_codex_tasks WHERE task_id='new'"));
  refuse("dirty untracked tree",()=>writeFileSync(resolve(e.worktree,"dirty"),"unapproved"),()=>rmSync(resolve(e.worktree,"dirty")));
  refuse("local SHA",()=>git("update-ref","refs/heads/fixture",git("-c","user.name=Fixture","-c","user.email=f@example.invalid","commit-tree",git("mktree"),"-p",e.sourceSha,"-m","unauthorized")),()=>git("update-ref","refs/heads/fixture",e.sourceSha));
  refuse("tracking SHA",()=>git("update-ref","refs/remotes/origin/fixture","0000000000000000000000000000000000000000"),()=>git("update-ref","refs/remotes/origin/fixture",e.sourceSha));
  refuse("live remote SHA",()=>{network.sha=e.unauthorizedSha;saveNetwork();},()=>{network.sha=e.sourceSha;saveNetwork();});
  refuse("closed PR also refuses",()=>{network.pulls=[{state:"closed"}];saveNetwork();},()=>{network.pulls=[];saveNetwork();});
  refuse("live tmux",()=>writeFileSync(tmux,"#!/bin/sh\nexit 0\n",{mode:0o700}),noTmux);
  const original=readFileSync(e.successorRollout);
  refuse("rollout appended active turn",()=>writeFileSync(e.successorRollout,Buffer.concat([original,Buffer.from(JSON.stringify({type:"event_msg",payload:{type:"task_started",turn_id:"new"}})+"\n")])),()=>writeFileSync(e.successorRollout,original));
  assert.throws(()=>inspectPf64Rollout(e.successorRollout,e.successorRolloutHash,"wrong",e.successorTurnId,e.worktree),/mismatch/);checks++;
  // The classifier must fail even if a caller supplies an updated byte pin for an active file.
  writeFileSync(e.successorRollout,Buffer.concat([original,Buffer.from(JSON.stringify({type:"event_msg",payload:{type:"task_started",turn_id:"new"}})+"\n")]));
  assert.throws(()=>inspectPf64Rollout(e.successorRollout,hash(readFileSync(e.successorRollout)),e.successorThreadId,e.successorTurnId,e.worktree),/completed turn/);
  writeFileSync(e.successorRollout,original);checks++;
  const child=spawn(process.execPath,["-e","process.stdout.write('ready');setInterval(()=>{},1000)"],{cwd:e.worktree,stdio:["ignore","pipe","pipe"]});
  await once(child.stdout!,"data");
  symlinkSync(`/proc/${child.pid}`,resolve(procRoot,String(child.pid)));
  try {const before=snapshot();assert.throws(()=>recover(true),/active local process/);assert.equal(snapshot(),before);checks++;}
  finally {child.kill();await once(child,"exit");rmSync(resolve(procRoot,String(child.pid)));}
  // No blanket permission-error suppression: inaccessible same-owner process evidence refuses.
  const blocked=resolve(f.root,"blocked");mkdirSync(blocked);mkdirSync(resolve(blocked,"cwd"));
  const opaque=resolve(procRoot,"999999999");mkdirSync(opaque);
  writeFileSync(resolve(opaque,"cmdline"),"daemon\0");symlinkSync(resolve(blocked,"cwd"),resolve(opaque,"cwd"));
  chmodSync(blocked,0o000);
  try {
    assert.throws(()=>recover(true),/local process evidence unavailable/);assert.equal(snapshot(),baseline);checks++;
    writeFileSync(resolve(opaque,"cmdline"),"/usr/bin/gpg-agent\0--supervised\0");
    const systemctl=resolve(f.root,"systemctl");
    const unit=(pid:string,directory="!/home/shagon1k")=>writeFileSync(systemctl,
      `#!/bin/sh\nprintf '%s\\n' 'MainPID=${pid}' 'WorkingDirectory=${directory}' 'ActiveState=active'\n`,{mode:0o700});
    unit("999999999");recover();assert.equal(snapshot(),baseline);checks++;
    unit("999999998");assert.throws(()=>recover(true),/local process evidence unavailable/);assert.equal(snapshot(),baseline);checks++;
    unit("999999999",e.worktree);assert.throws(()=>recover(true),/local process evidence unavailable/);assert.equal(snapshot(),baseline);checks++;
    rmSync(systemctl);
  } finally {chmodSync(blocked,0o700);rmSync(opaque,{recursive:true});}
  for(const [pid,argv,tick] of [["3395255","ssh-agent\0-s\0","745863421"],["972","(sd-pam)\0","982"]]) {
    const knownAgent=resolve(procRoot,pid!);mkdirSync(knownAgent);
    writeFileSync(resolve(knownAgent,"cmdline"),argv!);
    symlinkSync(resolve(blocked,"cwd"),resolve(knownAgent,"cwd"));
    const agentStat=(start:string)=>writeFileSync(resolve(knownAgent,"stat"),`${pid} (credential-agent) ${Array(19).fill("0").join(" ")} ${start}\n`);
    chmodSync(blocked,0o000);
    try {
      agentStat(tick!);recover();assert.equal(snapshot(),baseline);checks++;
      agentStat(String(BigInt(tick!)+1n));assert.throws(()=>recover(true),/local process evidence unavailable/);assert.equal(snapshot(),baseline);checks++;
    } finally {chmodSync(blocked,0o700);rmSync(knownAgent,{recursive:true});}
  }
  for (const c of [{remoteIdle:false,launchersQuiescent:true},{remoteIdle:true,launchersQuiescent:false}]) {
    assert.throws(()=>recoverPf64UnauthorizedSuccessor(db,project,true,c,e,external),/operator must confirm/);assert.equal(snapshot(),baseline);checks++;
  }
  let observations=0;
  assert.throws(()=>recoverPf64UnauthorizedSuccessor(db,project,true,confirmation,e,()=>{
    if (++observations===2) throw new Error("external evidence changed");
  }),/external evidence changed/);assert.equal(snapshot(),baseline);assert.equal(observations,2);checks++;
  // Real SQLite rollback: failure while appending the operator receipt must undo the mapping change.
  db.exec("CREATE TRIGGER fixture_refuse_recovery BEFORE INSERT ON run_state_history BEGIN SELECT RAISE(ABORT,'fixture history failure'); END");
  assert.throws(()=>recover(true),/fixture history failure/);assert.equal(snapshot(),baseline);
  db.exec("DROP TRIGGER fixture_refuse_recovery");checks++;
  const immutable=tables.filter(table=>!["run_resources","run_state_history"].includes(table));
  const beforeImmutable=JSON.stringify(immutable.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()));
  const predecessorBytes=readFileSync(e.predecessorRollout);
  const result=recover(true) as {alreadyRecovered:boolean};assert.equal(result.alreadyRecovered,false);
  assert.equal(db.prepare("SELECT codex_thread_id FROM run_resources").get()?.codex_thread_id,e.predecessorThreadId);
  assert.equal(JSON.stringify(immutable.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all())),beforeImmutable);
  assert.deepEqual(readFileSync(e.predecessorRollout),predecessorBytes);
  assert.deepEqual(readFileSync(e.successorRollout),original);
  assert.equal(db.prepare("SELECT confirmed FROM project_action_requests").get()?.confirmed,0);
  const receipt=db.prepare("SELECT * FROM run_state_history WHERE reason=?").get(pf64RecoveryReason)!;
  const detail=JSON.parse(String(receipt.details_json));assert.equal(detail.approvalGranted,false);assert.equal(detail.remoteIdleProven,false);
  const recoveredSnapshot=snapshot();recover(true);recover();assert.equal(snapshot(),recoveredSnapshot);checks++;
  db.exec("INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES ('run','remote_owned','remote_owned','later','{}')");
  assert.throws(()=>recover(true),/immutable receipt fence changed/);checks++;
  console.log(`PF-64 unauthorized successor recovery: ${checks} positive/negative checks passed; native transaction, real linked Git tree, rollout and process fixtures.`);
} finally {
  if(previous.PATH===undefined)delete process.env.PATH;else process.env.PATH=previous.PATH;
  if(previous.GH_BIN===undefined)delete process.env.GH_BIN;else process.env.GH_BIN=previous.GH_BIN;
  db.close();rmSync(f.root,{recursive:true,force:true});
}

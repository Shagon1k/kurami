import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const home = mkdtempSync(join(tmpdir(),"kurami-orphan-sandbox-"));
process.env.KURAMI_HOME = home;
const bin = join(home,"bin"); mkdirSync(bin);
process.env.PATH = `${bin}:${process.env.PATH}`;
const { recoverOrphanSandbox } = await import("../src/orchestrator/projects/sessions/recover-orphan-sandbox.ts");
const { descendantProcesses, cleanupParkProcesses } = await import("../src/orchestrator/projects/sessions/park-processes.ts");
const { assertNoWorktreeWriter } = await import("../src/orchestrator/projects/sessions/recover-legacy-ci-timeout.ts");
const git = (...args:string[]) => execFileSync("git",args,{encoding:"utf8"}).trim();
const repo = join(home,"repo"); mkdirSync(repo); git("-C",repo,"init","-b","fixture");
writeFileSync(join(repo,"file"),"fixture"); git("-C",repo,"add","file");
git("-C",repo,"-c","user.name=Fixture","-c","user.email=fixture@example.invalid","commit","-m","fixture");
const head = git("-C",repo,"rev-parse","HEAD");
symlinkSync(process.execPath,join(bin,"codex-linux-sandbox"));
writeFileSync(join(bin,"tmux"),"#!/bin/sh\nprintf '%s\\n' /unrelated-copy\n",{mode:0o700});
writeFileSync(join(home,"server.mjs"),`import {writeFileSync} from 'node:fs';import {spawn} from 'node:child_process';
const shell=spawn('/bin/sh',['-c','python3 -u -m http.server 0 --bind 127.0.0.1 & wait'],{stdio:['ignore','pipe','ignore']});
shell.stdout.on('data',chunk=>{const match=String(chunk).match(/port (\\d+)/);if(match)writeFileSync(process.argv[2],JSON.stringify({pid:process.pid,port:Number(match[1])}));});
setInterval(()=>{},1000);`);
writeFileSync(join(home,"parent.mjs"),`import {spawn} from 'node:child_process';
const child=spawn(process.argv[2],process.argv.slice(3),{stdio:'ignore',detached:true});child.unref();`);
const captured: ReturnType<typeof descendantProcesses>[] = [];
async function orphan(name:string,thread="thread",policyFlag="--permission-profile") {
  const info = join(home,name + ".json");
  const parent=spawn(process.execPath,[join(home,"parent.mjs"),join(bin,"codex-linux-sandbox"),join(home,"server.mjs"),info,policyFlag],{
    cwd:repo,stdio:"ignore",env:{...process.env,HERMES_RUN_ID:"r_fixture",HERMES_WORKTREE_PATH:repo,CODEX_THREAD_ID:thread,TMUX:"fixture,1,0"},
  });
  await new Promise<void>(done=>parent.on("exit",()=>done()));
  for(let i=0;i<120 && !existsSync(info);i++) await new Promise(done=>setTimeout(done,25));
  const server=JSON.parse(readFileSync(info,"utf8")) as {pid:number;port:number};
  const owned=descendantProcesses([server.pid]); captured.push(owned);
  assert.ok(owned.length >= 3,"real orphan sandbox -> shell -> helper ancestry");
  return server;
}
let database:DatabaseSync|undefined;
try {
  execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator/state/init-run-store.ts")],{env:{...process.env,ORCHESTRATOR_MIGRATIONS_DIR:resolve(import.meta.dirname,"../migrations")},stdio:"pipe"});
  database=new DatabaseSync(join(home,"state/orchestrator.db"));
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES('e','2026-10-12T00:00:00Z','fixture','item','Issue','{}');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode) VALUES('r_fixture','e','fixture','item','content','Example/Fixture',1,'autonomous','parked_review','none','live');
    INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id) VALUES('r_fixture','provisioned','${repo}','fixture','thread');
    INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at) VALUES('r_fixture','Example/Fixture',1,'https://github.com/Example/Fixture/pull/1','${head}','pending','[]','fixture','2026-11-11T00:00:00Z','2026-11-11T00:00:00Z');`);
  const managed=await orphan("managed");
  assert.throws(()=>assertNoWorktreeWriter(repo),/live writer/);
  const plan=await recoverOrphanSandbox(database,"r_fixture",managed.pid);
  assert.equal(plan.apply,false); process.kill(managed.pid,0);
  for (const [state,owner] of [["running","cli"],["remote_owned","remote"]]) {
    database.prepare("UPDATE runs SET state=?,owner_state=?").run(state!,owner!);
    await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,plan.fingerprint),/released primary/);
    process.kill(managed.pid,0);
  }
  database.exec("UPDATE runs SET state='parked_review',owner_state='none'");
  database.exec("UPDATE run_resources SET resource_state='released'");
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid),/released primary/);
  process.kill(managed.pid,0);
  database.exec("UPDATE run_resources SET resource_state='provisioned'");
  database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
    VALUES('pending','r_fixture','review_fix','pending','cli','pending')`);
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,plan.fingerprint),/control or worker conflict/);
  database.exec("DELETE FROM run_control_requests WHERE request_id='pending'");
  database.prepare("UPDATE run_ci_snapshots SET head_sha=?").run("a".repeat(40));
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,plan.fingerprint),/observed source changed/);
  database.prepare("UPDATE run_ci_snapshots SET head_sha=?").run(head);
  writeFileSync(join(bin,"tmux"),`#!/bin/sh\nprintf '%s\\n' '${repo}'\n`,{mode:0o700});
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,plan.fingerprint),/supervisor still uses/);
  writeFileSync(join(bin,"tmux"),"#!/bin/sh\nprintf '%s\\n' /unrelated-copy\n",{mode:0o700});
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,"0".repeat(64)),/identity changed/);
  const other=await orphan("unrelated","other-thread");
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",other.pid),/provenance/);
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,plan.fingerprint),/another writer/);
  process.kill(other.pid,0); process.kill(managed.pid,0);
  await cleanupParkProcesses(captured[1]!);
  const fresh=await recoverOrphanSandbox(database,"r_fixture",managed.pid);
  const result=await recoverOrphanSandbox(database,"r_fixture",managed.pid,fresh.fingerprint);
  assert.equal(result.apply,true); assertNoWorktreeWriter(repo);
  await assert.rejects(import("node:net").then(({createConnection})=>new Promise((done,reject)=>{
    const socket=createConnection({host:"127.0.0.1",port:managed.port});socket.on("connect",()=>{socket.destroy();done(true);});socket.on("error",reject);
  })));
  assert.equal(database.prepare("SELECT COUNT(*) n FROM run_state_history WHERE reason='orphan_sandbox_recovered'").get()?.n,1);
  await assert.rejects(recoverOrphanSandbox(database,"r_fixture",managed.pid,fresh.fingerprint),/not a live orphan/);
  assert.equal(database.prepare("SELECT COUNT(*) n FROM run_state_history WHERE reason='orphan_sandbox_recovered'").get()?.n,1);
  const legacy=await orphan("legacy","thread","--sandbox-policy");
  const legacyPlan=await recoverOrphanSandbox(database,"r_fixture",legacy.pid);
  assert.equal(legacyPlan.apply,false,"legacy sandbox policy remains inspectable");
  await cleanupParkProcesses(captured[2]!);
  console.log(JSON.stringify({ok:true,orphanSandbox:"real reparented sandbox/shell/helper stopped; dry-run, active, Remote, unrelated/new writer, fingerprint and duplicate audit fenced"}));
} finally {
  database?.close(); for(const processes of captured) await cleanupParkProcesses(processes);
  rmSync(home,{recursive:true,force:true});
}

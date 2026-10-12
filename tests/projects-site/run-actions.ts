import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requestProjectRunAction,projectRunActions,type RunAction,type RunActionInput } from "../../src/projects-site/run-actions.ts";
import { ProjectsActionError } from "../../src/projects-site/actions.ts";
import { requestRunControl } from "../../src/orchestrator/controls/run.ts";
import { loadRepairContext,loadReviewFixContext } from "../../src/orchestrator/projects/sessions/session-start.ts";
import { collectProjectsSnapshot } from "../../src/projects-site/snapshot.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";
import { renderProjectsDashboard } from "../../src/projects-site/render.ts";
import { reviewFixStartupFailure } from "../../src/projects-site/review-fix-failure.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-project-run-actions-"));
const now=new Date();const at=now.toISOString();const expires=new Date(now.getTime()+3_600_000).toISOString();
const head="a".repeat(40),otherHead="b".repeat(40),pr="https://github.com/Example/Alpha/pull/20";
mkdirSync(join(home,"config"));mkdirSync(join(home,"state"));
writeFileSync(join(home,"config/projects.yaml"),JSON.stringify({projects:{alpha:{owner:"Example",project_number:1,repository:"Example/Alpha",preview:{adapter:"compose"},workspace:{worktree_root:join(home,"worktrees")},statuses:{backlog:"Todo",active:"Doing",review:"Review",done:"Done",deferred:"Later"}}}}));
writeFileSync(join(home,"config/orchestrator.yaml"),JSON.stringify({limits:{preview_expiry_warning_hours:2}}));
const database=new DatabaseSync(join(home,"state/orchestrator.db"));database.exec("PRAGMA foreign_keys=ON");
const migrations=resolve(import.meta.dirname,"../../migrations");const options={home,now};
const view=()=>projectRunActions(database,"r_current",home,now,true);
const input=(action:RunAction):RunActionInput=>({runId:"r_current",project:"alpha",itemId:"item12",action,fingerprint:view().fingerprint,key:randomUUID(),confirmed:false});
const count=()=>database.prepare("SELECT COUNT(*) AS n FROM run_control_requests").get()!.n;
function reject(value:RunActionInput,pattern:RegExp) {
  const before=count();assert.throws(()=>requestProjectRunAction(value,"owner",options),error=>error instanceof ProjectsActionError && pattern.test(error.message));assert.equal(count(),before);
}
function reset() {
  database.exec("DELETE FROM project_action_requests; DELETE FROM run_control_project_context; DELETE FROM run_ai_reviews; DELETE FROM run_control_requests; DELETE FROM run_state_history; UPDATE runs SET state='parked_review',owner_state='none',stop_reason=NULL,execution_mode='live',preview_requirement_satisfied_at=NULL,preview_requirement_lease_id=NULL; UPDATE run_resources SET tmux_session_name=NULL,previous_codex_thread_id=NULL; UPDATE project_items SET present=1; UPDATE project_poll_state SET last_attempt_state='succeeded'");
  database.prepare("UPDATE project_poll_state SET last_captured_at=?").run(at);
  database.prepare("UPDATE run_ci_snapshots SET head_sha=?,pull_request_url=?,aggregate_state='failed'").run(head,pr);
  database.prepare("UPDATE preview_leases SET state='running',released_at=NULL,release_reason=NULL,reviewed_at=NULL,reviewed_by=NULL,reviewed_via=NULL,expires_at=?,verified_head_sha=? WHERE lease_id='lease_current'").run(expires,head);
}
try {
  for(const file of readdirSync(migrations).filter(name=>/^\d+_.*\.sql$/.test(name) && name<"035_").sort()) database.exec(readFileSync(join(migrations,file),"utf8"));
  database.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,payload_json) VALUES('event_current',?,'alpha','item12','issue12','Issue','{}')").run(at);
  database.exec("INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode,preview_required,preview_required_label) VALUES('r_current','event_current','alpha','item12','issue12','Example/Alpha',12,'autonomous','parked_review','none','live',1,'preview-required')");
  database.exec("INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id,preview_id) VALUES('r_current','provisioned','/tmp/synthetic-worktree','synthetic-branch','thread12','lease_current')");
  database.prepare("INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at) VALUES('alpha','item12','Issue','Example/Alpha',12,'Fixture','https://github.com/Example/Alpha/issues/12','Review',1,?,?)").run(at,at);
  database.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('alpha',?,?,1,'succeeded')").run(at,at);
  database.prepare("INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at) VALUES('r_current','Example/Alpha',20,?,?,'failed','[]','digest',?,?,?)").run(pr,head,at,at,at);
  database.prepare("INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name,expires_at,verified_head_sha,reviewed_at,reviewed_by,reviewed_via) VALUES('lease_current','r_current',1,'running','synthetic-compose',?,?,?,'discord:123','discord')").run(expires,head,at);
  database.prepare("INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name,released_at,release_reason,expires_at,runtime_adapter,artifact_root,artifact_digest,artifact_file_count,artifact_total_bytes,reviewed_at,reviewed_by,reviewed_via) VALUES('lease_static','r_current',2,'released','synthetic-static',?,'owner_stopped',?,'static','/tmp/synthetic-artifact','digest',2,100,?,'cli:owner','cli')").run(at,expires,at);
  const oldRows=database.prepare("SELECT * FROM preview_leases ORDER BY lease_id").all();
  const objects=database.prepare("SELECT type,name FROM sqlite_master WHERE tbl_name='preview_leases' AND type IN ('index','trigger') ORDER BY type,name").all();
  assert.equal(collectProjectsSnapshot({...options,controlsEnabled:true}).items[0]!.runActions!.reason,"unavailable");
  database.exec("BEGIN IMMEDIATE");database.exec(readFileSync(join(migrations,"035_projects_run_actions.sql"),"utf8"));database.exec("COMMIT");
  assert.deepEqual(database.prepare("SELECT * FROM preview_leases ORDER BY lease_id").all(),oldRows,"populated migration preserves compose/static leases and their Discord/CLI provenance");
  assert.deepEqual(database.prepare("SELECT type,name FROM sqlite_master WHERE tbl_name='preview_leases' AND type IN ('index','trigger') ORDER BY type,name").all(),objects);
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  reset();
  const repairInput=input("ci_repair");const repair=requestProjectRunAction(repairInput,"owner",options);
  assert.equal(repair.state,"created");assert.equal(count(),1);assert.equal(requestProjectRunAction(repairInput,"owner",options).requestId,repair.requestId);
  assert.equal(requestProjectRunAction(input("ci_repair"),"owner",options).requestId,repair.requestId,"two renders share the same queued action");
  assert.equal(database.prepare("SELECT requested_via FROM run_control_requests").get()!.requested_via,"projects");
  assert.equal(database.prepare("SELECT actor_subject FROM project_action_requests").get()!.actor_subject,"owner");
  assert.equal(view().actions.find(action=>action.action==="ci_repair")!.state,"pending");
  const run=database.prepare("SELECT * FROM runs JOIN run_resources USING(run_id) WHERE run_id='r_current'").get() as unknown as Parameters<typeof loadRepairContext>[1];
  assert.equal(loadRepairContext(database,run,repair.requestId).sourceHeadSha,head);
  database.prepare("UPDATE run_ci_snapshots SET head_sha=?").run(otherHead);
  assert.throws(()=>loadRepairContext(database,run,repair.requestId),/different PR or commit/);
  database.exec("UPDATE run_control_requests SET request_state='applied'; UPDATE runs SET state='remote_owned',owner_state='remote'");
  assert.equal(requestProjectRunAction(repairInput,"owner",options).requestId,repair.requestId,"old nonce never starts new work after completion");
  reset();const discord=requestRunControl(database,"r_current","ci_repair","discord",true,{home});
  assert.equal(requestProjectRunAction(input("ci_repair"),"owner",options).requestId,discord.requestId,"the same Discord queue is reused");assert.equal(count(),1);
  reset();const stale=input("stop");database.exec("UPDATE runs SET owner_state='cli'");reject(stale,/Состояние запуска/);
  reset();database.exec("UPDATE project_poll_state SET last_attempt_state='failed'");reject(input("stop"),/Синхронизация/);
  reset();database.exec("UPDATE project_items SET present=0");reject(input("stop"),/Запуск задачи/);
  reset();database.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES('event_new',?,'alpha','item12','Issue','{}')").run(at);
  database.exec("UPDATE runs SET state='cancelled' WHERE run_id='r_current'");
  database.exec("INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state) VALUES('r_new','event_new','alpha','item12','issue12','Example/Alpha',12,'autonomous','running')");
  reject(input("stop"),/Запуск задачи/);database.exec("DELETE FROM runs WHERE run_id='r_new'");
  reset();reject({...input("stop"),action:"arbitrary" as RunAction},/Некорректный/);
  reset();database.exec("UPDATE runs SET execution_mode='dry_run'");reject(input("stop"),/Состояние запуска/);

  reset();requestProjectRunAction(input("preview_stop"),"owner",options);assert.equal(database.prepare("SELECT action FROM run_control_requests").get()!.action,"preview_stop");
  reset();const extension=input("preview_start");assert.match(view().actions.find(action=>action.action==="preview_start")!.label,/Продлить/);requestProjectRunAction(extension,"owner",options);
  reset();const acknowledgement=input("preview_reviewed");const ack=requestProjectRunAction(acknowledgement,"owner",options);
  assert.equal(ack.requestState,"applied");assert.equal(count(),0,"preview acknowledgement does not start a worker");
  assert.equal(collectProjectsSnapshot(options).items.find(item=>item.id==='item12')!.preview.reviewed,true,"the confirmed receipt survives a fresh snapshot");
  assert.equal(database.prepare("SELECT reviewed_via FROM preview_leases WHERE lease_id='lease_current'").get()!.reviewed_via,"projects");
  assert.equal(database.prepare("SELECT preview_requirement_lease_id FROM runs").get()!.preview_requirement_lease_id,"lease_current");
  assert.equal(requestProjectRunAction(acknowledgement,"owner",options).state,"existing");assert.equal(database.prepare("SELECT COUNT(*) AS n FROM run_state_history WHERE reason='preview_reviewed'").get()!.n,1);
  reset();database.prepare("UPDATE preview_leases SET verified_head_sha=? WHERE lease_id='lease_current'").run(otherHead);reject(input("preview_reviewed"),/недоступно/);
  reset();database.prepare("UPDATE preview_leases SET expires_at=? WHERE lease_id='lease_current'").run(new Date(now.getTime()-1).toISOString());reject(input("preview_reviewed"),/недоступно/);
  reset();database.exec("UPDATE preview_leases SET state='released',released_at='2026-09-30T00:00:00Z' WHERE lease_id='lease_current'");
  assert.match(view().actions.find(action=>action.action==="preview_start")!.label,/Запустить/);requestProjectRunAction(input("preview_start"),"owner",options);

  reset();database.exec("UPDATE runs SET state='running',owner_state='cli'");requestProjectRunAction(input("take_control"),"owner",options);
  reset();database.exec("UPDATE runs SET state='remote_owned',owner_state='remote'");assert.match(view().actions.find(action=>action.action==="take_control")!.label,/автономно/);requestProjectRunAction(input("take_control"),"owner",options);
  reset();requestProjectRunAction(input("stop"),"owner",options);assert.equal(database.prepare("SELECT stage FROM run_progress_cards").get()!.stage,"stopping","shared pending presentation remains visible to Discord");
  reset();database.exec("UPDATE runs SET state='needs_attention',owner_state='none',stop_reason='cancelled'; UPDATE run_ci_snapshots SET pull_request_url=NULL");
  const discard=input("discard_local");reject(discard,/Подтвердите/);requestProjectRunAction({...discard,confirmed:true},"owner",options);
  reset();database.exec("UPDATE runs SET state='needs_attention',owner_state='none',stop_reason='cancelled'");const published=input("discard_published");reject(published,/Подтвердите/);requestProjectRunAction({...published,confirmed:true},"owner",options);
  reset();reject(input("recover_managed_task"),/недоступно/);
  reset();database.exec("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('q_review','r_current','ai_review','discord','review-fixture','applied')");
  database.prepare("INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name,important_count) VALUES('review_current','r_current','q_review',1,'ready','Example/Alpha',20,?,'main',?,?,'synthetic-review',1)").run(pr,otherHead,head);
  const fix=requestProjectRunAction(input("review_fix"),"owner",options);
  database.prepare("UPDATE run_control_requests SET request_state='failed',result_json=? WHERE request_id=?")
    .run(JSON.stringify({action:"review_fix_start_failed",reason:"Legacy CI recovery refused: live writer uses preserved worktree /private/path password=synthetic-secret https://user:pass@host"}),fix.requestId);
  const beforeFailure=view();
  const failedSnapshot=collectProjectsSnapshot({...options,controlsEnabled:true});
  const failedItem=failedSnapshot.items[0]!;
  assert.match(failedItem.reviewFixStartupFailure!,/process still owns/);
  assert.equal(failedItem.review.state,"ready","a startup refusal does not erase valid AI review evidence");
  assert.deepEqual(view().actions.map(({state,...action})=>action),beforeFailure.actions.map(({state,...action})=>action),"display outcome does not change control eligibility");
  const failureHtml=renderProjectsDashboard(failedSnapshot,new URLSearchParams({item:"item12"}));
  assert.match(failureHtml,/Review fixes did not start/);
  assert.doesNotMatch(failureHtml,/synthetic-secret|private\/path|user:pass/);
  assert.equal(reviewFixStartupFailure(database,"r_current",otherHead,pr),null,"different head suppresses old failure");
  assert.equal(reviewFixStartupFailure(database,"r_current",head,pr+"1"),null,"different PR suppresses old failure");
  database.prepare("UPDATE run_control_requests SET result_json=? WHERE request_id=?").run('null',fix.requestId);
  assert.equal(reviewFixStartupFailure(database,"r_current",head,pr),null);
  database.prepare("UPDATE run_control_requests SET result_json=? WHERE request_id=?").run(JSON.stringify({action:"review_fix_start_failed",reason:"password=synthetic-secret "+"x".repeat(5000)}),fix.requestId);
  assert.ok(reviewFixStartupFailure(database,"r_current",head,pr)!.length<200);
  assert.doesNotMatch(reviewFixStartupFailure(database,"r_current",head,pr)!,/synthetic-secret/);
  database.exec("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('q_new_fix','r_current','review_fix','discord','new-review-fixture','pending')");
  assert.equal(reviewFixStartupFailure(database,"r_current",head,pr),null,"new pending request suppresses old refusal");
  database.exec("UPDATE run_control_requests SET request_state='applied' WHERE request_id='q_new_fix'");
  assert.equal(reviewFixStartupFailure(database,"r_current",head,pr),null,"new successful request suppresses old refusal");
  database.exec("DELETE FROM run_control_requests WHERE request_id='q_new_fix'");
  database.exec("UPDATE run_control_requests SET request_state='pending',result_json=NULL WHERE action='review_fix'");
  database.prepare("UPDATE run_ci_snapshots SET head_sha=?").run(otherHead);
  await assert.rejects(loadReviewFixContext(database,run,{owner:"Example"} as Parameters<typeof loadReviewFixContext>[2],fix.requestId),/different PR or commit/);

  let authorized=false,writes=0;const server=createProjectsServer({authorize:async()=>authorized?"owner":null,snapshot:()=>collectProjectsSnapshot(options),runAction:()=>{writes++;return {state:"created",requestId:"fixture",requestState:"pending"};}});
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));const base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  const headers={Origin:"https://kurami.shagon1k.win","Content-Type":"application/json"};
  const post=(extra:Record<string,string>={},body=JSON.stringify(input("stop")))=>fetch(base+"/api/run-action",{method:"POST",headers:{...headers,...extra},body});
  try {assert.equal((await post()).status,403);authorized=true;assert.equal((await post({Origin:"https://evil.example"})).status,403);assert.equal((await post({"Sec-Fetch-Site":"cross-site"})).status,403);assert.equal((await post({"Content-Type":"text/plain"})).status,403);assert.equal((await post({},"not json")).status,400);assert.equal((await post({},"x".repeat(5000))).status,413);assert.equal(writes,0);assert.equal((await post()).status,202);assert.equal(writes,1);}
  finally {await new Promise<void>(done=>server.close(()=>done()));}
} finally {database.close();rmSync(home,{recursive:true,force:true});}
console.log("Projects run actions: populated v34 upgrade, shared Discord queue/presentation, current-run admission, exact-SHA workers, preview acknowledgement, durable retries, destructive confirmation and owner/CSRF boundaries verified");

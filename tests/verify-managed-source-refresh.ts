import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { refreshManagedSource, type SourceAction, type SourceEffects } from "../src/orchestrator/projects/worktrees/refresh-source.ts";
import { runExternal } from "../src/orchestrator/runtime/controller-execution.ts";
import { assertPreviewSourceRevision } from "../src/orchestrator/projects/previews/runtime.ts";
import type { PlannedAction } from "../src/orchestrator/runtime/request-plan.ts";

const root = mkdtempSync(resolve(tmpdir(),"kurami-source-refresh-"));
const git = (path: string, ...args: string[]) => execFileSync("git",["-C",path,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
let cases = 0;
function fixture() {
  const home = resolve(root,`case-${++cases}`), canonical = resolve(home,"canonical"), trees = resolve(home,"trees"), worktree = resolve(trees,"managed");
  mkdirSync(canonical,{recursive:true}); mkdirSync(trees);
  git(canonical,"init","-q","--initial-branch=main"); git(canonical,"config","user.email","test@example.invalid"); git(canonical,"config","user.name","Fixture");
  writeFileSync(resolve(canonical,"file"),"base\n"); git(canonical,"add","file"); git(canonical,"commit","-qm","base");
  const old = git(canonical,"rev-parse","HEAD");
  git(canonical,"remote","add","origin","https://github.com/owner/project.git");
  git(canonical,"worktree","add","-qb","feature",worktree);
  writeFileSync(resolve(canonical,"file"),"external\n"); git(canonical,"commit","-qam","external");
  const head = git(canonical,"rev-parse","HEAD");
  const database = new DatabaseSync(resolve(home,"store.db"));
  for (const file of readdirSync(resolve(import.meta.dirname,"../migrations")).filter(f => /^\d+_.*\.sql$/.test(f)).sort())
    database.exec(readFileSync(resolve(import.meta.dirname,"../migrations",file),"utf8"));
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,payload_json,processing_state)
    VALUES('event','2026-10-10T12:00:00Z','test','item','content','Issue','owner/project',1,'Test','https://github.com/owner/project/issues/1','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
    VALUES('r_test','event','test','item','content','owner/project',1,'autonomous','parked_review','none','live');`);
  database.prepare("INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name) VALUES('r_test','provisioned',?,'feature')").run(worktree);
  database.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES('r_test','owner/project',1,'https://github.com/owner/project/pull/1',?,'passed','[]','fixture','2026-10-10T12:00:00Z','2026-10-10T12:00:00Z','2026-10-10T12:00:00Z')`).run(head);
  database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key)
    VALUES('rq_test','r_test','review_fix','projects','source-test');`);
  database.prepare(`INSERT INTO run_control_project_context(request_id,actor_subject,expected_head_sha,expected_pull_request_url)
    VALUES('rq_test','owner',?,'https://github.com/owner/project/pull/1')`).run(head);
  const project = { repository:"owner/project", workspace:{canonical_repository:canonical,worktree_root:trees,base_branch:"main"} };
  let liveHead = head, fetches = 0, pulls = 0;
  const effects: SourceEffects = {
    pull: () => { pulls++; return {number:1,html_url:"https://github.com/owner/project/pull/1",state:"open",merged:false,
      head:{sha:liveHead,ref:"feature",repo:{full_name:"owner/project"}},base:{ref:"main",repo:{full_name:"owner/project"}}}; },
    remoteHead: () => liveHead,
    fetch: () => { fetches++; git(worktree,"fetch","--no-tags","--no-write-fetch-head","--",canonical,"refs/heads/main"); },
    noWriter: () => {},
  };
  const refresh = (apply = true, action: SourceAction = "review_fix_start", io = effects) => refreshManagedSource(database,project,"r_test",action,"rq_test",apply,io);
  return { database,project,worktree,canonical,old,head,effects,refresh,
    move: () => { liveHead = old; }, fetches: () => fetches, pulls: () => pulls };
}
function test(fn: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture(); try { fn(f); } finally { f.database.close(); }
}
try {
  test(f => {
    assertPreviewSourceRevision(f.canonical,f.head);
    assert.throws(() => assertPreviewSourceRevision(f.worktree,f.head),/does not match/);
    const plan = f.refresh(false) as {fastForward:boolean}; assert.equal(plan.fastForward,true);
    assert.equal(git(f.worktree,"rev-parse","HEAD"),f.old); assert.equal(f.fetches(),0,"dry-run writes no Git refs");
    f.refresh(); assert.equal(git(f.worktree,"rev-parse","HEAD"),f.head);
    assert.equal(git(f.worktree,"merge-base",f.old,f.head),f.old,"old tip retained as ancestor");
    assertPreviewSourceRevision(f.worktree,f.head);
    assert.equal(f.database.prepare("SELECT COUNT(*) n FROM run_state_history WHERE reason='managed_source_fast_forward'").get()?.n,1);
    assert.equal((f.refresh() as {fastForward:boolean}).fastForward,false);
  });
  test(f => {
    writeFileSync(resolve(f.worktree,"local"),"unpublished\n"); git(f.worktree,"add","local"); git(f.worktree,"commit","-qm","unpublished");
    const local = git(f.worktree,"rev-parse","HEAD");
    assert.throws(() => f.refresh(),/divergent or unpublished/);
    assert.equal(git(f.worktree,"rev-parse","HEAD"),local); assert.equal(readFileSync(resolve(f.worktree,"local"),"utf8"),"unpublished\n");
    assert.equal(git(f.worktree,"branch","--show-current"),"feature");
  });
  test(f => { writeFileSync(resolve(f.worktree,"dirty"),"preserve"); assert.throws(() => f.refresh(),/dirty worktree preserved/);
    assert.equal(f.fetches(),0); assert.equal(readFileSync(resolve(f.worktree,"dirty"),"utf8"),"preserve"); });
  test(f => { f.database.exec("UPDATE runs SET owner_state='cli'"); assert.throws(() => f.refresh(),/owner/); assert.equal(f.fetches(),0); });
  test(f => { f.database.exec("UPDATE run_resources SET tmux_session_name='cx-test'"); assert.throws(() => f.refresh(),/owner/); });
  test(f => { f.database.exec("UPDATE runs SET stop_reason='cancelled'"); assert.throws(() => f.refresh(),/owner/); });
  test(f => { f.database.prepare("UPDATE run_control_project_context SET expected_head_sha=?").run(f.old); assert.throws(() => f.refresh(),/displayed source changed/); });
  test(f => { git(f.worktree,"remote","set-url","origin","https://github.com/other/repo.git"); assert.throws(() => f.refresh(),/origin/); });
  test(f => { git(f.worktree,"switch","-c","wrong"); assert.throws(() => f.refresh(),/wrong branch/); });
  test(f => { f.move(); assert.throws(() => f.refresh(),/live PR/); assert.equal(f.fetches(),0); });
  test(f => {
    assert.throws(() => f.refresh(true,"review_fix_start",{...f.effects,fetch:() => f.move()}),/live PR/);
    assert.equal(git(f.worktree,"rev-parse","HEAD"),f.old,"moving source during fetch does not advance local branch");
  });
  test(f => {
    assert.throws(() => f.refresh(true,"review_fix_start",{...f.effects,fetch:() => {
      writeFileSync(resolve(f.worktree,"late-dirty"),"preserved");
    }}),/dirty worktree preserved/);
    assert.equal(git(f.worktree,"rev-parse","HEAD"),f.old);
    assert.equal(readFileSync(resolve(f.worktree,"late-dirty"),"utf8"),"preserved");
  });
  test(f => {
    assert.throws(() => f.refresh(true,"review_fix_start",{...f.effects,fetch:() => {
      git(f.worktree,"commit","--allow-empty","-qm","external local writer");
    }}),/local head changed before fast-forward/);
    assert.notEqual(git(f.worktree,"rev-parse","HEAD"),f.old);
    assert.notEqual(git(f.worktree,"rev-parse","HEAD"),f.head);
  });
  test(f => {
    f.refresh(); git(f.worktree,"commit","--allow-empty","-qm","unpublished ahead");
    const local=git(f.worktree,"rev-parse","HEAD");
    assert.throws(() => f.refresh(),/divergent or unpublished/); assert.equal(git(f.worktree,"rev-parse","HEAD"),local);
  });
  test(f => {
    let n=0;
    const io={...f.effects,pull:(repo:string,num:number) => { if (++n === 3) f.move(); return f.effects.pull(repo,num); }};
    assert.throws(() => f.refresh(true,"review_fix_start",io),/live PR/);
    assert.equal(git(f.worktree,"rev-parse","HEAD"),f.head,"safe FF retained, admission refused after late remote movement");
    assert.equal(git(f.worktree,"merge-base",f.old,f.head),f.old);
  });
  test(f => {
    assert.throws(() => f.refresh(true,"review_fix_start",{...f.effects,noWriter:() => {throw new Error("live writer");}}),/live writer/);
    assert.equal(f.fetches(),0);
  });
  test(f => {
    f.database.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name)
      VALUES('ct_live','r_test','review_fix','context','cx-other',?,'feature')`).run(f.worktree);
    assert.throws(() => f.refresh(),/active protocol task/); assert.equal(f.fetches(),0);
  });
  test(f => {
    f.database.exec(`INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name)
      VALUES('lease','r_test',1,'running','test-runtime')`);
    assert.throws(() => f.refresh(),/preview runtime/); assert.equal(f.fetches(),0);
    assert.equal(git(f.worktree,"rev-parse","HEAD"),f.old,"an active preview still prevents source fast-forward");
  });
  for (const action of ["review_fix_start","repair_start"] as const) test(f => {
    git(f.worktree,"merge","--ff-only",f.head);
    f.database.prepare("UPDATE run_control_requests SET action=?").run(action === "review_fix_start" ? "review_fix" : "ci_repair");
    f.database.exec(`INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name)
      VALUES('lease','r_test',1,'running','test-runtime')`);
    const result=f.refresh(true,action) as {fastForward:boolean;headSha:string};
    assert.equal(result.fastForward,false); assert.equal(result.headSha,f.head);
    assert.equal(f.fetches(),0,"exact-source writer admission needs no fetch");
    assert.ok(f.pulls()>0,"an exact local head still needs live PR validation");
    assert.equal(git(f.worktree,"rev-parse","HEAD"),f.head);
    assert.equal(f.database.prepare("SELECT state FROM preview_leases WHERE lease_id='lease'").get()?.state,"running","the existing preview is retained");
    writeFileSync(resolve(f.worktree,"dirty"),"preserve");
    assert.throws(() => f.refresh(true,action),/dirty worktree preserved/,"preview coexistence does not bypass clean-source admission");
  });
  test(f => {
    f.database.exec(`INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name)
      VALUES('lease','r_test',1,'leased','test-runtime'); UPDATE run_control_requests SET action='preview_start'`);
    f.refresh(true,"preview_up"); assertPreviewSourceRevision(f.worktree,f.head);
  });
  test(f => {
    f.refresh(); f.database.exec("UPDATE runs SET state='remote_owned',owner_state='remote'");
    const result = f.refresh(true,"preview_allocate") as {action:string};
    assert.equal(result.action,"managed_source_already_exact","no-op keeps existing Remote-owned exact-head preview admission");
  });
  test(f => {
    assert.throws(() => f.refresh(true,"review_fix_start",{...f.effects,remoteHead:() => f.old}),/remote branch head changed/);
    assert.equal(f.fetches(),0);
  });
  test(f => {
    const io={...f.effects,pull:(repo:string,num:number) => { const p=f.effects.pull(repo,num); p.head.repo.full_name="other/project"; return p; }};
    assert.throws(() => f.refresh(true,"review_fix_start",io),/live PR/); assert.equal(f.fetches(),0);
  });
  // Exercise the real controller admission dispatch: one shared preflight before
  // each writer/preview entry point, and no manager invocation after refusal.
  for (const action of ["review_fix_start","repair_start","preview_allocate","preview_up"] as const) test(f => {
    f.database.prepare("UPDATE run_control_requests SET action=?").run(action === "review_fix_start" ? "review_fix" : action === "repair_start" ? "ci_repair" : "preview_start");
    let invoked=0;
    runExternal({runId:"r_test",action,requestId:"rq_test"} as PlannedAction,args => {
      invoked++;
      if (invoked === 1) { assert.ok(args[0]!.endsWith("/worktrees/refresh-source.ts")); assert.equal(args[args.indexOf("--action")+1],action); f.refresh(true,action); }
      else { assertPreviewSourceRevision(f.worktree,f.head); }
      return '{"ok":true}';
    });
    assert.equal(invoked,2); assert.equal(git(f.worktree,"rev-parse","HEAD"),f.head);
  });
  let calls=0;
  assert.throws(() => runExternal({runId:"r_test",action:"review_fix_start",requestId:"rq_test"} as PlannedAction,() => {
    calls++; throw new Error("source refused");
  }),/source refused/); assert.equal(calls,1);
  console.log(JSON.stringify({ok:true,cases,managedSource:"external FF, preservation/refusal, dirty/owner/session/repo/branch/context fences, fetch and post-FF races, shared controller admissions"}));
} finally { rmSync(root,{recursive:true,force:true}); }

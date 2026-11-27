import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, copyFileSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { canRepairReviewFixCi } from "../src/orchestrator/runtime/ci-repair-eligibility.ts";
import { reconcileReviewFixRounds } from "../src/orchestrator/runtime/reconcile-review-fix.ts";

const home=mkdtempSync(resolve(tmpdir(),"kurami-review-fix-ci-repair-"));
const env:NodeJS.ProcessEnv={...process.env,KURAMI_HOME:home};
execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator/state/init-run-store.ts")],{env,stdio:"pipe"});
mkdirSync(resolve(home,"config"),{recursive:true});
for(const file of ["projects.yaml","orchestrator.yaml"])copyFileSync(resolve(import.meta.dirname,"../deploy/config",file),resolve(home,"config",file));
const native=(path:string,args:string[])=>JSON.parse(execFileSync(process.execPath,[resolve(import.meta.dirname,"../src/orchestrator",path),...args],{env,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim());
const canonical=resolve(home,"repository"),worktree=resolve(home,"worktrees/task"),bin=resolve(home,"bin");
mkdirSync(canonical);mkdirSync(resolve(home,"worktrees"));mkdirSync(bin);
const realGit=execFileSync("which",["git"],{encoding:"utf8"}).trim();
const git=(dir:string,...args:string[])=>execFileSync(realGit,["-C",dir,...args],{encoding:"utf8",stdio:"pipe"}).trim();
git(canonical,"init","-b","main");git(canonical,"config","user.name","Fixture");git(canonical,"config","user.email","fixture@example.invalid");
writeFileSync(resolve(canonical,"README.md"),"fixture\n");git(canonical,"add","README.md");git(canonical,"commit","-m","fixture");
git(canonical,"remote","add","origin","https://github.com/Shagon1k/PickFlick.git");git(canonical,"worktree","add","-b","task",worktree);
const head=git(worktree,"rev-parse","HEAD"),runId="r_nochange";
const pullPath=resolve(home,"pull.json");
const pull={number:190,state:"open",merged:false,html_url:"https://github.com/Shagon1k/PickFlick/pull/190",
 head:{sha:head,ref:"task",repo:{full_name:"Shagon1k/PickFlick"}},base:{ref:"main",repo:{full_name:"Shagon1k/PickFlick"}}};
writeFileSync(pullPath,JSON.stringify(pull));
writeFileSync(resolve(bin,"git"),`#!${process.execPath}\nimport{execFileSync}from'node:child_process';if(process.argv[2]==='ls-remote')console.log(process.env.FIXTURE_SHA+'\\trefs/heads/task');else process.stdout.write(execFileSync(process.env.FIXTURE_GIT,process.argv.slice(2)));`,{mode:0o700});
writeFileSync(resolve(bin,"gh"),`#!${process.execPath}\nimport{readFileSync}from'node:fs';process.stdout.write(readFileSync(process.env.FIXTURE_PULL));`,{mode:0o700});
writeFileSync(resolve(bin,"tmux"),`#!${process.execPath}\nimport{existsSync,writeFileSync,rmSync}from'node:fs';const cmd=process.argv[2];if(cmd==='has-session')process.exit(existsSync(process.env.FIXTURE_SESSION)?0:1);else if(cmd==='new-session')writeFileSync(process.env.FIXTURE_SESSION,'started');else if(cmd==='kill-session')rmSync(process.env.FIXTURE_SESSION,{force:true});else if(cmd!=='list-sessions')process.exit(1);`,{mode:0o700});
Object.assign(env,{PATH:bin+":"+process.env.PATH,CODEX_BIN:process.execPath,FIXTURE_SHA:head,FIXTURE_GIT:realGit,FIXTURE_PULL:pullPath,FIXTURE_SESSION:resolve(home,"session")});
const projectFile=resolve(home,"config/projects.yaml");
writeFileSync(projectFile,readFileSync(projectFile,"utf8").replace("/home/shagon1k/_projects/PickFlick",canonical).replace("/home/shagon1k/_projects/.worktrees/pickflick",resolve(home,"worktrees")));
mkdirSync(resolve(home,"secrets"),{mode:0o700});
writeFileSync(resolve(home,"secrets/github.env"),"GH_TOKEN="+"fixture_".repeat(5)+"\n",{mode:0o600});
writeFileSync(resolve(bin,"codex"),`#!${process.execPath}\nimport {createInterface} from "node:readline"; for await (const line of createInterface({input:process.stdin})) { const message=JSON.parse(line); if(typeof message.id === "number") console.log(JSON.stringify({id:message.id,result:{}})); }`,{mode:0o700});
env.CODEX_BIN=resolve(bin,"codex");
const database=new DatabaseSync(resolve(home,"state/orchestrator.db"));
try {
  database.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json,processing_state)
    VALUES('e',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'pickflick','item','Issue','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
      VALUES('r_nochange','e','pickflick','item','content','Shagon1k/PickFlick',56,'autonomous','needs_attention','none','live');
    INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
      VALUES('rq_review','r_nochange','review_fix','applied','cli','review');`);
  database.prepare(`INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id)
    VALUES(?,'provisioned',?,'task','primary')`).run(runId,worktree);
  database.prepare(`INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,
    source_head_sha,result_head_sha,snapshot_json,codex_thread_id,failure_reason,completed_at)
    VALUES('rfr_123abc',?,'rq_review',1,'needs_attention','Shagon1k/PickFlick',190,?,'aaaaaaaa',?,'[]','review-worker','review_fix_ci_failed',datetime('now','-1 second'))`)
    .run(runId,pull.html_url,head);
  database.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES(?,'Shagon1k/PickFlick',190,?,?,'failed','[]','fixture',datetime('now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),datetime('now'))`).run(runId,pull.html_url,head);
  database.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,thread_id,turn_id,phase,turn_status,stopped_at,released_at)
    VALUES('review-task',?,'review_fix','rfr_123abc','cx-review',?,'task','review-worker','turn','terminal','completed',datetime('now','-2 seconds'),datetime('now','-1 second'))`).run(runId,worktree);
  database.exec(`INSERT INTO run_codex_task_events(task_id,event_key,method,thread_id,turn_id,status)
      VALUES('review-task','terminal:turn','turn/completed','review-worker','turn','completed');
    INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES('r_nochange','parked_review','needs_attention','review_fix_ci_failed','{"roundId":"rfr_123abc"}');
    INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      VALUES('r_nochange','needs_attention','needs_attention','review_fix_task_archived',
      '{"roundId":"rfr_123abc","reviewFixCodexThreadId":"review-worker","restoredCodexThreadId":"primary"}');`);
  assert.equal(canRepairReviewFixCi(database,runId),true);
  const refusals=[
    "UPDATE runs SET owner_state='remote'", "UPDATE runs SET stop_reason='cancelled'",
    "UPDATE runs SET completion_requested_at='pending',completion_source_event_id='e'", "UPDATE runs SET archived_at='now'",
    "UPDATE run_resources SET previous_codex_thread_id='review-worker'", "UPDATE run_resources SET tmux_session_name='cx-active'",
    "UPDATE run_resources SET resource_state='released'", "UPDATE run_codex_tasks SET released_at=NULL",
    "UPDATE run_codex_tasks SET released_at='2000-01-01'", "UPDATE run_codex_tasks SET turn_status='failed'",
    "UPDATE run_codex_tasks SET stop_requested='cancel'", "DELETE FROM run_codex_task_events",
    "DELETE FROM run_state_history WHERE reason='review_fix_task_archived'",
    "UPDATE run_state_history SET reason='other_blocker' WHERE reason='review_fix_ci_failed'",
    "UPDATE run_ci_snapshots SET head_sha='bbbbbbbb'", "UPDATE run_ci_snapshots SET aggregate_state='passed'",
    "UPDATE run_ci_snapshots SET last_error='unavailable'", "UPDATE run_ci_snapshots SET last_observed_at='2000-01-01'",
    "UPDATE run_ci_snapshots SET pull_request_number=191", "UPDATE run_review_fix_rounds SET failure_reason='review_fix_ci_timeout'",
    "UPDATE run_review_fix_rounds SET round_state='resolving'", "UPDATE run_codex_tasks SET thread_id='other'",
    "UPDATE run_resources SET branch_name='other'",
  ];
  for(const sql of refusals){
    database.exec('SAVEPOINT refusal'); database.exec(sql);
    assert.equal(canRepairReviewFixCi(database,runId),false,sql);
    database.exec('ROLLBACK TO refusal; RELEASE refusal');
  }
  database.exec("UPDATE run_codex_tasks SET released_at=NULL");
  assert.ok(!native('controls/run.ts',['controls','--project','pickflick','--issue','56']).available_actions.includes('ci_repair'));
  assert.throws(()=>native('controls/run.ts',['request','--run-id',runId,'--action','ci_repair','--via','cli','--apply']));
  database.exec("UPDATE run_codex_tasks SET released_at=datetime('now')");
  const controls=native('controls/run.ts',['controls','--project','pickflick','--issue','56']);
  assert.ok(controls.available_actions.includes('ci_repair'));
  const requested=native('controls/run.ts',['request','--run-id',runId,'--action','ci_repair','--via','cli','--apply']);
  assert.equal(canRepairReviewFixCi(database,runId,String(requested.requestId)),true);
  assert.equal(canRepairReviewFixCi(database,runId),false,'Competing request must block admission');
  const repairArgs=['repair','--run-id',runId,'--request-id',requested.requestId,'--apply'];
  const pristine=database.prepare('SELECT * FROM run_review_fix_rounds').get();
  writeFileSync(pullPath,JSON.stringify({...pull,head:{...pull.head,sha:'b'.repeat(40)}}));
  assert.throws(()=>native('projects/sessions/manager.ts',repairArgs));
  writeFileSync(pullPath,JSON.stringify(pull));
  writeFileSync(resolve(worktree,'untracked.txt'),'preserve');
  assert.throws(()=>native('projects/sessions/manager.ts',repairArgs));
  assert.equal(readFileSync(resolve(worktree,'untracked.txt'),'utf8'),'preserve');rmSync(resolve(worktree,'untracked.txt'));
  assert.equal(database.prepare('SELECT COUNT(*) n FROM run_ci_repair_attempts').get()!.n,0);
  assert.equal(database.prepare('SELECT state FROM runs').get()!.state,'needs_attention');
  const launch=native('runtime/controller.ts',['--apply']);
  assert.ok(launch.results.some((r:{action:string;status:string})=>r.action==='repair_start'&&r.status==='applied'));
  const afterLaunch=database.prepare('SELECT * FROM run_review_fix_rounds').get()!;
  assert.deepEqual({...afterLaunch,updated_at:null},{...pristine,updated_at:null},'Repair must not resolve or erase original findings');
  const task=database.prepare('SELECT * FROM run_codex_tasks WHERE released_at IS NULL').get()!;
  database.prepare("UPDATE run_codex_tasks SET thread_id='repair-worker',turn_id='done',phase='terminal',turn_status='completed',stopped_at=datetime('now') WHERE task_id=?").run(task.task_id);
  database.exec(`UPDATE run_resources SET codex_thread_id='repair-worker';
    UPDATE run_ci_repair_attempts SET codex_thread_id='repair-worker';`);
  database.prepare("INSERT INTO run_codex_task_events(task_id,event_key,method,thread_id,turn_id,status) VALUES(?,'terminal:done','turn/completed','repair-worker','done','completed')").run(task.task_id);
  if (process.argv.includes('--no-change-retry')) {
    // Exercise the real park, no-head timeout, cleanup, owner request and claim.
    native('runtime/controller.ts',['--apply']);
    native('runtime/controller.ts',['--apply']);
    assert.equal(database.prepare('SELECT attempt_state FROM run_ci_repair_attempts').get()!.attempt_state,'waiting_ci');
    database.exec("UPDATE run_ci_repair_attempts SET updated_at=datetime('now','-11 minutes')");
    native('runtime/controller.ts',['--apply']);
    native('runtime/controller.ts',['--apply']);
    const initial=database.prepare('SELECT * FROM run_ci_repair_attempts').get()!;
    assert.equal(initial.attempt_state,'needs_attention');
    assert.equal(initial.result_head_sha,null);
    assert.equal(database.prepare('SELECT state FROM runs').get()!.state,'needs_attention');
    assert.equal(database.prepare('SELECT round_state FROM run_review_fix_rounds').get()!.round_state,'needs_attention');
    assert.ok(database.prepare("SELECT 1 FROM run_state_history WHERE reason='ci_repair_task_archived' AND json_extract(details_json,'$.attemptId')=?").get(initial.attempt_id));
    assert.equal(database.prepare('SELECT COUNT(*) n FROM run_ci_repair_attempts').get()!.n,1,'No automatic retry');
    const second=native('controls/run.ts',['request','--run-id',runId,'--action','ci_repair','--via','cli','--apply']);
    assert.notEqual(second.requestId,requested.requestId);
    const secondLaunch=native('runtime/controller.ts',['--apply']);
    assert.ok(secondLaunch.results.some((r:{action:string;status:string})=>r.action==='repair_start'&&r.status==='applied'));
    assert.ok(database.prepare("SELECT 1 FROM run_state_history WHERE reason='ci_repair_no_change_retry_claimed' AND json_extract(details_json,'$.requestId')=?").get(second.requestId));
    const secondTask=database.prepare('SELECT * FROM run_codex_tasks WHERE released_at IS NULL').get()!;
    database.prepare("UPDATE run_codex_tasks SET thread_id='second-worker',turn_id='second-done',phase='terminal',turn_status='completed',stopped_at=datetime('now') WHERE task_id=?").run(secondTask.task_id);
    database.exec("UPDATE run_resources SET codex_thread_id='second-worker'; UPDATE run_ci_repair_attempts SET codex_thread_id='second-worker' WHERE attempt_number=2");
    database.prepare("INSERT INTO run_codex_task_events(task_id,event_key,method,thread_id,turn_id,status) VALUES(?,'terminal:second-done','turn/completed','second-worker','second-done','completed')").run(secondTask.task_id);
  }
  git(worktree,'commit','--allow-empty','-m','repaired fixture');
  const repaired=git(worktree,'rev-parse','HEAD');
  database.prepare("UPDATE run_ci_snapshots SET head_sha=?,aggregate_state='passed',last_observed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')").run(repaired);
  native('runtime/controller.ts',['--apply']);
  // The normal park, CI observation and archive paths must finish before original-scope reconciliation.
  native('runtime/controller.ts',['--apply']);
  native('runtime/controller.ts',['--apply']);
  assert.equal(database.prepare('SELECT attempt_state FROM run_ci_repair_attempts ORDER BY attempt_number DESC LIMIT 1').get()!.attempt_state,'succeeded');
  assert.ok(database.prepare("SELECT 1 FROM run_state_history WHERE reason='ci_repair_task_archived'").get());
  // Controller may attempt GitHub resolution; the fake read-only transport cannot complete it.
  const round=database.prepare('SELECT * FROM run_review_fix_rounds').get()!;
  assert.equal(round.round_state,'resolving');
  assert.equal(round.result_head_sha,repaired);
  assert.equal(round.snapshot_json,pristine!.snapshot_json);
  assert.equal(round.request_id,'rq_review');
  assert.equal(round.failure_reason,null);
  for(const sql of [
    "DELETE FROM run_state_history WHERE reason='review_fix_ci_repair_claimed'",
    "DELETE FROM run_state_history WHERE reason='ci_repair_task_archived'",
    "UPDATE run_ci_repair_attempts SET result_head_sha='bbbbbbbb'",
    "UPDATE run_ci_repair_attempts SET source_head_sha='bbbbbbbb'",
    "UPDATE run_ci_snapshots SET last_error='unavailable'",
    "UPDATE runs SET owner_state='remote'",
    "UPDATE run_codex_tasks SET released_at=NULL WHERE task_id='review-task'",
    "INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES('r_nochange','parked_review','needs_attention','other_blocker','{}')",
    ...(process.argv.includes('--no-change-retry') ? [
      "DELETE FROM run_state_history WHERE reason='ci_repair_no_change_retry_claimed'",
      "UPDATE run_state_history SET details_json=json_set(details_json,'$.requestId','other') WHERE reason='ci_repair_no_change_retry_claimed'",
      "UPDATE run_state_history SET details_json=json_set(details_json,'$.sourceHeadSha','other') WHERE reason='ci_repair_no_change_retry_claimed'",
      "UPDATE run_state_history SET details_json=json_set(details_json,'$.attemptNumber',1) WHERE reason='ci_repair_no_change_retry_claimed'",
      "UPDATE run_state_history SET details_json=json_set(details_json,'$.attemptId','other') WHERE reason='ci_repair_no_new_head'",
      "UPDATE run_ci_repair_attempts SET failure_reason='other' WHERE attempt_number=1",
      "UPDATE run_ci_repair_attempts SET source_head_sha='bbbbbbbb' WHERE attempt_number=2",
      "UPDATE run_control_requests SET request_state='failed' WHERE request_id=(SELECT request_id FROM run_ci_repair_attempts WHERE attempt_number=2)",
    ] : []),
  ]) {
    database.exec('SAVEPOINT recovery');
    database.prepare("UPDATE run_review_fix_rounds SET round_state='needs_attention',result_head_sha=?,failure_reason='review_fix_ci_failed',completed_at=datetime('now','-1 second')").run(head);
    database.exec(sql); reconcileReviewFixRounds(database);
    assert.equal(database.prepare('SELECT round_state FROM run_review_fix_rounds').get()!.round_state,'needs_attention',sql);
    database.exec('ROLLBACK TO recovery; RELEASE recovery');
  }
  const key=resolve(home,'secrets/reviewer.pem');
  writeFileSync(key,generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey,{mode:0o600});
  writeFileSync(resolve(home,'secrets/github-reviewer-app.env'),`KURAMI_GITHUB_REVIEWER_APP_ID=1\nKURAMI_GITHUB_REVIEWER_INSTALLATION_ID=2\nKURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE=${key}\n`,{mode:0o600});
  const transport=resolve(home,'github-fixture.mjs');
  writeFileSync(transport,"globalThis.fetch = async (input, init) => {\n  const url = String(input);\n  const payload = JSON.parse(String(init?.body ?? \"{}\"));\n  if (url.includes(\"/app/installations/\") && url.endsWith(\"/access_tokens\"))\n    return new Response(JSON.stringify({ token: \"installation_token_1234567890\", expires_at: \"2099-01-01T00:00:00.000Z\" }), { status: 201 });\n  if (url.includes(\"/comments/711/replies\"))\n    return new Response(JSON.stringify({ id: 712 }), { status: 201 });\n  if (url.endsWith(\"/graphql\") && payload.query?.includes(\"query(\"))\n    return new Response(JSON.stringify({ data: { node: { isResolved: false, comments: { nodes: [] } } } }), { status: 200 });\n  if (url.endsWith(\"/graphql\") && payload.query?.includes(\"mutation(\"))\n    return new Response(JSON.stringify({ data: { resolveReviewThread: { thread: { id: \"thread-pf-11\", isResolved: true } } } }), { status: 200 });\n  throw new Error(\"Unexpected fake GitHub request: \" + url);\n};\n");
  env.NODE_OPTIONS=`${process.env.NODE_OPTIONS ?? ''} --import=${transport}`.trim();
  database.exec(`INSERT INTO run_review_fix_threads(round_id,thread_id,root_comment_id,source_kind,path,thread_state)
    VALUES('rfr_123abc','thread-pf-11',711,'ai','README.md','pending')`);
  const resolved=native('runtime/controller.ts',['--apply']);
  assert.ok(resolved.results.some((r:{action:string;status:string})=>r.action==='review_fix_resolve'&&r.status==='applied'));
  assert.equal(database.prepare('SELECT round_state FROM run_review_fix_rounds').get()!.round_state,'succeeded');
  assert.equal(database.prepare('SELECT thread_state FROM run_review_fix_threads').get()!.thread_state,'resolved');
  assert.equal(database.prepare('SELECT reply_comment_id FROM run_review_fix_threads').get()!.reply_comment_id,712);
  console.log(JSON.stringify({ok:true,reviewFixCiRepair:true,refusals:refusals.length,nativeLaunch:true,originalScopeReconciliation:true,noChangeRetry:process.argv.includes('--no-change-retry')}));
} finally {database.close();rmSync(home,{recursive:true,force:true});}
if (!process.argv.includes('--no-change-retry'))
  execFileSync(process.execPath,[import.meta.filename,'--no-change-retry'],{env:process.env,stdio:'inherit'});

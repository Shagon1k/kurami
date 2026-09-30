import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { requestProjectsReview, ProjectsActionError } from "../../src/projects-site/actions.ts";
import { aiReviewStable, reviewContextMatches } from "../../src/orchestrator/controls/ai-review.ts";
import { collectProjectsSnapshot } from "../../src/projects-site/snapshot.ts";
import { createProjectsServer } from "../../src/projects-site/server.ts";

const home = mkdtempSync(join(tmpdir(), "kurami-projects-controls-"));
const at = "2026-10-01T09:00:00Z";
const head = "a".repeat(40); const previousHead = "b".repeat(40);
const pr = "https://github.com/Example/Alpha/pull/20";
mkdirSync(join(home,"config")); mkdirSync(join(home,"state"));
writeFileSync(join(home,"config/projects.yaml"), JSON.stringify({ projects: { alpha: { owner: "Example", project_number: 1, repository: "Example/Alpha", statuses: { backlog: "Todo", active: "Doing", review: "Review", done: "Done", deferred: "Later" } } } }));
const database = new DatabaseSync(join(home,"state/orchestrator.db"));
database.exec("PRAGMA foreign_keys=ON");
const migrations = resolve(import.meta.dirname,"../../migrations");
const tables = ["run_control_requests","run_ci_repair_attempts","run_ai_reviews","run_autonomous_successions","run_review_fix_rounds","run_review_fix_threads","run_review_fix_operations"];
const options = { home, now: new Date(at) };
const input = () => ({ runId: "r_current", project: "alpha", itemId: "item12", head, key: randomUUID() });
function reject(value: ReturnType<typeof input>, pattern: RegExp): void {
  const before = database.prepare("SELECT COUNT(*) AS n FROM run_control_requests").get();
  assert.throws(() => requestProjectsReview(value,"owner",options), error => error instanceof ProjectsActionError && pattern.test(error.message));
  assert.deepEqual(database.prepare("SELECT COUNT(*) AS n FROM run_control_requests").get(),before,"rejection never writes a request");
}
try {
  for (const file of readdirSync(migrations).filter(name => /^\d+_.*\.sql$/.test(name) && name < "033_").sort()) database.exec(readFileSync(join(migrations,file),"utf8"));
  database.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,payload_json) VALUES('e_current',?,'alpha','item12','issue12','Issue','{}')").run(at);
  database.exec("INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode) VALUES('r_current','e_current','alpha','item12','issue12','Example/Alpha',12,'autonomous','parked_review','none','live')");
  database.exec("INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id) VALUES('r_current','provisioned','/tmp/fixture-worktree','fixture-branch','thread12')");
  database.prepare("INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at) VALUES('alpha','item12','Issue','Example/Alpha',12,'Review fixture','https://github.com/Example/Alpha/issues/12','Review',1,?,?)").run(at,at);
  database.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('alpha',?,?,1,'succeeded')").run(at,at);
  database.prepare("INSERT INTO run_ci_snapshots(run_id,repository,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at) VALUES('r_current','Example/Alpha',?,?,'passed','[]','digest',?,?,?)").run(pr,head,at,at,at);
  for (const [id,action] of [["repair","ci_repair"],["review","ai_review"],["fix","review_fix"],["successor","take_control"],["recover","recover_managed_task"]])
    database.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state,result_json,completed_at) VALUES(?,'r_current',?,'discord',?,'applied','{}',?)").run("q_"+id,action,id,at);
  database.prepare("INSERT INTO run_ci_repair_attempts(attempt_id,run_id,request_id,attempt_number,source_head_sha,source_ci_state,source_checks_json,attempt_state) VALUES('repair1','r_current','q_repair',1,?,'failed','[]','succeeded')").run(previousHead);
  database.prepare("INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name) VALUES('review1','r_current','q_review',1,'ready','Example/Alpha',20,?,'main',?,?,'fixture-review')").run(pr,previousHead,previousHead);
  database.prepare("INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,source_head_sha,snapshot_json,waiting_ci_started_at) VALUES('fix1','r_current','q_fix',1,'succeeded','Example/Alpha',20,?,?,'{}',?)").run(pr,previousHead,at);
  database.exec("INSERT INTO run_review_fix_threads(round_id,thread_id,root_comment_id,source_kind,path,thread_state) VALUES('fix1','thread1',1,'ai','file.ts','resolved')");
  database.exec("INSERT INTO run_review_fix_operations(round_id,operation_kind,operation_state,task_codex_thread_id,previous_codex_thread_id) VALUES('fix1','cleanup','completed','task-thread','previous-thread')");
  database.exec("INSERT INTO run_review_fix_operations(round_id,operation_kind,operation_state,request_id,task_codex_thread_id,previous_codex_thread_id,tmux_session_name) VALUES('fix1','managed_recovery','completed','q_recover','task-thread','previous-thread','fixture-fix')");
  database.prepare("INSERT INTO run_autonomous_successions(succession_id,run_id,request_id,succession_number,succession_state,predecessor_thread_id,worktree_path,branch_name,source_head_sha,handoff_context_json) VALUES('successor1','r_current','q_successor',1,'parked','previous-thread','/tmp/fixture-worktree','fixture-branch',?,'{}')").run(previousHead);
  const before = tables.map(table => database.prepare(`SELECT * FROM ${table}`).all());
  const indexes = database.prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name").all();
  database.exec("BEGIN IMMEDIATE"); database.exec(readFileSync(join(migrations,"033_projects_controls.sql"),"utf8")); database.exec("COMMIT");
  assert.deepEqual(tables.map(table => database.prepare(`SELECT * FROM ${table}`).all()),before,"populated v32 upgrade preserves every control and dependent record");
  assert.deepEqual(database.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name<>'run_control_project_context' ORDER BY name").all(),indexes,"all original indexes survive");
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
  assert.equal(collectProjectsSnapshot({ ...options, controlsEnabled: true }).items[0]!.aiReview?.enabled,true);
  const firstInput = input(); const first = requestProjectsReview(firstInput,"owner",options);
  assert.equal(first.state,"created");
  assert.equal(requestProjectsReview(firstInput,"owner",options).requestId,first.requestId,"network retry is durable and idempotent");
  assert.equal(requestProjectsReview(input(),"owner",options).requestId,first.requestId,"double click across renders shares one pending action");
  assert.equal(database.prepare("SELECT requested_via FROM run_control_requests WHERE request_id=?").get(first.requestId)?.requested_via,"projects");
  assert.equal(collectProjectsSnapshot({ ...options, controlsEnabled: true }).items[0]!.review.state,"queued");
  assert.equal(collectProjectsSnapshot({ ...options, controlsEnabled: true }).items[0]!.aiReview?.enabled,false);
  assert.equal(reviewContextMatches(database,first.requestId,head,pr),true);
  assert.equal(reviewContextMatches(database,first.requestId,previousHead,pr),false,"worker refuses a different commit");
  assert.equal(reviewContextMatches(database,first.requestId,head,pr.replace("20","21")),false,"worker refuses a different PR");
  assert.equal(reviewContextMatches(database,"q_review",head,pr),true,"Discord requests retain their existing behavior");
  database.prepare("UPDATE run_control_requests SET request_state='failed' WHERE request_id=?").run(first.requestId);
  assert.equal(collectProjectsSnapshot({ ...options, controlsEnabled: true }).items[0]!.review.state,"request_failed","worker rejection is visible rather than hidden by an older review");
  assert.equal(requestProjectsReview(firstInput,"owner",options).requestId,first.requestId,"an old nonce never creates another worker after completion");
  reject({...input(),head:previousHead},/Коммит изменился/);
  reject({...input(),project:"other"},/Проект/);
  reject({...input(),itemId:"other"},/Запуск/);
  reject({...input(),runId:["r_current"] as unknown as string},/Некорректный/);
  database.exec("UPDATE project_poll_state SET last_captured_at='2026-10-01T08:00:00Z'"); reject(input(),/Синхронизация/);
  database.prepare("UPDATE project_poll_state SET last_captured_at=?").run(at);
  database.exec("UPDATE run_resources SET tmux_session_name='active-writer'"); reject(input(),/недоступно/);
  database.exec("UPDATE run_resources SET tmux_session_name=NULL; UPDATE runs SET execution_mode='dry_run'"); reject(input(),/недоступно/);
  database.exec("UPDATE runs SET execution_mode='live'; UPDATE run_ai_reviews SET head_sha='"+head+"'"); reject(input(),/уже готово/);
  database.prepare("UPDATE run_ai_reviews SET head_sha=?").run(previousHead);
  database.exec("UPDATE project_items SET present=0"); reject(input(),/недоступно/); database.exec("UPDATE project_items SET present=1");
  database.exec("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES('q_pending','r_current','ai_review','discord','discord-pending')");
  assert.equal(requestProjectsReview(input(),"owner",options).requestId,"q_pending","a Discord click is deduplicated against the same queue");
  database.exec("UPDATE run_control_requests SET request_state='applied' WHERE request_id='q_pending'");
  database.exec("UPDATE runs SET state='cancelled' WHERE run_id='r_current'; INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,payload_json) VALUES('e_new','2026-10-01T09:00:00Z','alpha','item12','issue12','Issue','{}'); INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state) VALUES('r_new','e_new','alpha','item12','issue12','Example/Alpha',12,'autonomous','running')");
  reject(input(),/недоступно/);
  assert.equal(aiReviewStable({ state: "parked_review", owner_state: "none", resource_state: "provisioned", tmux_session_name: null, worktree_path: "fixture", branch_name: "fixture", active_repair_count: 0, active_review_count: 0 }),true);

  let authorized = false; let writes = 0;
  const server = createProjectsServer({ authorize: async () => authorized ? "owner" : null, snapshot: () => collectProjectsSnapshot(options),
    review: () => { writes++; return { state: "created", requestId: "fixture", requestState: "pending" }; } });
  await new Promise<void>(done => server.listen(0,"127.0.0.1",done));
  const base = `http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const post = (headers: Record<string,string>,body = JSON.stringify(input())) => fetch(base+"/api/ai-review",{method:"POST",headers,body});
    const headers = { Origin: "https://projects.shagon1k.win", "Content-Type": "application/json" };
    assert.equal((await post(headers)).status,403); authorized=true;
    assert.equal((await post({...headers,Origin:"https://evil.example"})).status,403);
    assert.equal((await post({"Content-Type":"application/json"})).status,403);
    assert.equal((await post({...headers,"Content-Type":"text/plain"})).status,403);
    assert.equal((await post({...headers,"Sec-Fetch-Site":"cross-site"})).status,403);
    assert.equal((await post(headers,"not json")).status,400);
    assert.equal((await post(headers,"x".repeat(5000))).status,413);
    assert.equal(writes,0,"authorization, CSRF, content-type and body bounds precede writes");
    assert.equal((await post(headers)).status,202); assert.equal(writes,1);
  } finally { await new Promise<void>(done => server.close(()=>done())); }
} finally { database.close(); rmSync(home,{recursive:true,force:true}); }
console.log("Projects controls: populated v32 upgrade, shared eligibility/queue, exact PR/SHA, provenance, stale reads, durable retries and CSRF verified");

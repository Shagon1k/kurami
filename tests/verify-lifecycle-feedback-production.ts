import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { stringify } from "yaml";
import { deliverControllerTicketFeedback, feedbackStore, githubFeedbackAdapter, reconcileCommittedTicketFeedback, withFeedbackLock } from "../src/orchestrator/projects/lifecycle-feedback-production.ts";

const app = resolve(import.meta.dirname, "..");
const home = await mkdtemp(resolve(tmpdir(), "kurami-ticket-feedback-"));
const repository = "Owner/Fixture", head = "a".repeat(40), mergeSha = "b".repeat(40);
const bin = resolve(home, "bin");
const env = { ...process.env, KURAMI_HOME: home, PATH: `${bin}:${process.env.PATH}`, POLLER_PROJECT: "fixture", POLLER_QUIET: "1" };
const cli = (file: string, ...args: string[]) => execFileSync(process.execPath, [resolve(app, file), ...args], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
let db: DatabaseSync | undefined;
try {
  await mkdir(resolve(home, "config"), { recursive: true });
  await mkdir(bin); await mkdir(resolve(home, "secrets"));
  await copyFile(resolve(app, "deploy/config/orchestrator.yaml"), resolve(home, "config/orchestrator.yaml"));
  await writeFile(resolve(home, "config/projects.yaml"), stringify({ version: 1, projects: { fixture: {
    owner: "Owner", project_number: 1, repository, status_field: "Status", human_control_label: "human-control",
    statuses: { backlog: "Backlog", active: "In progress", review: "Human Review", done: "Done", deferred: "Deferred" },
    workspace: { canonical_repository: resolve(home, "canonical"), worktree_root: resolve(home, "worktrees"), branch_prefix: "fixture", base_branch: "main" },
  } } }));
  // Synthetic disposable credential. No real auth files are read or changed.
  await writeFile(resolve(home, "secrets/github.env"), "GH_TOKEN=synthetic_fixture_token_never_valid\n", { mode: 0o600 });
  const issueFile = resolve(home, "issue.json");
  const issue = { state: "OPEN", status: "Human Review" };
  await writeFile(issueFile, JSON.stringify(issue));
  await writeFile(resolve(home, "comments.json"), "[]");
  await writeFile(resolve(bin, "gh"), `#!${process.execPath}
const fs=require('fs'),p=require('path'),h=process.env.KURAMI_HOME,a=process.argv.slice(2),repository='Owner/Fixture';
const issue=JSON.parse(fs.readFileSync(p.join(h,'issue.json'))),file=p.join(h,'comments.json'),comments=JSON.parse(fs.readFileSync(file));
fs.appendFileSync(p.join(h,'gh.log'),JSON.stringify(a)+'\\n');
const out=x=>console.log(JSON.stringify(x));
if(a[0]==='api'&&a[1]==='graphql') out({data:{user:{projectV2:{items:{nodes:[{id:'item',type:'ISSUE',fieldValueByName:{name:issue.status},content:{__typename:'Issue',id:'content',number:1,title:'Partial delivery',url:'https://github.com/'+repository+'/issues/1',state:issue.state,body:'Refresh jobs remain pending',labels:{nodes:[]},repository:{nameWithOwner:repository}}}],pageInfo:{hasNextPage:false,endCursor:null}}}}}});
else if(a[0]==='api'&&a[1]==='--method'){
 const method=a[2],endpoint=a[3];
 if(method==='GET'&&(endpoint==='user'||endpoint==='users/Owner'))out({id:123});
 else if(method==='GET'&&endpoint==='repos/'+repository+'/issues/1')out({url:'https://api.github.com/repos/'+repository+'/issues/1',state:issue.state.toLowerCase()});
 else if(method==='GET'&&endpoint==='repos/'+repository+'/pulls/7')out({number:7,url:'https://api.github.com/repos/'+repository+'/pulls/7',merged:true,merged_at:'2026-10-10T12:00:00Z',merge_commit_sha:'${mergeSha}',head:{sha:'${head}'},base:{ref:'main',repo:{full_name:repository}}});
 else if(method==='GET'&&endpoint.startsWith('repos/'+repository+'/issues/1/comments?'))out(comments);
 else if(method==='POST'&&endpoint==='repos/'+repository+'/issues/1/comments'){
  const body=JSON.parse(fs.readFileSync(0,'utf8')).body;
  const c={id:100+comments.length,issue_url:'https://api.github.com/repos/'+repository+'/issues/1',user:{id:123},body}; comments.push(c); fs.writeFileSync(file,JSON.stringify(comments));out(c);
 } else if(method==='PATCH'&&endpoint.startsWith('repos/'+repository+'/issues/comments/')){
  if(fs.existsSync(p.join(h,'fail-update')))process.exit(93);
  const id=Number(endpoint.split('/').pop()),c=comments.find(c=>c.id===id);c.body=JSON.parse(fs.readFileSync(0,'utf8')).body;fs.writeFileSync(file,JSON.stringify(comments));out(c);
 } else process.exit(94);
} else process.exit(95);
`);
  await chmod(resolve(bin, "gh"), 0o700);
  cli("src/orchestrator/state/init-run-store.ts");
  db = new DatabaseSync(resolve(home, "state/orchestrator.db"));
  assert.equal(cli("src/orchestrator/projects/poll-projects.ts"), "");
  for (const [id, state] of [["historical-running", "parked_review"], ["historical-cancelled", "cancelled"]]) {
    db.prepare(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,repository,issue_number,payload_json,processing_state)
      VALUES(?,'2026-10-10','fixture','item','Issue','Owner/Fixture',1,'{}','processed')`).run(id!);
    db.prepare(`INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
      VALUES(?,?,'fixture','item','content','Owner/Fixture',1,'autonomous',?,'live')`).run(id!, id!, state!);
  }
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,payload_json,processing_state)
    VALUES('trigger','2026-10-10','fixture','item','content','Issue','Owner/Fixture',1,'Partial delivery','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
    VALUES('r_fixture','trigger','fixture','item','content','Owner/Fixture',1,'autonomous','archived','live');
    INSERT INTO run_resources(run_id,resource_state) VALUES('r_fixture','released');
    INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
    VALUES('r_fixture','stopping','archived','merged_worktree_release_completed','{"headSha":"${head}","mergedPullRequestNumber":7}');
    INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES('r_fixture','Owner/Fixture',7,'https://github.com/Owner/Fixture/pull/7','${head}','passed','[]','ci','2026-10-10','2026-10-10','2026-10-10');
    INSERT INTO run_progress_cards(run_id,stage,detail,content_digest) VALUES('r_fixture','completed','resources released','fixture');`);
  db.exec("UPDATE runs SET item_id='cancelled-item' WHERE run_id='historical-cancelled'");
  const controller = () => cli("src/orchestrator/runtime/controller.ts", "--apply");
  const comments = async () => JSON.parse(await readFile(resolve(home, "comments.json"), "utf8")) as Array<{id:number;body:string}>;
  const noHistoricalRequest = () => { assert.fail("historical attempt made a GitHub request"); };
  assert.deepEqual(await reconcileCommittedTicketFeedback(db, { fixture: { owner: "Owner", repository,
    workspace: { base_branch: "main" } } }, githubFeedbackAdapter(noHistoricalRequest), noHistoricalRequest, feedbackStore(db)), []);
  assert.equal(Number(db.prepare("SELECT count(*) n FROM github_lifecycle_snapshots").get()!.n), 0);
  assert.equal(Number(db.prepare("SELECT count(*) n FROM github_lifecycle_feedback").get()!.n), 0);
  assert.equal((await comments()).length, 0);
  db.exec("DELETE FROM runs WHERE run_id LIKE 'historical-%'; DELETE FROM project_events WHERE event_id LIKE 'historical-%'");
  console.log("PASS historical archived merge/cancelled/superseded attempts without new triggers make no GitHub requests or feedback writes");
  db.exec("UPDATE runs SET state='parked_review' WHERE run_id='r_fixture'");
  let currentRequests = 0;
  const unavailable = () => { currentRequests++; throw new Error("synthetic_network_failure"); };
  const current = await reconcileCommittedTicketFeedback(db, { fixture: { owner: "Owner", repository,
    workspace: { base_branch: "main" } } }, githubFeedbackAdapter(unavailable), unavailable, feedbackStore(db));
  assert.deepEqual(current.map(r => [r.runId, r.status, r.error]), [["r_fixture", "failed", "github_unavailable"]]);
  assert.equal(currentRequests, 1);
  db.exec("UPDATE runs SET state='archived' WHERE run_id='r_fixture'; DELETE FROM github_lifecycle_feedback");
  console.log("PASS only latest managed nonterminal attempt remains eligible without a merge/issue trigger");
  db.exec(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
    VALUES('r_fixture','parked_review','stopping','merged_delivery_completion_requested','{}')`);
  controller(); assert.equal((await comments()).length, 1);
  assert.match((await comments())[0]!.body, /PR влит/u);
  assert.match((await comments())[0]!.body, /merged delivery resources released/u);
  assert.equal(db.prepare("SELECT status FROM project_items").get()!.status, "Human Review");
  const rev = Number(db.prepare("SELECT revision FROM github_lifecycle_snapshots").get()!.revision);
  const logBefore = await readFile(resolve(home, "gh.log"), "utf8");
  controller(); assert.equal(Number(db.prepare("SELECT revision FROM github_lifecycle_snapshots").get()!.revision), rev);
  const logAfter = (await readFile(resolve(home, "gh.log"), "utf8")).slice(logBefore.length);
  assert.equal(logAfter, "", "delivered terminal replay must make zero GitHub requests");
  console.log("PASS applied production controller creates one comment; delivered terminal replay makes zero GitHub requests");
  const quietReplay = async () => {
    const before = await readFile(resolve(home, "gh.log"), "utf8");
    controller();
    const added = (await readFile(resolve(home, "gh.log"), "utf8")).slice(before.length);
    // Cancellation can independently reconcile the board through GraphQL.
    const restRequests = added.trim().split("\n").filter(Boolean)
      .map(line => JSON.parse(line) as string[]).filter(args => args[1] !== "graphql");
    assert.deepEqual(restRequests, [], "delivered terminal feedback must make zero REST requests");
  };
  db.exec("UPDATE runs SET updated_at='2099-01-01'; UPDATE project_items SET last_seen_at='2099-01-01'");
  await quietReplay();
  console.log("PASS poll timestamps do not wake delivered terminal feedback");
  const previous = db.prepare("SELECT delivery_key,snapshot_json FROM github_lifecycle_snapshots").get()!;
  const legacy = JSON.parse(String(previous.snapshot_json)); delete legacy.localFactsDigest;
  db.prepare("UPDATE github_lifecycle_snapshots SET snapshot_json=? WHERE delivery_key=?").run(JSON.stringify(legacy), previous.delivery_key!);
  const beforeLegacy = await readFile(resolve(home, "gh.log"), "utf8");
  controller();
  assert.notEqual(await readFile(resolve(home, "gh.log"), "utf8"), beforeLegacy);
  assert.equal((await comments()).length, 1);
  await quietReplay();
  console.log("PASS legacy terminal snapshot refreshes once, preserves its comment, then makes zero requests");

  for (const state of ["CLOSED", "OPEN"]) {
    await writeFile(issueFile, JSON.stringify({ ...issue, state }));
    const output = cli("src/orchestrator/projects/poll-projects.ts");
    assert.match(output, /issue .* →/u); assert.ok(!output.includes("Backlog →"));
    const event: Record<string, string | number | bigint | Uint8Array | null> = db.prepare("SELECT * FROM project_events WHERE event_kind='issue_state' ORDER BY rowid DESC LIMIT 1").get()!;
    assert.equal(event.from_status, "Human Review"); assert.equal(event.to_status, "Human Review");
    assert.equal(cli("src/orchestrator/projects/poll-projects.ts"), "");
    cli("src/orchestrator/projects/process-project-events.ts");
    assert.equal(db.prepare("SELECT processing_state FROM project_events WHERE event_id=?").get(event.event_id!)!.processing_state, "ignored");
    controller();
    assert.equal((await comments()).length, 1);
    assert.match((await comments())[0]!.body, new RegExp(`; ${state.toLowerCase()}\\.`));
    assert.equal(Number(db.prepare("SELECT count(*) n FROM runs").get()!.n), 1);
    assert.equal(db.prepare("SELECT state FROM runs").get()!.state, "archived");
    assert.equal(db.prepare("SELECT status FROM project_items").get()!.status, "Human Review");
    await quietReplay();
  }
  console.log("PASS full CLI poll -> consumer -> controller: close/reopen same column persisted and acknowledged without fake start/cancel/Done");
  await writeFile(issueFile, JSON.stringify({ ...issue, status: "Deferred" }));
  cli("src/orchestrator/projects/poll-projects.ts"); cli("src/orchestrator/projects/process-project-events.ts"); controller();
  assert.match((await comments())[0]!.body, /project_status.*ignored/u);
  await quietReplay();
  console.log("PASS ignored manual board transition visibly acknowledged without changing terminal run");

  await writeFile(resolve(home, "fail-update"), "yes");
  db.exec("UPDATE runs SET stop_reason='cancelled',state='cancelled'; DELETE FROM run_progress_cards WHERE run_id='r_fixture'");
  controller();
  assert.match(String(db.prepare("SELECT detail FROM run_progress_cards WHERE run_id='r_fixture'").get()!.detail), /Ticket feedback pending/);
  assert.equal(db.prepare("SELECT delivery_error FROM github_lifecycle_feedback").get()!.delivery_error, "github_unavailable");
  const failedDigest = db.prepare("SELECT content_digest FROM run_progress_cards WHERE run_id='r_fixture'").get()!.content_digest;
  db.exec("UPDATE run_progress_cards SET delivery_state='delivered' WHERE run_id='r_fixture'");
  controller();
  assert.equal(db.prepare("SELECT content_digest FROM run_progress_cards WHERE run_id='r_fixture'").get()!.content_digest, failedDigest);
  assert.equal(db.prepare("SELECT delivery_state FROM run_progress_cards WHERE run_id='r_fixture'").get()!.delivery_state, "delivered");
  await rm(resolve(home, "fail-update")); controller();
  assert.ok(!String(db.prepare("SELECT detail FROM run_progress_cards WHERE run_id='r_fixture'").get()!.detail).includes("Ticket feedback pending"));
  assert.match((await comments())[0]!.body, /Отменён/u);
  await quietReplay();
  console.log("PASS failed delivery visible on existing notifier progress card; cancellation has priority; retry edits existing comment");

  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,payload_json,processing_state)
    VALUES('successor','2026-10-10','fixture','item','content','Issue','Owner/Fixture',1,'{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
    VALUES('r_newer','successor','fixture','item','content','Owner/Fixture',1,'autonomous','archived','live');
    INSERT INTO run_resources(run_id,resource_state) VALUES('r_newer','released');`);
  controller(); assert.equal((await comments()).length, 1);
  assert.match((await comments())[0]!.body, /Более новый запуск: r_newer/u);
  assert.equal(db.prepare("SELECT status FROM project_items").get()!.status, "Deferred");
  assert.equal(Number(db.prepare("SELECT count(*) n FROM github_lifecycle_snapshots WHERE json_extract(snapshot_json,'$.runId')='r_newer'").get()!.n), 0);
  console.log("PASS superseded historical run is labelled; never overwrites newer owner board state");
  await writeFile(issueFile, JSON.stringify({ ...issue, status: "Deferred", state: "CLOSED" }));
  cli("src/orchestrator/projects/poll-projects.ts"); cli("src/orchestrator/projects/process-project-events.ts"); controller();
  assert.equal((await comments()).length, 2);
  assert.match((await comments())[1]!.body, /issue OPEN - CLOSED/u);
  assert.equal(db.prepare("SELECT state FROM runs WHERE run_id='r_newer'").get()!.state, "archived");
  assert.equal(db.prepare("SELECT status FROM project_items").get()!.status, "Deferred");
  console.log("PASS independent new issue close acknowledges latest previously untracked archived run only; no board mutation");

  db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key,result_json)
    VALUES('refused','r_fixture','take_control','rejected','cli','refused','{"reason":"cancellation_requested"}');`);
  controller(); assert.match((await comments())[0]!.body, /refused.*refused.*cancellation_requested/u);
  db.exec("UPDATE run_control_requests SET request_state='applied',result_json='{}' WHERE request_id='refused'");
  controller(); assert.match((await comments())[0]!.body, /refused.*applied/u);
  assert.equal((await comments()).length, 2);
  console.log("PASS durable applied/refused explicit requests update same run comment with safe reason");

  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,repository,issue_number,from_status,to_status,event_kind,payload_json)
    VALUES('no-run-close','2026-10-10','fixture','unstarted-item','Issue','Owner/Fixture',2,'Backlog','Backlog','issue_state','{"previousIssueState":"OPEN","issueState":"CLOSED"}');`);
  const noRunOutput = execFileSync(process.execPath, [resolve(app, "src/orchestrator/projects/process-project-events.ts")], {
    encoding: "utf8", env: { ...env, CONSUMER_QUIET: "1" }, stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(noRunOutput, /project_trigger_outcome.*no-run-close.*No eligible run/u);
  assert.equal(Number(db.prepare("SELECT count(*) n FROM runs").get()!.n), 2);
  console.log("PASS no-run close observation uses existing poller stdout notifier path, never creates a run");

  await withFeedbackLock(home, async () => {
    assert.throws(() => execFileSync("flock", ["-n", resolve(home, "state/github-lifecycle-feedback.lock"), "true"], { stdio: "ignore" }));
  });
  execFileSync("flock", ["-n", resolve(home, "state/github-lifecycle-feedback.lock"), "true"]);
  console.log("PASS cross-process flock retained through delivery and released afterwards");

  // Exercise the global (pre-delivery) catch, not the per-run network catch.
  const projectsPath = resolve(home, "config/projects.yaml"), savedProjects = await readFile(projectsPath, "utf8");
  for (const file of ["projects.yaml", "orchestrator.yaml"]) {
    const path = resolve(home, "config", file), saved = await readFile(path, "utf8");
    // Fail before token/gh even when testing the fallback progress projection.
    await writeFile(projectsPath, "[invalid yaml");
    await writeFile(path, "[invalid yaml");
    assert.equal(await deliverControllerTicketFeedback(db, home), false);
    const first: Record<string, unknown> = db.prepare("SELECT detail,content_digest FROM run_progress_cards WHERE run_id='r_fixture'").get()!;
    assert.match(String(first.detail), /Ticket feedback pending: github_unavailable\./u);
    db.exec("UPDATE run_progress_cards SET delivery_state='delivered'");
    assert.equal(await deliverControllerTicketFeedback(db, home), false);
    const repeated: Record<string, unknown> = db.prepare("SELECT detail,content_digest,delivery_state FROM run_progress_cards WHERE run_id='r_fixture'").get()!;
    assert.equal(repeated.detail, first.detail); assert.equal(repeated.content_digest, first.content_digest);
    assert.equal(repeated.delivery_state, "delivered");
    await writeFile(path, saved);
    await writeFile(projectsPath, savedProjects);
    controller();
  }
  console.log("PASS repeated global config failure preserves safe detail/digest/delivered notifier state, including unavailable progress config; recovery clears failure");
  await withFeedbackLock(home, async () => {
    assert.equal(await deliverControllerTicketFeedback(db!, home), false);
    const first = db!.prepare("SELECT detail,content_digest FROM run_progress_cards WHERE run_id='r_fixture'").get()!;
    db!.exec("UPDATE run_progress_cards SET delivery_state='delivered'");
    assert.equal(await deliverControllerTicketFeedback(db!, home), false);
    const repeated = db!.prepare("SELECT detail,content_digest,delivery_state FROM run_progress_cards WHERE run_id='r_fixture'").get()!;
    assert.equal(repeated.detail, first.detail); assert.equal(repeated.content_digest, first.content_digest);
    assert.equal(repeated.delivery_state, "delivered");
  });
  controller();
  assert.ok(!String(db.prepare("SELECT detail FROM run_progress_cards WHERE run_id='r_fixture'").get()!.detail).includes("Ticket feedback pending"));
  console.log("PASS repeated global lock timeout preserves notifier digest/delivery state; recovery clears error");

  // Real SQLite connections: the timed-out lane observes rev 1, then the lock
  // holder commits rev 2 immediately before its error write reaches SQLite.
  const key = String(db.prepare("SELECT delivery_key FROM github_lifecycle_snapshots WHERE json_extract(snapshot_json,'$.runId')='r_fixture'").get()!.delivery_key);
  const savedDelivery = await feedbackStore(db).load(key);
  await feedbackStore(db).save(key, { revision: 1, commentId: 100, deliveredDigest: "old", createPending: false, error: null });
  const concurrent = new DatabaseSync(resolve(home, "state/orchestrator.db"));
  let interleaved = false;
  const failingLane = new Proxy(db, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => {
        const statement = target.prepare(sql);
        if (!sql.includes("INSERT INTO github_lifecycle_feedback")) return statement;
        return new Proxy(statement, { get(s, p) {
          if (p === "run") return (...args: Parameters<typeof s.run>) => {
            if (!interleaved) {
              assert.equal(concurrent.prepare("SELECT revision FROM github_lifecycle_feedback WHERE delivery_key=?").get(key)!.revision, 1);
              concurrent.prepare(`UPDATE github_lifecycle_feedback SET revision=2,comment_id=777,
                delivered_digest='concurrent-new',create_pending=1 WHERE delivery_key=?`).run(key);
              interleaved = true;
            }
            return s.run(...args);
          };
          const value = Reflect.get(s, p); return typeof value === "function" ? value.bind(s) : value;
        } });
      };
      const value = Reflect.get(target, property); return typeof value === "function" ? value.bind(target) : value;
    },
  });
  try {
    await withFeedbackLock(home, async () => {
      assert.equal(await deliverControllerTicketFeedback(failingLane, home), false);
    });
    assert.equal(interleaved, true);
    assert.deepEqual(await feedbackStore(db).load(key), { revision: 2, commentId: 777,
      deliveredDigest: "concurrent-new", createPending: true, error: "github_unavailable" });
  } finally { concurrent.close(); await feedbackStore(db).save(key, savedDelivery!); }
  console.log("PASS real SQLite lock-timeout interleaving: old revision 1 cannot overwrite concurrent revision 2/comment ID/digest/create-pending fence");

  let pages = 0;
  const adapter = githubFeedbackAdapter((_method, endpoint) => {
    assert.match(endpoint, /page=/); pages++;
    return pages === 1 ? Array.from({ length: 100 }, (_, i) => ({ id: i+1, issue_url: "https://api.github.com/repos/Owner/Fixture/issues/1", user: { id: 123 }, body: "unrelated" }))
      : [{ id: 101, issue_url: "https://api.github.com/repos/Owner/Fixture/issues/1", user: { id: 123 }, body: "late page" }];
  });
  assert.equal((await adapter.comments({ repository, issueNumber: 1 })).length, 101); assert.equal(pages, 2);
  const broken = githubFeedbackAdapter(() => { throw new Error("DO_NOT_LEAK"); });
  await assert.rejects(broken.comments({ repository, issueNumber: 1 }));
  console.log("PASS complete pagination and fail-closed incomplete listing");
  // New admission refusals must opt in at the consumer; an old rejected row
  // with no fresh trigger must stay silent even while new refusals are delivered.
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,repository,issue_number,payload_json,processing_state)
    VALUES('old-refusal','2020-01-01','fixture','old-refusal-item','Issue','Owner/Fixture',1,'{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
    VALUES('r_old_refusal','old-refusal','fixture','old-refusal-item','content','Owner/Fixture',1,'autonomous','rejected','live');`);
  for (const id of ["wip-a", "wip-b"]) {
    db.prepare(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json,processing_state)
      VALUES(?,'2026-10-10','fixture',?,'Issue','{}','processed')`).run(id, id);
    db.prepare(`INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,execution_mode)
      VALUES(?,?,'fixture',?,'content','Owner/Fixture',1,'autonomous','running','dry_run')`).run(id, id, id);
  }
  const request = (method: string, endpoint: string, body?: string) => JSON.parse(execFileSync(resolve(bin, "gh"),
    ["api", "--method", method, endpoint, ...(body === undefined ? [] : ["--input", "-"])],
    { env, encoding: "utf8", input: body === undefined ? undefined : JSON.stringify({ body }) }));
  const reconcileRefusals = () => withFeedbackLock(home, () => reconcileCommittedTicketFeedback(db!,
    { fixture: { owner: "Owner", repository, workspace: { base_branch: "main" } } }, githubFeedbackAdapter(request), request, feedbackStore(db!)));
  for (const [id, note] of [["fresh-wip", "Rejected by WIP gate"], ["fresh-resource", "Rejected by resource guard"]]) {
    if (id === "fresh-resource") {
      db.exec("UPDATE runs SET state='archived' WHERE run_id IN ('wip-a','wip-b')");
      for (let i = 0; i < 4; i++) await mkdir(resolve(home, "worktrees", `occupied-${i}`), { recursive: true });
    }
    db.prepare(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,
      from_status,to_status,payload_json) VALUES(?,'2026-10-10','fixture',?,'content','Issue','Owner/Fixture',1,
      'Backlog','In progress','{"issueState":"OPEN","hasDescription":true,"labels":[]}')`).run(id!, id!);
    const consume = () => execFileSync(process.execPath, [resolve(app, "src/orchestrator/projects/process-project-events.ts")],
      { env: { ...env, CONSUMER_QUIET: "1" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    assert.equal(consume(), "");
    const run: Record<string, string | number | bigint | Uint8Array | null> = db.prepare("SELECT run_id,state FROM runs WHERE trigger_event_id=?").get(id!)!;
    assert.equal(run.state, "rejected");
    assert.equal(db.prepare("SELECT processing_note FROM project_events WHERE event_id=?").get(id!)!.processing_note, note);
    assert.equal(db.prepare("SELECT revision FROM github_lifecycle_snapshots WHERE json_extract(snapshot_json,'$.runId')=?").get(run.run_id!)!.revision, 0);
    const before = (await comments()).length;
    await reconcileRefusals();
    assert.equal((await comments()).length, before + 1);
    assert.match((await comments()).at(-1)!.body, /rejected/u);
    if (id === "fresh-wip") assert.match((await comments()).at(-1)!.body, /WIP limit; activation refused/u);
    const snapshot: Record<string, string | number | bigint | Uint8Array | null> = db.prepare("SELECT * FROM github_lifecycle_snapshots WHERE json_extract(snapshot_json,'$.runId')=?").get(run.run_id!)!;
    const log = await readFile(resolve(home, "gh.log"), "utf8");
    assert.equal(consume(), ""); await reconcileRefusals();
    assert.equal((await comments()).length, before + 1);
    assert.deepEqual(db.prepare("SELECT * FROM github_lifecycle_snapshots WHERE delivery_key=?").get(snapshot.delivery_key!), snapshot);
    const replay = (await readFile(resolve(home, "gh.log"), "utf8")).slice(log.length);
    assert.equal(replay, "", "delivered admission refusal must make zero GitHub requests");
    console.log(`PASS ${id}: consumer durably enqueues new admission refusal; feedback once, replay makes zero GitHub requests`);
  }
  assert.equal(db.prepare("SELECT 1 FROM github_lifecycle_snapshots WHERE json_extract(snapshot_json,'$.runId')='r_old_refusal'").get(), undefined);
  assert.ok(!(await comments()).some(c => c.body.includes("r_old_refusal")));
  console.log("PASS old rejected run with no new event stays untracked and receives no feedback");

  const requests = (await readFile(resolve(home, "gh.log"), "utf8")).trim().split("\n").map(line => JSON.parse(line) as string[]);
  for (const a of requests.filter(a => ["POST", "PATCH"].includes(a[2]!)))
    assert.match(a[3]!, /^repos\/Owner\/Fixture\/issues\/(?:1\/comments|comments\/\d+)$/u);
  console.log("PASS all production GitHub writes are issue comments only");
} finally { db?.close(); await rm(home, { recursive: true, force: true }); }

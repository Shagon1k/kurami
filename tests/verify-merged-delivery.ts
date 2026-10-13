import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse, stringify } from "yaml";
import { baseRunSelect, type RunRow } from "../src/orchestrator/runtime/run-read-model.ts";
import { planAutomatic } from "../src/orchestrator/runtime/automatic-plan.ts";
import { reconcileProgressCards } from "../src/orchestrator/runtime/reconcile-progress.ts";
import { validateMergedDeliverySource } from "../src/orchestrator/projects/ci/merged-delivery.ts";

const app = resolve(import.meta.dirname, "..");
const home = await mkdtemp(resolve(tmpdir(), "kurami-merged-delivery-"));
const canonical = resolve(home, "repo"), root = resolve(home, "worktrees"), worktree = resolve(root, "attempt", "Fixture");
const branch = "FX-1_delivery", repository = "Example/Fixture", runId = "r_merge_fixture";
const git = (path: string, ...args: string[]) => execFileSync("git", ["-C", path, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const bin = resolve(home, "bin");
const env = { ...process.env, KURAMI_HOME: home, PATH: `${bin}:${process.env.PATH}` };
const cli = (path: string, ...args: string[]) => JSON.parse(execFileSync(process.execPath, [resolve(app, path), ...args], { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }));
let db: DatabaseSync | undefined;
try {
  await mkdir(resolve(home, "config"), { recursive: true });
  await mkdir(bin); await mkdir(canonical); await mkdir(resolve(root, "attempt"), { recursive: true });
  await copyFile(resolve(app, "deploy/config/orchestrator.yaml"), resolve(home, "config/orchestrator.yaml"));
  execFileSync("git", ["init", "--bare", resolve(home, "origin")], { stdio: "ignore" });
  git(canonical, "init", "-b", "main"); git(canonical, "config", "user.name", "Fixture"); git(canonical, "config", "user.email", "fixture@example.invalid");
  await writeFile(resolve(canonical, "README.md"), "base\n"); git(canonical, "add", "."); git(canonical, "commit", "-m", "base");
  git(canonical, "remote", "add", "origin", resolve(home, "origin")); git(canonical, "push", "origin", "main");
  const base = git(canonical, "rev-parse", "HEAD");
  git(canonical, "worktree", "add", "-b", branch, worktree, base);
  await writeFile(resolve(worktree, "result"), "partial delivery; refresh jobs remain pending\n"); git(worktree, "add", "."); git(worktree, "commit", "-m", "Refs #1");
  const head = git(worktree, "rev-parse", "HEAD");
  const project = { repository, owner: "Example", project_number: 1, status_field: "Status", statuses: { backlog: "Backlog", active: "In progress", review: "Human Review", done: "Done", deferred: "Deferred" },
    workspace: { canonical_repository: canonical, worktree_root: root, base_branch: "main" },
    ci: { enabled: true, required_checks: ["fixture-ci"], missing_grace_minutes: 0 }, preview: { adapter: "compose", compose_file: "compose.yaml" } };
  await writeFile(resolve(home, "config/projects.yaml"), stringify({ version: 1, projects: { fixture: project } }));
  const pull = { number: 1, html_url: "https://github.com/Example/Fixture/pull/1", title: "Partial delivery", state: "closed", merged_at: "2026-10-10T12:45:05Z",
    head: { ref: branch, sha: head, repo: { full_name: repository } }, base: { ref: "main", repo: { full_name: repository } } };
  await writeFile(resolve(home, "pull.json"), JSON.stringify(pull));
  // Bounded network/runtime stand-ins accept only exact fixture reads and native completion writes.
  await writeFile(resolve(bin, "gh"), `#!${process.execPath}
const fs=require('fs'),p=require('path'),a=process.argv.slice(2),h=process.env.KURAMI_HOME;
const pull=JSON.parse(fs.readFileSync(p.join(h,'pull.json')));
fs.appendFileSync(p.join(h,'external.log'),JSON.stringify(a)+'\\n');
const get=n=>a.find(x=>x.startsWith(n+'='))?.slice(n.length+1);
if(a[0]==='pr'&&a[1]==='list') console.log(JSON.stringify(pull.merged_at?[{number:pull.number,url:pull.html_url,headRefOid:pull.head.sha,mergedAt:pull.merged_at}]:[]));
else if(a[0]==='api'&&a[1]==='graphql') {
  const body=a.includes('--input')?JSON.parse(fs.readFileSync(0,'utf8')):null;
  const q=get('query')??body?.query;
  if(q?.includes('items(first:')) { console.log(JSON.stringify({data:{user:{projectV2:{items:{nodes:[{id:'item',type:'ISSUE',fieldValueByName:{name:'Done'},content:{__typename:'Issue',id:'content',number:1,title:'Partial delivery',url:'https://github.com/Example/Fixture/issues/1',state:'CLOSED',body:'Fixture delivery',labels:{nodes:[]},repository:{nameWithOwner:'Example/Fixture'}}}],pageInfo:{hasNextPage:false,endCursor:null}}}}}})); process.exit(0); }
  if(q?.includes('ProjectsPullRequest')) { console.log(JSON.stringify({data:{repository:{nameWithOwner:'Example/Fixture',viewerPermission:'ADMIN',isArchived:false,mergeCommitAllowed:true,squashMergeAllowed:true,rebaseMergeAllowed:true,defaultBranchRef:{name:'main'},pullRequest:{id:'pr',url:pull.html_url,headRefOid:pull.head.sha,baseRefName:'main',state:pull.merged_at&&!fs.existsSync(p.join(h,'native-open'))?'MERGED':'OPEN',isDraft:false,viewerCanUpdate:true,mergeable:'MERGEABLE',mergeStateStatus:'CLEAN',baseRef:null,isInMergeQueue:false,isMergeQueueEnabled:false,stack:null}}}})); process.exit(0); }
  if(q.includes('updateProjectV2ItemFieldValue')) { fs.writeFileSync(p.join(h,'board-done'),'yes'); console.log(JSON.stringify({data:{updateProjectV2ItemFieldValue:{projectV2Item:{id:'item'}}}})); }
  else if(q.includes('node(id:$item)')) console.log(JSON.stringify({data:{node:{id:'item',isArchived:false,project:{id:'project'},content:{id:fs.existsSync(p.join(h,'wrong-issue'))?'wrong':'content',number:1,repository:{nameWithOwner:'Example/Fixture'}},fieldValueByName:{name:fs.existsSync(p.join(h,'board-done'))?'Done':'Human Review'}}}}));
  else console.log(JSON.stringify({data:{user:{projectV2:{id:'project',field:{id:'field',options:[{id:'done',name:'Done'}]}}}}}));
} else if(a[0]==='api'&&a[1]==='repos/Example/Fixture/issues/1') {
  if(a.includes('PATCH')) fs.writeFileSync(p.join(h,'issue-completed'),'yes');
  const done=fs.existsSync(p.join(h,'issue-completed'));
  console.log(JSON.stringify({node_id:'content',number:1,state:done?'closed':'open',state_reason:done?'completed':null}));
} else if(a[0]==='api'&&a.includes('GET')) {
  if(a.some(x=>x.endsWith('/pulls'))) console.log(JSON.stringify(a.includes('state=closed')?[pull]:[]));
  else if(a.some(x=>x.endsWith('/branches/main'))) console.log(JSON.stringify({name:'main',protected:false}));
  else if(a.some(x=>x.endsWith('/check-runs'))) console.log(JSON.stringify({check_runs:[{id:1,name:'fixture-ci',status:'completed',conclusion:fs.existsSync(p.join(h,'ci-failed'))?'failure':'success',completed_at:'2026-10-10T12:00:00Z'}]}));
  else if(a.some(x=>x.endsWith('/status'))) console.log('{"statuses":[]}'); else process.exit(90);
} else process.exit(91);
`);
  await writeFile(resolve(bin, "docker"), `#!${process.execPath}\nconst fs=require('fs'),p=require('path'),a=process.argv.slice(2),h=process.env.KURAMI_HOME,marker=p.join(h,'containers'); fs.appendFileSync(p.join(h,'runtime.log'),a.join(' ')+'\\n'); if(a[0]==='info') console.log('["name=rootless"]'); else if(a[0]==='ps'){if(fs.existsSync(marker))console.log('fixture-container');} else if(a[0]==='compose'&&a.includes('down'))fs.unlinkSync(marker); else process.exit(92);\n`);
  await writeFile(resolve(bin, "systemctl"), "#!/bin/sh\n[ \"$*\" = '--user is-active kurami-preview-ingress.service' ] || exit 93\nprintf 'active\\n'\n");
  await mkdir(resolve(home, "runtime/caddy/bin"), { recursive: true });
  await writeFile(resolve(home, "runtime/caddy/bin/caddy"), "#!/bin/sh\nexit 0\n");
  await writeFile(resolve(home, "config/Caddyfile"), `import ${resolve(home, "state/caddy/routes.caddy")}\n`);
  for (const path of [resolve(bin, "gh"), resolve(bin, "docker"), resolve(bin, "systemctl"), resolve(home, "runtime/caddy/bin/caddy")]) await chmod(path, 0o700);
  cli("src/orchestrator/state/init-run-store.ts");
  db = new DatabaseSync(resolve(home, "state/orchestrator.db"));
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,payload_json,processing_state)
    VALUES('event','2026-10-10T00:00:00Z','fixture','item','content','Issue','Example/Fixture',1,'Partial delivery','https://github.com/Example/Fixture/issues/1','{"issueState":"OPEN","refreshJobs":"pending"}','processed');
    INSERT INTO project_items(project,item_id,content_id,status,first_seen_at,last_seen_at) VALUES('fixture','item','content','Human Review','2026-10-10','2026-10-10');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
    VALUES('r_merge_fixture','event','fixture','item','content','Example/Fixture',1,'autonomous','parked_review','none','live');`);
  db.prepare(`INSERT INTO run_resources(run_id,resource_state,base_sha,worktree_path,branch_name,preview_id) VALUES(?,'provisioned',?,?,?,'preview-1')`).run(runId, base, worktree, branch);
  db.prepare(`INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
    VALUES(?,?,1,?,?,'passed','[]','fixture','2026-10-10','2026-10-10','2026-10-10')`).run(runId, repository, pull.html_url, head);
  db.prepare(`INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name,expires_at,verified_head_sha,reviewed_at,reviewed_by,reviewed_via)
    VALUES('lease',?,1,'running','kurami-fixture','2099-01-01',?,'2026-10-10T12:47:00Z','owner','projects')`).run(runId, head);
  const originalItems = db.prepare("SELECT * FROM project_items").all();
  const originalEvents = db.prepare("SELECT * FROM project_events").all();
  const state = () => db!.prepare("SELECT state,stop_reason,completion_requested_at FROM runs WHERE run_id=?").get(runId)!;
  const observe = () => cli("src/orchestrator/projects/ci/observe.ts", "--project", "fixture", "--apply");
  const reset = () => db!.exec("UPDATE runs SET state='parked_review',owner_state='none',stop_reason=NULL,preview_required=0,preview_required_label=NULL,completion_requested_at=NULL; UPDATE run_resources SET tmux_session_name=NULL;");
  const retained = (name: string, accepted = false) => { const ownerBefore = db!.prepare("SELECT owner_state FROM runs WHERE run_id=?").get(runId)!.owner_state; const result = observe(); assert.equal(db!.prepare("SELECT owner_state FROM runs WHERE run_id=?").get(runId)!.owner_state,ownerBefore); assert.equal(state().state, accepted ? "needs_attention" : "parked_review", JSON.stringify({result,ci:db!.prepare("SELECT * FROM run_ci_snapshots").get()})); if (accepted) { assert.ok(existsSync(resolve(home,"issue-completed"))); assert.equal(db!.prepare("SELECT status FROM project_items").get()!.status,"Human Review"); } assert.equal(state().completion_requested_at, null, name); assert.ok(existsSync(worktree)); console.log(`PASS ${name}`); };
  await writeFile(resolve(home, "pull.json"), JSON.stringify({ ...pull, merged_at: null })); retained("closed unmerged cannot complete");
  await writeFile(resolve(home, "pull.json"), JSON.stringify({ ...pull, number: 2 })); retained("wrong managed PR cannot complete");
  await writeFile(resolve(home, "pull.json"), JSON.stringify(pull));
  // restore tracked snapshot after deliberately refusing the wrong PR
  db.prepare("UPDATE run_ci_snapshots SET pull_request_number=1,pull_request_url=?,head_sha=?").run(pull.html_url, head);
  for (const [name, wrong] of [
    ["wrong repository", { ...pull, head: { ...pull.head, repo: { full_name: "Other/Fixture" } } }],
    ["wrong base branch", { ...pull, base: { ...pull.base, ref: "other" } }],
    ["wrong remote head", { ...pull, head: { ...pull.head, sha: base } }],
  ] as const) {
    await writeFile(resolve(home,"pull.json"),JSON.stringify(wrong)); retained(name);
    db.prepare("UPDATE run_ci_snapshots SET pull_request_number=1,pull_request_url=?,head_sha=?").run(pull.html_url,head);
  }
  await writeFile(resolve(home,"pull.json"),JSON.stringify(pull));
  db.exec("UPDATE runs SET stop_reason='cancelled'"); observe(); assert.equal(state().stop_reason, "cancelled"); assert.equal(state().completion_requested_at, null); console.log("PASS cancellation preserved"); reset();
  for (const [activeState,owner] of [["remote_owned","remote"],["running","cli"]] as const) {
    db.prepare("UPDATE runs SET state=?,owner_state=?").run(activeState,owner);
    observe(); assert.equal(state().state,activeState); assert.ok(existsSync(worktree));
    assert.equal(db.prepare("SELECT owner_state FROM runs WHERE run_id=?").get(runId)!.owner_state,owner);
    assert.equal(db.prepare("SELECT status FROM project_items").get()!.status,"Human Review");
    console.log(`PASS exact merge accepts ${activeState} task but retains active ownership/resources`); reset();
  }
  db.exec("UPDATE runs SET owner_state='remote'"); retained("Remote owner refused", true); reset();
  db.exec("UPDATE run_resources SET tmux_session_name='active'"); retained("CLI session refused", true); reset();
  db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name) VALUES('task',?,'ci_repair','ctx','session',?,?)`).run(runId, worktree, branch);
  retained("active protocol task refused", true); db.exec("DELETE FROM run_codex_tasks"); reset();
  await writeFile(resolve(worktree, "dirty"), "preserve"); retained("dirty worktree refused", true); await rm(resolve(worktree, "dirty")); reset();
  git(worktree, "commit", "--allow-empty", "-m", "unpublished local head"); retained("local HEAD mismatch refused"); git(worktree, "reset", "--hard", head);
  db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES('pending-stop','r_merge_fixture','stop','cli','pending-stop')`);
  retained("pending cancellation intent refused"); db.exec("DELETE FROM run_control_requests");
  db.exec(`INSERT INTO project_status_requests(request_id,project,item_id,actor_subject,idempotency_key,client_key,to_status,request_state)
    VALUES('status','fixture','item','owner','status','status','Done','uncertain')`);
  retained("uncertain Project status writer refused"); db.exec("DELETE FROM project_status_requests");
  db.prepare(`INSERT INTO project_pr_requests(request_id,project,item_id,run_id,actor_subject,idempotency_key,client_key,action,repository,pr_number,pr_id,head_sha,fingerprint,request_state,created_at,updated_at)
    VALUES('pr','fixture','item',?,'owner','pr','pr','merge',?,1,'pr',?,'fingerprint','pending','2026-10-10','2026-10-10')`).run(runId,repository,head);
  retained("pending native PR writer refused"); db.exec("DELETE FROM project_pr_requests");
  const key = "12345678-1234-1234-1234-123456789abc";
  const hash = (values: unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex");
  const seedPr = (requestState: string, updatedAt = "2026-10-01T00:00:00Z") => db!.prepare(`INSERT INTO project_pr_requests
    (request_id,project,item_id,run_id,actor_subject,idempotency_key,client_key,action,merge_method,repository,pr_number,pr_id,head_sha,fingerprint,request_state,created_at,updated_at)
    VALUES('native-pr','fixture','item',?,'owner',?,?,'merge','squash',?,1,'pr',?,?,?,'2026-10-01T00:00:00Z',?)`)
    .run(runId,hash(["owner","fixture","item","merge",key]),key,repository,head,"a".repeat(64),requestState,updatedAt);
  for (const writer of ["checking","writing","uncertain"] as const) {
    seedPr(writer); retained(`unresolved native PR ${writer} writer refused`);
    assert.equal(db.prepare("SELECT request_state FROM project_pr_requests").get()!.request_state,writer);
    db.exec("DELETE FROM project_pr_requests");
  }
  seedPr("pending",new Date().toISOString()); retained("recent native PR operation remains pending");
  assert.equal(db.prepare("SELECT request_state FROM project_pr_requests").get()!.request_state,"pending");
  db.exec("DELETE FROM project_pr_requests");
  seedPr("pending"); await writeFile(resolve(home,"native-open"),"yes");
  retained("fresh native read leaves unresolved pending merge gated");
  assert.equal(db.prepare("SELECT request_state FROM project_pr_requests").get()!.request_state,"pending");
  await rm(resolve(home,"native-open")); db.exec("DELETE FROM project_pr_requests");
  const beforeReconcile = (await readFile(resolve(home,"external.log"),"utf8")).length;
  for (const [target,expected] of [["In progress","conflict"],["Human Review","synced"]] as const) {
    seedPr("pending");
    db.prepare(`INSERT INTO project_status_requests(request_id,project,item_id,actor_subject,idempotency_key,client_key,from_status,to_status,request_state,created_at,updated_at)
      VALUES('native-status','fixture','item','owner',?,?,'Backlog',?,'awaiting_sync','2026-10-01T00:00:00Z','2026-10-01T00:00:00Z')`)
      .run("projects-status:"+hash(["owner","fixture","item","Backlog",target,key]),key,target);
    const reconciled = observe(); assert.equal(state().state,"stopping",JSON.stringify(reconciled));
    assert.equal(db.prepare("SELECT request_state FROM project_pr_requests").get()!.request_state,"applied");
    assert.equal(db.prepare("SELECT request_state FROM project_status_requests").get()!.request_state,expected);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_pr_requests").get()!.n,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_status_requests").get()!.n,1);
    console.log(`PASS exact native pending merge -> applied; awaiting_sync -> ${expected}`);
    db.exec("DELETE FROM project_pr_requests; DELETE FROM project_status_requests"); reset();
  }
  const replayCommands = (await readFile(resolve(home,"external.log"),"utf8")).slice(beforeReconcile);
  assert.ok(!/updateProjectV2ItemFieldValue|PATCH|PUT|merge-async|ProjectsReady/.test(replayCommands));
  assert.deepEqual(db.prepare("SELECT * FROM project_items").all(),originalItems);
  assert.deepEqual(db.prepare("SELECT * FROM project_events").all(),originalEvents);
  console.log("PASS exact receipt reconciliation issues no merge/status writes or synthetic snapshots/events");
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,payload_json,processing_state)
    VALUES('new-event','2026-10-10T13:00:00Z','fixture','item','content','Issue','Example/Fixture',1,'New attempt','https://example.invalid/1','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
    VALUES('r_newer','new-event','fixture','item','content','Example/Fixture',1,'autonomous','archived','none','live');`);
  retained("newer run refused"); db.exec("DELETE FROM runs WHERE run_id='r_newer'; DELETE FROM project_events WHERE event_id='new-event'");
  await writeFile(resolve(home,"wrong-issue"),"yes"); retained("wrong Project issue identity refused"); await rm(resolve(home,"wrong-issue"));
  db.exec("DELETE FROM preview_leases; UPDATE run_resources SET preview_id=NULL; UPDATE runs SET preview_required=1,preview_required_label='preview-required'");
  observe(); assert.equal(state().state,"stopping"); assert.equal(state().completion_requested_at,null);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM preview_leases").get()!.n,0);
  assert.equal(db.prepare("SELECT preview_requirement_satisfied_at FROM runs WHERE run_id=?").get(runId)!.preview_requirement_satisfied_at,null);
  console.log("PASS merged task with required Preview but no lease and no Done event is accepted");
  reset();
  db.prepare(`INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name,expires_at,verified_head_sha)
    VALUES('lease',?,1,'running','kurami-fixture','2099-01-01',?)`).run(runId,head);
  db.exec("UPDATE run_resources SET preview_id='preview-1'; UPDATE runs SET preview_required=1,preview_required_label='preview-required'");
  observe(); assert.equal(state().state,"stopping"); assert.equal(state().completion_requested_at,null);
  assert.equal(db.prepare("SELECT reviewed_at FROM preview_leases").get()!.reviewed_at,null);
  console.log("PASS merged required unreviewed Preview is waived, without invented review evidence or Done event");
  reset(); db.exec("UPDATE runs SET preview_required=1; UPDATE preview_leases SET reviewed_at='2026-10-10T12:47:00Z',reviewed_by='owner',reviewed_via='projects',verified_head_sha='stale'");
  observe(); assert.equal(state().state,"stopping"); reset();
  db.prepare("UPDATE preview_leases SET verified_head_sha=?,state='released',released_at='2026-10-10'").run(head);
  db.exec("UPDATE run_resources SET preview_id=NULL"); const inactive = observe(); assert.equal(state().state, "stopping", JSON.stringify(inactive)); console.log("PASS inactive reviewed exact preview remains eligible");
  reset(); db.exec("UPDATE preview_leases SET state='running',released_at=NULL; UPDATE run_resources SET preview_id='preview-1'");
  await writeFile(resolve(home, "ci-failed"), "yes"); retained("failed exact-head CI refused", true); assert.equal(db.prepare("SELECT aggregate_state FROM run_ci_snapshots").get()!.aggregate_state,"failed"); await rm(resolve(home, "ci-failed")); reset();
  db.prepare("UPDATE run_resources SET branch_name='wrong'").run(); retained("branch mismatch refused"); db.prepare("UPDATE run_resources SET branch_name=?").run(branch);
  db.prepare("UPDATE run_ci_snapshots SET pull_request_number=1,pull_request_url=?,head_sha=?").run(pull.html_url, head);
  assert.throws(() => validateMergedDeliverySource(db!, project, runId, head, () => { throw new Error("active external writer"); }), /active external writer/);
  console.log("PASS active external writer refused");
  const dry = cli("src/orchestrator/projects/ci/observe.ts", "--project", "fixture"); assert.equal(state().state, "parked_review"); assert.equal(dry.apply, false);
  // Actual composition: observer -> normal controller runtime-down/ingress/lease manager -> guarded release.
  await mkdir(resolve(home, "state/previews", runId), { recursive: true });
  await writeFile(resolve(home, "state/previews", runId, "runtime.env"), "SYNTHETIC=fixture\n");
  await writeFile(resolve(home, "state/previews", runId, "compose.preview.yaml"), "services: {}\n");
  await writeFile(resolve(home, "containers"), "fixture\n");
  observe(); assert.equal(state().state, "stopping"); assert.equal(state().stop_reason, "completed");
  let run = db.prepare(baseRunSelect() + " WHERE r.run_id=?").get(runId) as RunRow;
  assert.equal(planAutomatic(run, { projects: { fixture: project } }, () => false)?.action, "preview_down");
  cli("src/orchestrator/runtime/controller.ts", "--apply");
  assert.equal(db.prepare("SELECT state FROM preview_leases WHERE lease_id='lease'").get()!.state, "released");
  assert.ok(!existsSync(resolve(home, "state/previews", runId))); assert.ok(!existsSync(resolve(home, "containers"))); assert.ok(existsSync(worktree));
  run = db.prepare(baseRunSelect() + " WHERE r.run_id=?").get(runId) as RunRow;
  assert.equal(planAutomatic(run, { projects: { fixture: project } }, () => false)?.action, "release");
  // A late source/owner change must refuse deletion, even after runtime cleanup.
  await writeFile(resolve(worktree, "late-dirty"), "retain");
  const blocked = spawnSync(process.execPath, [resolve(app, "src/orchestrator/projects/worktrees/release.ts"), "--run-id", runId, "--apply"], { env, encoding: "utf8" });
  assert.notEqual(blocked.status, 0); assert.ok(existsSync(worktree)); await rm(resolve(worktree, "late-dirty"));
  const retry = observe(); assert.equal(state().state,"stopping",JSON.stringify(retry));
  cli("src/orchestrator/runtime/controller.ts", "--apply");
  assert.equal(state().state, "archived"); assert.equal(db.prepare("SELECT resource_state FROM run_resources WHERE run_id=?").get(runId)!.resource_state, "released");
  assert.ok(!existsSync(worktree)); assert.equal(spawnSync("git", ["-C", canonical, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status, 1);
  assert.equal(db.prepare("SELECT status FROM project_items").get()!.status, "Human Review");
  assert.equal(JSON.parse(String(db.prepare("SELECT payload_json FROM project_events WHERE event_id='event'").get()!.payload_json)).issueState, "OPEN");
  assert.ok(existsSync(resolve(home,"board-done")));
  assert.ok(existsSync(resolve(home,"issue-completed")));
  assert.deepEqual(db.prepare("SELECT * FROM project_items").all(), originalItems);
  assert.deepEqual(db.prepare("SELECT * FROM project_events").all(), originalEvents);
  console.log("PASS native Project/issue completion preserves poller-owned snapshots and events");
  const commands = await readFile(resolve(home, "external.log"), "utf8"); assert.match(commands,/state_reason=completed/); assert.ok(!/PUT|merge-async|ProjectsReady|project.*edit/.test(commands));
  assert.equal((commands.match(/"PATCH"/g) ?? []).length,1,"completion writes are idempotent");
  assert.equal((commands.match(/updateProjectV2ItemFieldValue/g) ?? []).length,1,"Project completion writes are idempotent");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM run_state_history WHERE reason='merged_task_accepted'").get()!.n, 1);
  // Only now exercise the normal poller: it owns the real Done event and snapshot.
  db.exec("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('fixture','2026-10-10','2026-10-10',1,'succeeded')");
  execFileSync(process.execPath,[resolve(app,"src/orchestrator/projects/poll-projects.ts")],{env,stdio:["ignore","pipe","pipe"]});
  const doneEvent = db.prepare("SELECT event_id FROM project_events WHERE to_status='Done'").get()!;
  assert.ok(doneEvent); assert.equal(db.prepare("SELECT status FROM project_items").get()!.status,"Done");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_events WHERE to_status='Done'").get()!.n,1);
  db.prepare("UPDATE runs SET completion_requested_at='2026-10-10',completion_source_event_id=?").run(doneEvent.event_id);
  console.log("PASS normal poller alone records native Done snapshot/event after acceptance");
  db.exec("UPDATE runs SET preview_required=1; DELETE FROM preview_leases; INSERT INTO run_progress_cards(run_id,stage,detail,content_digest) VALUES('r_merge_fixture','preview_required','stale','stale') ON CONFLICT(run_id) DO UPDATE SET stage='preview_required'");
  const config = parse(await readFile(resolve(home,"config/orchestrator.yaml"),"utf8"));
  reconcileProgressCards(db, config);
  assert.equal(db.prepare("SELECT stage FROM run_progress_cards").get()!.stage,"completed");
  db.exec("UPDATE runs SET state='cancelled',stop_reason='cancelled'"); reconcileProgressCards(db,config);
  assert.equal(db.prepare("SELECT stage FROM run_progress_cards").get()!.stage,"cancelled");
  console.log("PASS archived/released PF44-like and cancelled terminal cards override stale Preview required");
  db.exec("DELETE FROM run_state_history WHERE reason='merged_task_accepted'; UPDATE runs SET state='parked_review',stop_reason=NULL");
  reconcileProgressCards(db,config);
  assert.equal(db.prepare("SELECT stage FROM run_progress_cards").get()!.stage,"preview_required");
  db.exec("UPDATE runs SET state='needs_attention',stop_reason='completed'");
  reconcileProgressCards(db,config);
  assert.equal(db.prepare("SELECT stage FROM run_progress_cards").get()!.stage,"needs_attention");
  db.exec("UPDATE runs SET state='archived'; UPDATE run_resources SET resource_state='provisioned'");
  reconcileProgressCards(db,config);
  assert.equal(db.prepare("SELECT stage FROM run_progress_cards").get()!.stage,"needs_attention");
  console.log("PASS unmerged Preview remains gated and real cleanup attention is not hidden");
  console.log("PASS merged delivery with running preview -> ingress/runtime/lease cleanup -> exact PR/worktree release -> archived/released; issue completed and Project Done via native boundaries; original issue event unchanged");
} finally { db?.close(); await rm(home, { recursive: true, force: true }); }

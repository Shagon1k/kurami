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
  const project = { repository, statuses: { backlog: "Backlog", active: "In progress", review: "Human Review", done: "Done" },
    workspace: { canonical_repository: canonical, worktree_root: root, base_branch: "main" },
    ci: { enabled: true, required_checks: ["fixture-ci"], missing_grace_minutes: 0 }, preview: { adapter: "compose", compose_file: "compose.yaml" } };
  await writeFile(resolve(home, "config/projects.yaml"), stringify({ version: 1, projects: { fixture: project } }));
  const pull = { number: 1, html_url: "https://github.com/Example/Fixture/pull/1", title: "Partial delivery", state: "closed", merged_at: "2026-10-10T12:45:05Z",
    head: { ref: branch, sha: head, repo: { full_name: repository } }, base: { ref: "main", repo: { full_name: repository } } };
  await writeFile(resolve(home, "pull.json"), JSON.stringify(pull));
  // These bounded fake external executables reject all unknown commands, including writes.
  await writeFile(resolve(bin, "gh"), `#!${process.execPath}\nconst fs=require('fs'),p=require('path'),a=process.argv.slice(2),h=process.env.KURAMI_HOME; const pull=JSON.parse(fs.readFileSync(p.join(h,'pull.json'))); fs.appendFileSync(p.join(h,'external.log'),JSON.stringify(a)+'\\n'); if(a[0]==='pr'&&a[1]==='list'){console.log(JSON.stringify(pull.merged_at?[{number:pull.number,url:pull.html_url,headRefOid:pull.head.sha,mergedAt:pull.merged_at}]:[]));} else if(a[0]==='api'&&a.includes('GET')) { if(a.some(x=>x.endsWith('/pulls')))console.log(JSON.stringify(a.includes('state=closed')?[pull]:[])); else if(a.some(x=>x.endsWith('/check-runs')))console.log(JSON.stringify({check_runs:[{id:1,name:'fixture-ci',status:'completed',conclusion:fs.existsSync(p.join(h,'ci-failed'))?'failure':'success',completed_at:'2026-10-10T12:00:00Z'}]})); else if(a.some(x=>x.endsWith('/status')))console.log('{"statuses":[]}'); else process.exit(90); } else process.exit(91);\n`);
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
  const state = () => db!.prepare("SELECT state,stop_reason,completion_requested_at FROM runs WHERE run_id=?").get(runId)!;
  const observe = () => cli("src/orchestrator/projects/ci/observe.ts", "--project", "fixture", "--apply");
  const reset = () => db!.exec("UPDATE runs SET state='parked_review',owner_state='none',stop_reason=NULL,preview_required=0,preview_required_label=NULL,completion_requested_at=NULL; UPDATE run_resources SET tmux_session_name=NULL;");
  const retained = (name: string) => { observe(); assert.equal(state().state, "parked_review", name); assert.equal(state().completion_requested_at, null, name); assert.ok(existsSync(worktree)); console.log(`PASS ${name}`); };
  await writeFile(resolve(home, "pull.json"), JSON.stringify({ ...pull, merged_at: null })); retained("closed unmerged cannot complete");
  await writeFile(resolve(home, "pull.json"), JSON.stringify({ ...pull, number: 2 })); retained("wrong managed PR cannot complete");
  await writeFile(resolve(home, "pull.json"), JSON.stringify(pull));
  // restore tracked snapshot after deliberately refusing the wrong PR
  db.prepare("UPDATE run_ci_snapshots SET pull_request_number=1,pull_request_url=?,head_sha=?").run(pull.html_url, head);
  db.exec("UPDATE runs SET stop_reason='cancelled'"); observe(); assert.equal(state().stop_reason, "cancelled"); assert.equal(state().completion_requested_at, null); console.log("PASS cancellation preserved"); reset();
  db.exec("UPDATE runs SET owner_state='remote'"); retained("Remote owner refused"); reset();
  db.exec("UPDATE run_resources SET tmux_session_name='active'"); retained("CLI session refused"); reset();
  db.prepare(`INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name) VALUES('task',?,'ci_repair','ctx','session',?,?)`).run(runId, worktree, branch);
  retained("active protocol task refused"); db.exec("DELETE FROM run_codex_tasks");
  await writeFile(resolve(worktree, "dirty"), "preserve"); retained("dirty worktree refused"); await rm(resolve(worktree, "dirty"));
  git(worktree, "commit", "--allow-empty", "-m", "unpublished local head"); retained("local HEAD mismatch refused"); git(worktree, "reset", "--hard", head);
  db.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES('pending-stop','r_merge_fixture','stop','cli','pending-stop')`);
  retained("pending cancellation intent refused"); db.exec("DELETE FROM run_control_requests");
  db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,payload_json,processing_state)
    VALUES('new-event','2026-10-10T13:00:00Z','fixture','item','content','Issue','Example/Fixture',1,'New attempt','https://example.invalid/1','{}','processed');
    INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
    VALUES('r_newer','new-event','fixture','item','content','Example/Fixture',1,'autonomous','archived','none','live');`);
  retained("newer run refused"); db.exec("DELETE FROM runs WHERE run_id='r_newer'; DELETE FROM project_events WHERE event_id='new-event'");
  db.exec("UPDATE runs SET preview_required=1,preview_required_label='preview-required'; UPDATE preview_leases SET reviewed_at=NULL,reviewed_by=NULL,reviewed_via=NULL");
  retained("required unreviewed preview refused");
  db.exec("UPDATE preview_leases SET reviewed_at='2026-10-10T12:47:00Z',reviewed_by='owner',reviewed_via='projects',verified_head_sha='stale'"); retained("required stale preview refused");
  db.prepare("UPDATE preview_leases SET verified_head_sha=?,state='released',released_at='2026-10-10'").run(head);
  db.exec("UPDATE run_resources SET preview_id=NULL"); const inactive = observe(); assert.equal(state().state, "stopping", JSON.stringify(inactive)); console.log("PASS inactive reviewed exact preview remains eligible");
  reset(); db.exec("UPDATE preview_leases SET state='running',released_at=NULL; UPDATE run_resources SET preview_id='preview-1'");
  await writeFile(resolve(home, "ci-failed"), "yes"); retained("failed exact-head CI refused"); await rm(resolve(home, "ci-failed"));
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
  db.exec("UPDATE runs SET state='stopping'");
  cli("src/orchestrator/runtime/controller.ts", "--apply");
  assert.equal(state().state, "archived"); assert.equal(db.prepare("SELECT resource_state FROM run_resources WHERE run_id=?").get(runId)!.resource_state, "released");
  assert.ok(!existsSync(worktree)); assert.equal(spawnSync("git", ["-C", canonical, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).status, 1);
  assert.equal(db.prepare("SELECT status FROM project_items").get()!.status, "Human Review");
  assert.equal(JSON.parse(String(db.prepare("SELECT payload_json FROM project_events WHERE event_id='event'").get()!.payload_json)).issueState, "OPEN");
  const commands = await readFile(resolve(home, "external.log"), "utf8"); assert.ok(!/PATCH|POST|mutation|issue.*close|project.*edit/.test(commands));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM run_state_history WHERE reason='merged_delivery_completion_requested'").get()!.n, 2);
  console.log("PASS merged optional running reviewed preview -> ingress/runtime/lease cleanup -> exact PR/worktree release -> archived/released; incomplete issue OPEN and Project unchanged; no GitHub writes");
} finally { db?.close(); await rm(home, { recursive: true, force: true }); }

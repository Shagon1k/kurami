import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { loadClaritySkill, parseReviewProfile } from "../src/orchestrator/projects/reviews/profiles.ts";
import { buildGitHubReviewPayload, buildReviewInstructions } from "../src/orchestrator/projects/reviews/worker.ts";
import { readReviewEvidence } from "../src/orchestrator/projects/reviews/read-model.ts";
import { availableRunControls, requestRunControl } from "../src/orchestrator/controls/run.ts";
import { baseRunSelect } from "../src/orchestrator/runtime/run-read-model.ts";
import { planForRequest, type RequestRow } from "../src/orchestrator/runtime/request-plan.ts";
import { inspectAiReview } from "../src/orchestrator/controls/ai-review.ts";
import { ProjectsActionError, requestProjectsReview } from "../src/projects-site/actions.ts";
import { collectProjectsSnapshot } from "../src/projects-site/snapshot.ts";
import { projectRunActions, requestProjectRunAction } from "../src/projects-site/run-actions.ts";
import { readProjectStatus } from "../src/orchestrator/projects/status-read-model.ts";
import { nextAutopilotStep } from "../src/orchestrator/runtime/autopilot.ts";

export function verifyReviewProfiles(): void {
  const home = mkdtempSync(join(tmpdir(), "kurami-review-profiles-"));
  const app = resolve(import.meta.dirname, "..");
  const now = new Date();
  const head = "a".repeat(40), base = "b".repeat(40), pr = "https://github.com/Example/Alpha/pull/20";
  const profiles = ["general", "clarity", "spec"] as const;
  const statuses = { backlog:"Todo",active:"Doing",review:"Review",done:"Done",deferred:"Later" };
  mkdirSync(join(home, "state")); mkdirSync(join(home, "config"));
  const worktree = join(home, "worktrees/fixture");
  mkdirSync(worktree, {recursive:true});
  execFileSync("git", ["init", "--quiet", worktree]);
  execFileSync("git", ["-C", worktree, "-c", "user.email=test@example.invalid", "-c", "user.name=Test", "commit", "--quiet", "--allow-empty", "-m", "Fixture"]);
  writeFileSync(join(home, "config/projects.yaml"), JSON.stringify({version:1,projects:{alpha:{repository:"Example/Alpha",owner:"Example",project_number:1,statuses,workspace:{worktree_root:join(home,"worktrees"),base_branch:"main",branch_prefix:"AL"}}}}));
  writeFileSync(join(home, "config/orchestrator.yaml"), JSON.stringify({version:1,mode:"live",limits:{max_tmux_sessions_global:2}}));
  const database = new DatabaseSync(join(home, "state/orchestrator.db"));
  try {
    for (const file of readdirSync(join(app,"migrations")).filter(name=>/^\d+_.*\.sql$/u.test(name)).sort().filter(name=>name < "042_")) database.exec(readFileSync(join(app,"migrations",file),"utf8"));
    database.exec("PRAGMA foreign_keys=ON");
    database.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES('event_profile',?,'alpha','item','Issue','{}')").run(now.toISOString());
    database.exec("INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode) VALUES('r_profile','event_profile','alpha','item','content','Example/Alpha',12,'autonomous','parked_review','none','live')");
    database.prepare("INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,codex_thread_id) VALUES('r_profile','provisioned',?,'AL-12','primary-thread')").run(worktree);
    database.prepare("INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,status,present,first_seen_at,last_seen_at) VALUES('alpha','item','Issue','Example/Alpha',12,'Fixture','Review',1,?,?)").run(now.toISOString(),now.toISOString());
    database.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('alpha',?,?,1,'succeeded')").run(now.toISOString(),now.toISOString());
    database.prepare("INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at) VALUES('r_profile','Example/Alpha',20,?,?,'passed','[]','ci',?,?,?)").run(pr,head,now.toISOString(),now.toISOString(),now.toISOString());
    const input = {runId:"r_profile",project:"alpha",itemId:"item",head,key:randomUUID(),profile:"clarity" as const};
    assert.throws(()=>requestProjectsReview({...input,profile:"unknown"},"owner",{home,now}),/Unsupported/);
    assert.throws(()=>parseReviewProfile("unknown"),/Unsupported/);
    const request = requestProjectsReview(input,"owner",{home,now});
    assert.equal(requestProjectsReview(input,"owner",{home,now}).requestId,request.requestId);
    assert.equal(database.prepare("SELECT review_profile FROM run_control_requests WHERE request_id=?").get(request.requestId)?.review_profile,"clarity");
    database.exec(readFileSync(join(app,"migrations/042_independent_review_profiles.sql"),"utf8"));
    for (const file of readdirSync(join(app,"migrations")).filter(name=>/^\d+_.*\.sql$/u.test(name)).sort().filter(name=>name > "042_independent_review_profiles.sql" && name < "047_")) database.exec(readFileSync(join(app,"migrations",file),"utf8"));
    database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state,retry_context_json)
      VALUES('rq_migration_retry','r_profile','retry','cli','migration-retry','applied','{"provider":"codex","threadId":"retained","turnId":"retained","dispatchStartedAt":"2026-10-26T00:00:00Z"}');`);
    database.exec(`
      INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state,review_profile) VALUES
        ('rq_migration_review','r_profile','ai_review','cli','migration-review','applied','clarity'),
        ('rq_migration_fix','r_profile','review_fix','cli','migration-fix','applied','clarity');
      INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name,review_profile,skill_version,skill_sha256,skill_text,findings_json)
        VALUES('air_migration','r_profile','rq_migration_review',99,'ready','Example/Alpha',20,'https://github.com/Example/Alpha/pull/20','main','${base}','${head}','rv-migration','clarity','0.5.0','${"c".repeat(64)}','retained skill','[]');
      INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,source_head_sha,snapshot_json,review_profile,review_fix_all,summary_findings_json)
        VALUES('fix_migration','r_profile','rq_migration_fix',99,'succeeded','Example/Alpha',20,'https://github.com/Example/Alpha/pull/20','${head}','[]','clarity',1,'[]');
      INSERT INTO run_review_fix_threads(round_id,thread_id,root_comment_id,source_kind,path,thread_state,reply_comment_id)
        VALUES('fix_migration','thread-migration',1,'owner','src/fixture.ts','resolved',2);
      INSERT INTO run_review_fix_operations(round_id,operation_kind,operation_state,task_codex_thread_id,previous_codex_thread_id)
        VALUES('fix_migration','cleanup','completed','retained-worker','retained-primary');
    `);
    const migrationTables=["run_control_requests","run_ai_reviews","run_review_fix_rounds","run_review_fix_threads","run_review_fix_operations","run_control_project_context"];
    const preserved=Object.fromEntries(migrationTables.map(table=>[table,database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
    database.exec(readFileSync(join(app,"migrations/047_spec_review.sql"),"utf8"));
    for(const table of migrationTables) assert.deepEqual(database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),preserved[table],`Spec migration preserves ${table}`);
    for (const file of readdirSync(join(app,"migrations")).filter(name=>/^\d+_.*\.sql$/u.test(name)).sort().filter(name=>name > "047_spec_review.sql"))
      database.exec(readFileSync(join(app,"migrations",file),"utf8"));
    database.exec("DELETE FROM run_review_fix_threads WHERE round_id='fix_migration'; DELETE FROM run_review_fix_operations WHERE round_id='fix_migration'; DELETE FROM run_review_fix_rounds WHERE round_id='fix_migration'; DELETE FROM run_ai_reviews WHERE review_id='air_migration'; DELETE FROM run_control_requests WHERE request_id IN ('rq_migration_review','rq_migration_fix')");
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(),[]);
    assert.equal(database.prepare("SELECT primary_agent_provider FROM run_resources").get()?.primary_agent_provider,"codex");
    assert.throws(()=>database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,review_profile) VALUES('rq_bad','r_profile','ai_review','cli','bad','unknown')`),/CHECK/);
    assert.equal(database.prepare("SELECT request_state FROM run_control_requests WHERE request_id=?").get(request.requestId)?.request_state,"pending","upgrade preserves queued review");
    assert.equal(inspectAiReview(database,"r_profile","general")?.eligible,true,"queued Clarity does not block General");
    assert.ok((availableRunControls(database,"r_profile",{home,profile:"general"}).available_actions as string[]).includes("ai_review"));
    const general = requestProjectsReview({...input,key:randomUUID(),profile:"general"},"owner",{home,now});
    assert.equal(requestProjectsReview({...input,key:randomUUID(),profile:"general"},"owner",{home,now}).requestId,general.requestId,"same profile reuses queued request");
    assert.equal(requestRunControl(database,"r_profile","ai_review","discord",true,{home,profile:"general"}).request_id,general.requestId,"Discord reuses only the selected profile");
    assert.equal(requestRunControl(database,"r_profile","ai_review","discord",true,{home,profile:"clarity"}).request_id,request.requestId);
    assert.throws(()=>database.prepare("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,review_profile) VALUES('duplicate','r_profile','ai_review','cli','duplicate','clarity')").run(),/UNIQUE/);
    const plan = (requestId:string) => planForRequest(database.prepare(`SELECT base.*,q.request_id,q.action AS requested_action,
      (SELECT COUNT(*) FROM run_ai_reviews ar WHERE ar.run_id=q.run_id AND ar.review_profile=q.review_profile AND ar.review_state='running') AS requested_review_active_count
      FROM (${baseRunSelect()}) base JOIN run_control_requests q ON q.run_id=base.run_id WHERE q.request_id=?`).get(requestId) as RequestRow,{limits:{preview_expiry_warning_hours:2}});


    const codexHome = join(home,"codex");
    const plugin = join(codexHome,"plugins/cache/shag-ai-plugins/engineering-tools/0.5.0");
    mkdirSync(join(plugin,"skills/simplify-code"),{recursive:true}); mkdirSync(join(plugin,".claude-plugin"));
    const skillText = "---\nname: simplify-code\n---\nPreserve exact behavior. Inspect callers and tests. Do not manufacture findings.\n";
    writeFileSync(join(plugin,"skills/simplify-code/SKILL.md"),skillText);
    writeFileSync(join(plugin,".claude-plugin/plugin.json"),JSON.stringify({name:"engineering-tools",version:"0.5.0"}));
    const skill = loadClaritySkill(codexHome);
    assert.equal(skill.text,skillText); assert.equal(skill.sha256,createHash("sha256").update(skillText).digest("hex"));
    assert.throws(()=>loadClaritySkill(join(home,"missing")),/requires the installed/);
    const tools = join(home,"tools"); mkdirSync(tools);
    writeFileSync(join(tools,"gh"),`#!/usr/bin/env node\nconsole.log(JSON.stringify(process.argv[2]==='pr'?[{number:20,url:${JSON.stringify(pr)},title:'Fixture',headRefOid:'${head}',headRefName:'AL-12',baseRefName:'main'}]:{base:{sha:'${base}'}}));\n`,{mode:0o700});
    writeFileSync(join(tools,"tmux"),"#!/bin/sh\ncase \"$1\" in new-session) exit 0;; *) exit 1;; esac\n",{mode:0o700});
    const manager = resolve(app,"src/orchestrator/projects/reviews/manager.ts");
    const env = {...process.env,KURAMI_HOME:home,CODEX_HOME:codexHome,GH_BIN:join(tools,"gh"),PATH:tools+":"+process.env.PATH};
    const args = [manager,"start","--run-id","r_profile","--request-id",request.requestId,"--apply"];
    assert.throws(()=>execFileSync(process.execPath,args,{env:{...env,CODEX_HOME:join(home,"missing")},stdio:"pipe"}),/requires the installed/);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM run_ai_reviews").get()?.n,0,"missing skill starts no review");
    execFileSync(process.execPath,args,{env,stdio:"pipe"});
    const stored = database.prepare("SELECT * FROM run_ai_reviews").get()!;
    database.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(request.requestId);
    assert.equal(plan(general.requestId).action,"review_start","controller allows General while Clarity runs");
    assert.equal(plan(request.requestId).action,"request_reject","controller prevents duplicate Clarity");
    database.prepare("UPDATE run_control_requests SET request_state='failed' WHERE request_id=?").run(general.requestId);
    assert.equal(inspectAiReview(database,"r_profile","general")?.eligible,true,"running Clarity does not block General");
    assert.ok((availableRunControls(database,"r_profile",{home,profile:"general"}).available_actions as string[]).includes("ai_review"));
    const generalWhileRunning=requestRunControl(database,"r_profile","ai_review","discord",true,{home,profile:"general"});
    const generalId=String(generalWhileRunning.requestId);
    execFileSync(process.execPath,[manager,"start","--run-id","r_profile","--request-id",generalId,"--apply"],{env,stdio:"pipe"});
    database.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(generalId);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM run_ai_reviews WHERE review_state='running'").get()?.n,2,"both independent agents run");
    assert.throws(()=>requestRunControl(database,"r_profile","ai_review","discord",true,{home,profile:"general"}),/not eligible/);
    assert.throws(()=>execFileSync(process.execPath,args,{env,stdio:"pipe"}),/no longer pending/);
    const specRequest=requestProjectsReview({...input,key:randomUUID(),profile:"spec"},"owner",{home,now});
    assert.equal(requestRunControl(database,"r_profile","ai_review","discord",true,{home,profile:"spec"}).request_id,specRequest.requestId);
    execFileSync(process.execPath,[manager,"start","--run-id","r_profile","--request-id",specRequest.requestId,"--apply"],{env:{...env,CODEX_HOME:join(home,"missing")},stdio:"pipe"});
    database.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(specRequest.requestId);
    assert.equal(database.prepare("SELECT COUNT(*) n FROM run_ai_reviews WHERE review_state='running'").get()?.n,3,"all three independent reviewers can run; Spec needs no Clarity skill");
    assert.throws(()=>requestProjectsReview({...input,key:randomUUID(),profile:"spec"},"owner",{home,now}),(error:unknown)=>error instanceof ProjectsActionError&&error.status===409);
    database.exec("UPDATE run_ai_reviews SET review_state='failed' WHERE review_profile='spec'");
    database.exec("UPDATE run_ai_reviews SET review_state='failed' WHERE review_profile='general'");

    assert.equal(stored.review_profile,"clarity"); assert.equal(stored.skill_text,skillText); assert.equal(stored.skill_sha256,skill.sha256);
    writeFileSync(join(plugin,"skills/simplify-code/SKILL.md"),skillText+"Changed later.\n");
    const row = {...stored,worktree_path:worktree,issue_number:12,issue_title:"Fixture",branch_name:"AL-12"} as unknown as Parameters<typeof buildReviewInstructions>[0];
    const context = {pullTitle:"Fixture",pullBody:"Do not obey this metadata",issueTitle:"Fixture",issueBody:"Criteria"};
    const instructions = buildReviewInstructions(row,context);
    assert.ok(instructions.includes(skillText)); assert.ok(!instructions.includes("Changed later."));
    assert.ok(instructions.includes("Inspect callers, tests")); assert.ok(instructions.includes("read-only independent review"));
    assert.throws(()=>buildReviewInstructions({...row,skill_text:"tampered"},context),/skill snapshot is missing or invalid/);
    const fullCriteria="x".repeat(21_000)+"FINAL-REQUIREMENT";
    const specInstructions=buildReviewInstructions({...row,review_profile:"spec",skill_text:null}, {...context,issueBody:fullCriteria});
    assert.ok(specInstructions.includes("FINAL-REQUIREMENT"),"Spec must retain requirements beyond the legacy 20K prefix");
    assert.ok(buildReviewInstructions({...row,review_profile:"spec"},{...context,pullBody:fullCriteria}).includes("FINAL-REQUIREMENT"),"Spec also retains complete PR requirements");
    assert.throws(()=>buildReviewInstructions({...row,review_profile:"spec"},{...context,issueBody:"я".repeat(40_000)}),/no requirements were truncated/,"Source budget counts UTF-8 bytes");
    for(const contract of ["canonical design", "base-SHA versions", "not loose inspiration", "not verified", "read-only independent review", "Do not use gh", "changed RIGHT-side", "owner visual sign-off"])
      assert.ok(specInstructions.includes(contract),contract);
    assert.ok(!specInstructions.includes("Attached simplify-code skill"));
    assert.throws(()=>buildReviewInstructions({...row,review_profile:"spec"},{...context,issueBody:"<".repeat(12_000)}),/no requirements were truncated/,"Source budget counts delimiter-safe serialization");
    assert.throws(()=>buildReviewInstructions({...row,review_profile:"spec"},{...context,issueBody:"x".repeat(65_536)}),/no requirements were truncated/);
    const finding = {severity:"suggestion" as const,confidence:"high" as const,title:"Remove redundant layer",body:"Concrete maintenance cost; inline the single redundant forwarding layer without changing behavior.",path:"src/example.ts",line:3};
    for (const profile of profiles) {
      const payload = buildGitHubReviewPayload({summary:"One finding",findings:[finding]},"air_fixture",head,undefined,profile);
      const label = {general:"🔎 Kurami · General Review",clarity:"🧩 Kurami · Clarity Review",spec:"📐 Kurami · Spec Review"}[profile];
      assert.ok(String(payload.body).includes(label)); assert.ok(String((payload.comments as {body:string}[])[0]!.body).includes(label)); assert.equal(payload.event,"COMMENT");
    }
    database.prepare("UPDATE run_ai_reviews SET review_state='ready',github_review_url=?,suggestion_count=1 WHERE review_id=?").run(pr+"#pullrequestreview-1",stored.review_id);
    database.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(request.requestId);
    assert.equal(inspectAiReview(database,"r_profile","clarity")?.reason,"ready");
    database.exec("UPDATE run_ai_reviews SET review_state='running' WHERE review_profile='general'");
    assert.equal(projectRunActions(database,"r_profile",home,now,true,"clarity").actions.find(action=>action.action==="review_fix")?.enabled??false,false,"fix waits for every active reviewer");
    assert.throws(()=>requestRunControl(database,"r_profile","review_fix","discord",true,{home,profile:"clarity"}),/not eligible/);
    database.exec("UPDATE run_ai_reviews SET review_state='failed' WHERE review_profile='general'");
    assert.equal(inspectAiReview(database,"r_profile","general")?.eligible,true,"Clarity never substitutes for General");
    assert.equal(readReviewEvidence(database,"r_profile","general",head).state,"failed","Clarity completion preserves the General failure");
    database.exec("DELETE FROM run_ai_reviews WHERE review_profile='general'");
    const readModel = readProjectStatus(join(home,"state/orchestrator.db"),{alpha:{statuses}},now);
    assert.equal(nextAutopilotStep(readModel.runs[0]!,"Review")?.action,"ai_review","Clarity does not satisfy General autopilot");
    const snapshot = collectProjectsSnapshot({home,now,controlsEnabled:true});
    assert.equal(snapshot.available,true); assert.equal(snapshot.items[0]!.reviews?.general.state,"none"); assert.equal(snapshot.items[0]!.reviews?.clarity.state,"ready"); assert.equal(snapshot.items[0]!.reviews?.spec.state,"failed");
    assert.equal(projectRunActions(database,"r_profile",home,now,true).actions.some(action=>action.action==="review_fix"),false);
    assert.equal(snapshot.items[0]!.runActions?.actions.find(action=>action.action==='review_fix')?.enabled,true,'one ready Clarity profile enables the combined fix');
    const queuedGeneral=requestProjectsReview({...input,profile:'general',key:randomUUID()},'owner',{home,now});
    assert.equal(projectRunActions(database,'r_profile',home,now,true,'general',true).actions.some(action=>action.action==='review_fix'&&action.enabled),false,'combined fix waits for queued reviewers too');
    assert.throws(()=>requestRunControl(database,'r_profile','review_fix','discord',true,{home,allReviews:true}),/conflicts with queued/);
    database.prepare("UPDATE run_control_requests SET request_state='rejected' WHERE request_id=?").run(queuedGeneral.requestId);
    const view = projectRunActions(database,"r_profile",home,now,true,"clarity");
    assert.equal(view.actions.find(action=>action.action==="review_fix")?.enabled,true);
    const fix = requestProjectRunAction({runId:"r_profile",project:"alpha",itemId:"item",action:"review_fix",profile:"clarity",fingerprint:view.fingerprint,key:randomUUID(),confirmed:false},"owner",{home,now});
    assert.equal(database.prepare("SELECT review_profile FROM run_control_requests WHERE request_id=?").get(fix.requestId)?.review_profile,"clarity");
    assert.equal(readReviewEvidence(database,"r_profile","clarity",head).fix?.state,"queued");
    assert.equal(readReviewEvidence(database,"r_profile","general",head).fix,undefined);
    assert.equal(readReviewEvidence(database,"r_profile","clarity",base).state,"outdated");
    assert.equal(database.prepare("SELECT review_fix_all FROM run_control_requests WHERE request_id=?").get(fix.requestId)?.review_fix_all,0,'targeted request retains its scope');
    database.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(fix.requestId);
    database.exec(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,request_state) VALUES('rq_cafe','r_profile','ai_review','cli','cafe','applied');
      INSERT INTO run_ai_reviews(review_id,run_id,request_id,review_number,review_profile,review_state,repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,tmux_session_name,important_count,github_review_id)
      SELECT 'air_cafe',run_id,'rq_cafe',4,'general','ready',repository,pull_request_number,pull_request_url,base_ref,base_sha,head_sha,'rv-general',1,'22'
      FROM run_ai_reviews WHERE review_profile='clarity';`);
    database.prepare("UPDATE run_ai_reviews SET github_review_id='11' WHERE review_profile='clarity'").run();
    database.exec("UPDATE run_ai_reviews SET review_state='ready',github_review_id='33',suggestion_count=1 WHERE review_profile='spec'");
    assert.equal(readReviewEvidence(database,"r_profile","spec",base).state,"outdated");
    const allView=projectRunActions(database,"r_profile",home,now,true,"general",true);
    assert.equal(allView.actions.find(action=>action.action==='review_fix')?.enabled,true);
    const allInput={runId:'r_profile',project:'alpha',itemId:'item',action:'review_fix',allReviews:true,fingerprint:allView.fingerprint,key:randomUUID(),confirmed:false};
    const combined=requestProjectRunAction(allInput,'owner',{home,now});
    assert.equal(requestProjectRunAction(allInput,'owner',{home,now}).requestId,combined.requestId);
    assert.equal(requestRunControl(database,'r_profile','review_fix','discord',true,{home,allReviews:true}).request_id,combined.requestId,'Discord and Projects share one combined request');
    assert.throws(()=>requestProjectRunAction({...allInput,profile:'clarity',allReviews:false,key:randomUUID()},'owner',{home,now}),/already queued/,'a targeted request cannot become a second writer');
    assert.equal(readReviewEvidence(database,'r_profile','general',head).fix?.state,'queued');
    assert.equal(readReviewEvidence(database,'r_profile','clarity',head).fix?.state,'queued');
    assert.equal(readReviewEvidence(database,'r_profile','spec',head).fix?.state,'queued');
    const secrets=join(home,'secrets');mkdirSync(secrets,{mode:0o700});
    const keyFile=join(secrets,'review.pem');
    writeFileSync(keyFile,generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600});
    writeFileSync(join(secrets,'github-reviewer-app.env'),`KURAMI_GITHUB_REVIEWER_APP_ID=1\nKURAMI_GITHUB_REVIEWER_INSTALLATION_ID=2\nKURAMI_GITHUB_REVIEWER_PRIVATE_KEY_FILE=${keyFile}\n`,{mode:0o600});
    execFileSync(process.execPath,[resolve(app,'tests/combined-review-fixes.ts'),combined.requestId],{env:{...process.env,KURAMI_HOME:home},stdio:'pipe'});
  } finally { database.close(); rmSync(home,{recursive:true,force:true}); }
}

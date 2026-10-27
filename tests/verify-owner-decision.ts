import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";

const scenario=process.env.OWNER_DECISION_CASE ?? "production";
if (scenario === "production") for (const name of ["composition","concurrent","controller-concurrent","app","queued-change","source-change","ambiguous","uncertain","duplicate","foreign","identity","no-reply","stale","context","bounds","guards","legacy","abort-cycles"])
  execFileSync(process.execPath,[import.meta.filename],{env:{...process.env,OWNER_DECISION_CASE:name},stdio:"inherit"});
const home=mkdtempSync(resolve(tmpdir(),"kurami-owner-decision-"));
process.env.KURAMI_HOME=home; process.env.KURAMI_TEST_STATUS="0";
const app=resolve(import.meta.dirname,".."), bin=resolve(home,"bin"), canonical=resolve(home,"canonical"), root=resolve(home,"trees"), worktree=resolve(root,"fix");
for(const dir of [bin,canonical,root,resolve(home,"state"),resolve(home,"config"),resolve(home,"secrets")])mkdirSync(dir,{recursive:true});
const gitBin=execFileSync("which",["git"],{encoding:"utf8"}).trim();
const git=(path:string,...args:string[])=>execFileSync(gitBin,["-C",path,...args],{encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
git(canonical,"init","-q","--initial-branch=main");git(canonical,"config","user.email","fixture@example.invalid");git(canonical,"config","user.name","Fixture");
writeFileSync(resolve(canonical,"fix.txt"),"original\n");git(canonical,"add","fix.txt");git(canonical,"commit","-qm","fixture");
git(canonical,"remote","add","origin","https://github.com/Owner/Fixture.git");git(canonical,"worktree","add","-qb","feature",worktree);
const head=git(worktree,"rev-parse","HEAD"),runId="r_fixture";
// Match init-run-store.ts: concurrent readers must use the production WAL lane.
const db=new DatabaseSync(resolve(home,"state/orchestrator.db"),{timeout:5000});
db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000;");
for(const file of readdirSync(resolve(app,"migrations")).filter(n=>/^\d+.*\.sql$/.test(n)).sort())db.exec(readFileSync(resolve(app,"migrations",file),"utf8"));
const project={owner:"Owner",project_number:1,repository:"Owner/Fixture",status_field:"Status",human_control_label:"human-control",
  statuses:{backlog:"Backlog",active:"In progress",review:"Human Review",done:"Done",deferred:"Deferred"},workspace:{canonical_repository:canonical,worktree_root:root,base_branch:"main",branch_prefix:"test"}};
const registry={version:1,projects:{fixture:project}};
writeFileSync(resolve(home,"config/projects.yaml"),JSON.stringify(registry));
const config=readFileSync(resolve(app,"deploy/config/orchestrator.yaml"),"utf8").replace(/mode: .*/u,"mode: live");
writeFileSync(resolve(home,"config/orchestrator.yaml"),config);
writeFileSync(resolve(home,"secrets/github.env"),"GH_TOKEN=synthetic_fixture_token_never_valid\n",{mode:0o600});
writeFileSync(resolve(bin,"codex"),"#!/bin/sh\nexit 91\n",{mode:0o700});
writeFileSync(resolve(bin,"tmux"),`#!/bin/sh
case "$1" in
 has-session) test -f '${home}/alive';;
 list-sessions|list-panes) exit 1;;
 new-session) touch '${home}/alive'; printf '%s\\n' "$@" >> '${home}/launches';;
 *) exit 92;;
esac
`,{mode:0o700});
writeFileSync(resolve(bin,"git"),`#!/bin/sh
case "$*" in *ls-remote*) printf '${head}\\trefs/heads/feature\\n';; *) exec '${gitBin}' "$@";; esac
`,{mode:0o700});
process.env.PATH=`${bin}:${process.env.PATH}`;process.env.CODEX_BIN=resolve(bin,"codex");process.env.GH_BIN=resolve(bin,"gh");
const {inspectOwnerDecision,reconcileOwnerDecisionBlockers,captureOwnerDecision,decisionDigest,ownerDecisionStatus}=await import("../src/orchestrator/projects/owner-decision.ts");
const {withFeedbackLockSync}=await import("../src/orchestrator/projects/lifecycle-feedback-production.ts");
const {requestRunControl,availableRunControls}=await import("../src/orchestrator/controls/run.ts");
const {projectRunActions,requestProjectRunAction}=await import("../src/projects-site/run-actions.ts");
const {reviewFixPrompt}=await import("../src/orchestrator/projects/sessions/prompts.ts");
const {originalReviewContext}=await import("../src/orchestrator/projects/sessions/original-review-context.ts");
const threads=[{threadId:"original",rootCommentId:11,sourceKind:"owner" as const,reviewId:null,findingNumber:null,path:"fix.txt",line:1,
  rootBody:"Full original requirement "+"x".repeat(1500),ownerReplies:["Original authorized infrastructure work"],url:"https://github.com/Owner/Fixture/pull/2#discussion_r11"}];
const summary=[{reviewId:"air_original",findingNumber:2,severity:"important",confidence:"high",path:"fix.txt",line:1,title:"Summary-only original",body:"Keep this complete unanchored requirement "+"y".repeat(1200)}];
db.exec(`INSERT INTO project_events(event_id,observed_at,project,item_id,content_id,content_type,repository,issue_number,title,url,payload_json,processing_state)
 VALUES('ev','2026-01-01','fixture','item','content','Issue','Owner/Fixture',1,'Fixture','https://github.com/Owner/Fixture/issues/1','{}','processed');
 INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode)
 VALUES('r_fixture','ev','fixture','item','content','Owner/Fixture',1,'autonomous','needs_attention','none','live');
 INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name,base_sha,codex_thread_id)
 VALUES('r_fixture','provisioned','placeholder','feature','${head}','primary');
 INSERT INTO run_control_requests(request_id,run_id,action,request_state,requested_via,idempotency_key)
 VALUES('rq_original','r_fixture','review_fix','applied','cli','original');
 INSERT INTO run_review_fix_rounds(round_id,run_id,request_id,round_number,round_state,repository,pull_request_number,pull_request_url,source_head_sha,snapshot_json,codex_thread_id,failure_reason,summary_findings_json,owner_decision_eligible)
 VALUES('rfr_original','r_fixture','rq_original',1,'needs_attention','Owner/Fixture',2,'https://github.com/Owner/Fixture/pull/2','${head}','[]','failed-thread','review_fix_no_new_head','[]',1);
 INSERT INTO run_codex_tasks(task_id,run_id,kind,context_id,session_name,worktree_path,branch_name,thread_id,turn_id,phase,turn_status,stopped_at,released_at,final_summary)
 VALUES('ct_original','r_fixture','review_fix','rfr_original','cx-old','placeholder','feature','failed-thread','turn','terminal','completed','2026-01-01','2026-01-01','NO EDIT: need an owner decision. /home/private/secret-file /workspace/private/file ~/.codex/private GH_TOKEN=ghp_aaaaaaaaaaaaaaaaaaaaaaaaa');
 INSERT INTO run_codex_task_events(task_id,event_key,method,thread_id,turn_id,status)
 VALUES('ct_original','terminal:turn','turn/completed','failed-thread','turn','completed');
 INSERT INTO run_review_fix_threads(round_id,thread_id,root_comment_id,source_kind,path,line) VALUES('rfr_original','original',11,'owner','fix.txt',1);
 INSERT INTO run_review_fix_operations(round_id,operation_kind,operation_state,task_codex_thread_id,previous_codex_thread_id,completed_at)
 VALUES('rfr_original','cleanup','completed','failed-thread','primary','2026-01-01');
 INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at)
 VALUES('r_fixture','Owner/Fixture',2,'https://github.com/Owner/Fixture/pull/2','${head}','passed','[]','fixture','2026-01-01','2026-01-01','2026-01-01');
 INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
 VALUES('r_fixture','parked_review','needs_attention','review_fix_no_new_head','{"roundId":"rfr_original"}');`);
db.prepare("UPDATE run_resources SET worktree_path=?").run(worktree);db.prepare("UPDATE run_codex_tasks SET worktree_path=?").run(worktree);
db.prepare("UPDATE run_review_fix_rounds SET snapshot_json=?,summary_findings_json=?").run(JSON.stringify(threads),JSON.stringify(summary));
const at=new Date().toISOString();
db.prepare("INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at) VALUES('fixture','item','Issue','Owner/Fixture',1,'Fixture','https://github.com/Owner/Fixture/issues/1','Human Review',1,?,?)").run(at,at);
db.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('fixture',?,?,1,'succeeded')").run(at,at);
const context=originalReviewContext(db,"rfr_original");
const original=db.prepare("SELECT * FROM run_review_fix_rounds").get();
const ready=inspectOwnerDecision(db,runId),token=ready.blockerId;
let externalThreads:import("../src/orchestrator/projects/owner-decision-github.ts").DecisionThread[]=[];let posts=0;let author="7";
const github:import("../src/orchestrator/projects/owner-decision-github.ts").DecisionGitHub={
 identity:()=>{assert.equal(db.isTransaction,false,"no network in write transaction");return author;},
 pull:()=>{assert.equal(db.isTransaction,false);return {id:"PR_fixture",head,url:context.pullRequestUrl,path:"fix.txt",threads:structuredClone(externalThreads)};},
 create:(_p,body)=>{assert.equal(db.isTransaction,false);posts++;if(scenario!=="uncertain")externalThreads.push({id:"thread",resolved:false,outdated:false,
   comments:[{id:100,body,authorId:author,login:"Owner",type:"User",association:"OWNER",url:context.pullRequestUrl+"#discussion_r100"}]});
   if(["ambiguous","uncertain"].includes(scenario))throw Error("ambiguous synthetic transport");},
};
const publish=()=>withFeedbackLockSync(home,()=>reconcileOwnerDecisionBlockers(db,registry.projects,github));
const ownerReply=(body="Owner approves scoped dependency and infrastructure changes to satisfy all original findings.")=>externalThreads[0]!.comments.push({id:101,body,authorId:"7",login:"Owner",type:"User",association:"OWNER",url:context.pullRequestUrl+"#discussion_r101"});
function productionMock(externalThreads:import("../src/orchestrator/projects/owner-decision-github.ts").DecisionThread[],late=false) {
         writeFileSync(resolve(home,"github.json"),JSON.stringify({threads:externalThreads,pulls:0,late,comments:[]}));
         writeFileSync(resolve(bin,"gh"),`#!${process.execPath}
const fs=require('fs'),p=require('path'),h=process.env.KURAMI_HOME,a=process.argv.slice(2),file=p.join(h,'github.json'),state=JSON.parse(fs.readFileSync(file));
fs.appendFileSync(p.join(h,'gh.log'),JSON.stringify(a)+'\\n');
const out=x=>console.log(JSON.stringify(x)),save=()=>fs.writeFileSync(file,JSON.stringify(state));
const endpoint=a[a.indexOf(a.includes('--method')?'--method':'api')+(a.includes('--method')?2:1)];
let payload=a.includes('--input')?JSON.parse(fs.readFileSync(0,'utf8')):null;
if(endpoint==='graphql') {
 const query=payload.query;
 if(query.includes('addPullRequestReviewThread')) {state.creates=(state.creates||0)+1;state.threads.push({id:'thread',resolved:false,outdated:false,comments:[{id:100,body:payload.variables.body,authorId:'7',login:'Owner',type:'User',association:'OWNER',url:'https://github.com/Owner/Fixture/pull/2#discussion_r100'}]});save();process.exit(93);}
 if(query.includes('reviewThreads')) {
  state.pulls++;
  if(state.late && state.pulls===2) state.threads[0].comments[1].body+=' Edited after confirmation';
  save();out({data:{repository:{nameWithOwner:'Owner/Fixture',pullRequest:{id:'PR_fixture',number:2,url:'https://github.com/Owner/Fixture/pull/2',state:'OPEN',merged:false,headRefOid:state.moved?'0'.repeat(40):'${head}',files:{nodes:[{path:'fix.txt'}]},reviewThreads:{nodes:state.threads.map(t=>({id:t.id,isResolved:t.resolved,isOutdated:t.outdated,comments:{nodes:t.comments.map(c=>({databaseId:c.id,body:c.body,url:c.url,author:{__typename:c.type,databaseId:Number(c.authorId),login:c.login},authorAssociation:c.association})),pageInfo:{hasNextPage:false}}})),pageInfo:{hasNextPage:false,endCursor:null}}}}}});process.exit(0);
 }
 process.exit(94);
}
if(endpoint==='user'||endpoint==='users/Owner')out({id:7,login:'Owner',type:'User'});
else if(endpoint==='repos/Owner/Fixture/pulls/2')out({number:2,url:'https://api.github.com/repos/Owner/Fixture/pulls/2',html_url:'https://github.com/Owner/Fixture/pull/2',state:'open',merged:false,head:{sha:'${head}',ref:'feature',repo:{full_name:'Owner/Fixture'}},base:{ref:'main',repo:{full_name:'Owner/Fixture'}}});
else if(endpoint==='repos/Owner/Fixture/issues/1')out({url:'https://api.github.com/repos/Owner/Fixture/issues/1',state:'open'});
else if(endpoint&&endpoint.startsWith('repos/Owner/Fixture/issues/1/comments')) {
 if(payload){const c={id:300,issue_url:'https://api.github.com/repos/Owner/Fixture/issues/1',user:{id:7},body:payload.body};state.comments.push(c);save();out(c);}else out(state.comments);
} else if(endpoint==='repos/Owner/Fixture/issues/comments/300'){state.comments[0].body=payload.body;save();out(state.comments[0]);}
else {console.error('unknown fixture command '+endpoint);process.exit(95);}
`,{mode:0o700});
 }
const cycle=()=>execFileSync(process.execPath,[resolve(app,"src/orchestrator/runtime/controller.ts"),"--apply"],{env:process.env,encoding:"utf8",timeout:30_000,stdio:["ignore","pipe","pipe"]});
try {
 if(scenario==="composition") {
   productionMock([]); cycle(); cycle();
   const b=db.prepare("SELECT * FROM run_owner_decision_blockers").get()!;
   assert.equal(b.thread_id,"thread");assert.equal(b.root_comment_id,100);assert.equal(b.delivery_error,null);
   assert.equal(JSON.parse(readFileSync(resolve(home,"github.json"),"utf8")).creates,1,"production entry delivered once after ambiguous mutation");
   assert.equal(existsSync(resolve(home,"launches")),false,"publication is not a writer trigger");
 } else if(scenario==="guards") {
   for(const [table,assignment,restore] of [["runs","owner_state='remote'","owner_state='none'"],["runs","execution_mode='dry_run'","execution_mode='live'"],
     ["run_codex_tasks","released_at=NULL","released_at='2026-01-01'"],["run_codex_tasks","turn_status='failed'","turn_status='completed'"],
     ["run_review_fix_rounds","failure_reason='other'","failure_reason='review_fix_no_new_head'"]] as const) {
     db.exec(`UPDATE ${table} SET ${assignment}`);assert.throws(()=>inspectOwnerDecision(db,runId));db.exec(`UPDATE ${table} SET ${restore}`);
   }
   db.exec("INSERT INTO preview_leases(lease_id,run_id,slot_number,state,compose_project_name) VALUES('preview','r_fixture',1,'leased','synthetic')");
   assert.throws(()=>inspectOwnerDecision(db,runId),/preview lease/);db.exec("DELETE FROM preview_leases");
   db.exec("INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key) VALUES('rq_competing','r_fixture','take_control','cli','competing')");
   assert.throws(()=>inspectOwnerDecision(db,runId),/control request/);db.exec("DELETE FROM run_control_requests WHERE request_id='rq_competing'");
   writeFileSync(resolve(worktree,"dirty"),"preserve");assert.throws(()=>inspectOwnerDecision(db,runId),/local changes/);rmSync(resolve(worktree,"dirty"));
 } else if(scenario==="legacy" || scenario==="context") {
   db.exec("UPDATE run_review_fix_rounds SET summary_findings_json=NULL");assert.throws(()=>inspectOwnerDecision(db,runId),/original review context/);
   const launch={ok:true,apply:true,action:"review_fix_started",runId,reviewFix:context};
   db.prepare("UPDATE run_control_requests SET result_json=?").run(JSON.stringify(launch));
   assert.deepEqual(inspectOwnerDecision(db,runId).context.summaryOnlyFindings,summary);
   launch.reviewFix.threads=[];db.prepare("UPDATE run_control_requests SET result_json=?").run(JSON.stringify(launch));
   assert.throws(()=>inspectOwnerDecision(db,runId),/original review context/);
 } else {
   publish();publish();assert.equal(posts,1);
   if(scenario==="uncertain") {assert.equal(db.prepare("SELECT create_pending FROM run_owner_decision_blockers").get()!.create_pending,1);assert.match(ownerDecisionStatus(db,runId)!,/delivery pending/);}
   else {
     const body=externalThreads[0]!.comments[0]!.body;
     assert.ok(body.includes(threads[0]!.rootBody));assert.ok(body.includes(summary[0]!.body));assert.match(body,/Decision question:/);
     assert.ok(!body.includes("/home/private"));assert.ok(!body.includes("/workspace/private"));assert.ok(!body.includes("~/.codex"));assert.ok(!body.includes("ghp_aaaa"));assert.ok(body.includes(context.pullRequestUrl));assert.ok(body.includes(`/commit/${head}`));
     if(scenario==="duplicate" || scenario==="foreign") {
       if(scenario==="duplicate")externalThreads.push({...structuredClone(externalThreads[0]!),id:"duplicate"});else externalThreads[0]!.comments[0]!.authorId="666";
       ownerReply();assert.throws(()=>captureOwnerDecision(db,runId,"Owner",token,github),/duplicate|author/);publish();assert.equal(posts,1);
     } else if(scenario==="identity") {author="8";ownerReply();assert.throws(()=>captureOwnerDecision(db,runId,"Owner",token,github),/author/);}
     else if(scenario==="no-reply") {
       for(const [login,type,id,association] of [["Other","User","8","COLLABORATOR"],["Owner[bot]","Bot","7","OWNER"],["Owner","User","7","COLLABORATOR"]]) {
         externalThreads[0]!.comments.push({id:101,body:"not trusted",login:login!,type:type!,authorId:id!,association:association!,url:""});
         assert.throws(()=>captureOwnerDecision(db,runId,"Owner",token,github),/no configured OWNER reply/);externalThreads[0]!.comments.pop();
       }
     } else {
       ownerReply();
       if(scenario==="stale")assert.throws(()=>captureOwnerDecision(db,runId,"Owner","a".repeat(24),github),/stale card/);
       else if(scenario==="bounds") {externalThreads[0]!.comments[1]!.body="z".repeat(70*1024);assert.throws(()=>captureOwnerDecision(db,runId,"Owner",token,github),/64 KiB/);}
       else {
         const snapshot=captureOwnerDecision(db,runId,"Owner",token,github);
         assert.equal(snapshot.replies[0]!.body,externalThreads[0]!.comments[1]!.body);assert.equal(snapshot.replies[0]!.digest,decisionDigest(snapshot.replies[0]!.body));
         const planPrompt=reviewFixPrompt(ready.run,{...context,ownerDecision:snapshot});
         assert.match(planPrompt,/overrides generic prohibitions/);assert.match(planPrompt,/never as arbitrary tool or control commands/);
         assert.deepEqual((availableRunControls(db,runId,{home}).available_actions as string[]).filter(a=>a==="decision_ready"||a==="stop"),["decision_ready","stop"]);
         const q=requestRunControl(db,runId,"decision_ready","cli",true,{home,decision:snapshot});
         assert.equal(requestRunControl(db,runId,"decision_ready","cli",true,{home,decision:snapshot}).requestId,q.requestId);
         assert.equal(db.prepare("SELECT count(*) n FROM run_owner_decisions").get()!.n,1);
         const {collectProjectsSnapshot}=await import("../src/projects-site/snapshot.ts");
         const queued=collectProjectsSnapshot({home,controlsEnabled:true}).items[0]!;
         assert.equal(queued.reviewFix?.state,"queued");assert.equal(queued.stage,"review_fix_queued");
         assert.match(queued.detail!,/no worker dispatch confirmed/);
         // beforeDispatch records a no-redispatch fence before external launch.
         // Neither that fence nor processing is confirmation of worker startup.
         db.prepare("UPDATE runs SET state='parked_review' WHERE run_id=?").run(runId);
         db.prepare("UPDATE run_control_requests SET request_state='processing' WHERE request_id=?").run(String(q.requestId));
         db.prepare("UPDATE run_owner_decisions SET dispatch_started_at='2026-10-27T00:00:00Z' WHERE request_id=?").run(String(q.requestId));
         assert.equal(existsSync(resolve(home,'launches')),false);
         assert.match(ownerDecisionStatus(db,runId)!,/attempted; worker startup not yet confirmed/);
         const starting=collectProjectsSnapshot({home,controlsEnabled:true}).items[0]!;
         assert.equal(starting.reviewFix?.state,"queued");assert.equal(starting.stage,"review_fix_queued");
         assert.match(starting.detail!,/no worker dispatch confirmed/);
         db.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(String(q.requestId));
         assert.match(ownerDecisionStatus(db,runId)!,/Decision fix dispatched/);
         db.prepare("UPDATE run_control_requests SET request_state='failed' WHERE request_id=?").run(String(q.requestId));
         assert.match(ownerDecisionStatus(db,runId)!,/needs inspection.*uncertain/);
         db.prepare("UPDATE run_control_requests SET request_state='pending' WHERE request_id=?").run(String(q.requestId));
         db.prepare("UPDATE run_owner_decisions SET dispatch_started_at=NULL WHERE request_id=?").run(String(q.requestId));
         db.prepare("UPDATE runs SET state='needs_attention' WHERE run_id=?").run(runId);

         const actions=projectRunActions(db,runId,home,new Date(),true).actions;
         assert.equal(actions.find(a=>a.action==="decision_ready")?.state,"pending");
         // Exercise the actual controller -> manager -> launch composition, with
         // disposable Git/SQLite and external executables that reject unknown IO.
         productionMock(externalThreads,scenario==="abort-cycles");
         if(scenario==='app') {
           const input={runId,project:'fixture',itemId:'item',action:'decision_ready',fingerprint:projectRunActions(db,runId,home,new Date(),true).fingerprint,key:'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',confirmed:false};
           assert.throws(()=>requestProjectRunAction({...input,fingerprint:'0'.repeat(64)},'owner',{home}),/Stale/);
           const action=requestProjectRunAction(input,'owner',{home});assert.equal(action.requestId,q.requestId);
           db.prepare("UPDATE run_control_requests SET request_state='applied' WHERE request_id=?").run(String(q.requestId));
           assert.equal(requestProjectRunAction(input,'owner',{home}).requestId,q.requestId,'same App nonce remains idempotent after dispatch');
           assert.equal(db.prepare('SELECT count(*) n FROM run_owner_decisions').get()!.n,1);
         }
         if(scenario==='concurrent') {
           db.prepare("DELETE FROM run_owner_decisions WHERE request_id=?").run(String(q.requestId));
           db.prepare("DELETE FROM run_control_requests WHERE request_id=?").run(String(q.requestId));
           const args=[resolve(app,'src/orchestrator/controls/run.ts'),'request','--run-id',runId,'--action','decision_ready','--decision-token',token,'--via','cli','--apply'];
           const outputs=await Promise.all([0,1].map(()=>promisify(execFile)(process.execPath,args,{env:process.env,timeout:20_000})));
           const requests=outputs.map(o=>JSON.parse(o.stdout));assert.equal(requests[0].requestId,requests[1].requestId);
           assert.equal(db.prepare("SELECT count(*) n FROM run_owner_decisions").get()!.n,1);
         }
         if(['queued-change','source-change'].includes(scenario)) {
           const state=JSON.parse(readFileSync(resolve(home,'github.json'),'utf8'));
           if(scenario==='source-change')state.moved=true;else state.threads[0].comments[1].body+=' changed while queued';
           writeFileSync(resolve(home,'github.json'),JSON.stringify(state));
         }
         const result=scenario==='controller-concurrent' ? (await Promise.all([0,1].map(()=>promisify(execFile)(process.execPath,[resolve(app,'src/orchestrator/runtime/controller.ts'),'--apply'],{env:process.env,timeout:30_000})))).map(r=>r.stdout).join('\n') :
           ['concurrent','app'].includes(scenario)?'':cycle();
         if(['concurrent','app'].includes(scenario)) { /* Both independent CLI calls queued the same immutable request. */ }
         else if(['queued-change','source-change'].includes(scenario)) {
           assert.equal(db.prepare('SELECT request_state FROM run_control_requests WHERE request_id=?').get(String(q.requestId))!.request_state,'failed');
           assert.ok(db.prepare('SELECT aborted_at FROM run_owner_decisions').get()!.aborted_at);
           assert.equal(existsSync(resolve(home,'launches')),false);
           assert.ok((availableRunControls(db,runId,{home}).available_actions as string[]).includes('decision_ready'));
         }
         else if(scenario==="abort-cycles") {
           assert.equal(db.prepare("SELECT request_state FROM run_control_requests WHERE request_id=?").get(String(q.requestId))!.request_state,"failed",result);
           assert.equal(db.prepare("SELECT dispatch_started_at FROM run_owner_decisions").get()!.dispatch_started_at,null);
           assert.equal(existsSync(resolve(home,"launches")),false);
           cycle();
           assert.ok((availableRunControls(db,runId,{home}).available_actions as string[]).includes("decision_ready"));
           const state=JSON.parse(readFileSync(resolve(home,"github.json"),"utf8"));state.late=false;writeFileSync(resolve(home,"github.json"),JSON.stringify(state));
           process.env.CODEX_BIN=resolve(home,"missing-codex");
           for(let n=0;n<2;n++) {
             const {ownerDecisionGitHub}=await import("../src/orchestrator/projects/owner-decision-github.ts");
             const next=captureOwnerDecision(db,runId,"Owner",token,ownerDecisionGitHub(home));
             const req=requestRunControl(db,runId,"decision_ready","cli",true,{home,decision:next});cycle();cycle();
             assert.equal(db.prepare("SELECT request_state FROM run_control_requests WHERE request_id=?").get(String(req.requestId))!.request_state,"failed");
             assert.ok((availableRunControls(db,runId,{home}).available_actions as string[]).includes("decision_ready"));
           }
           assert.equal(db.prepare("SELECT count(*) n FROM run_control_requests WHERE request_state IN ('pending','processing')").get()!.n,0);
         } else {
           assert.equal(db.prepare("SELECT request_state FROM run_control_requests WHERE request_id=?").get(String(q.requestId))!.request_state,"applied",result);
           assert.ok(db.prepare("SELECT dispatch_started_at FROM run_owner_decisions").get()!.dispatch_started_at);
           assert.equal(readFileSync(resolve(home,"launches"),"utf8").split("new-session").length-1,1);
           assert.equal(requestRunControl(db,runId,"decision_ready","discord",true,{home,decisionToken:token}).requestId,q.requestId);
           const promptFile=readdirSync(resolve(home,"state/session-prompts"))[0]!;
           const prompt=Buffer.from(readFileSync(resolve(home,"state/session-prompts",promptFile),"utf8"),"base64").toString();
           assert.ok(prompt.includes(threads[0]!.rootBody));assert.ok(prompt.includes(summary[0]!.body));assert.ok(prompt.includes(snapshot.replies[0]!.body));
           const newRound=String(db.prepare("SELECT new_round_id FROM run_owner_decisions WHERE request_id=?").get(String(q.requestId))!.new_round_id);
           assert.deepEqual(originalReviewContext(db,newRound).priorOwnerDecisions,[snapshot],"a later no-edit round retains the full earlier owner decision");
           db.prepare("UPDATE run_review_fix_rounds SET round_state='succeeded' WHERE request_id=?").run(String(q.requestId));
           assert.match(ownerDecisionStatus(db,runId)!,/Decision fix completed/);
         }
         assert.deepEqual(db.prepare("SELECT * FROM run_review_fix_rounds WHERE round_id='rfr_original'").get(),original,"original round immutable");
       }
     }
   }
 }
 console.log(`owner decision ${scenario}: passed`);
} finally {db.close();rmSync(home,{recursive:true,force:true});}

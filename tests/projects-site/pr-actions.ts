import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,readdirSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {inspectProjectPr,requestProjectPr,parsePrAction,type PrActionInput} from "../../src/projects-site/pr-actions.ts";
import {createPullRequestClient,GitHubPrRejected,type PullRequestState,type PullRequestClient} from "../../src/orchestrator/integrations/github/pull-request-actions.ts";
import {requestRunControl} from "../../src/orchestrator/controls/run.ts";
import {requestProjectsReview} from "../../src/projects-site/actions.ts";
import {requestProjectStatus} from "../../src/projects-site/status.ts";
import {collectProjectsSnapshot} from "../../src/projects-site/snapshot.ts";
import {createProjectsServer} from "../../src/projects-site/server.ts";

const home=mkdtempSync(join(tmpdir(),"kurami-pr-actions-")),at="2026-10-04T10:00:00Z",head="a".repeat(40);
mkdirSync(join(home,"state"));mkdirSync(join(home,"config"));
writeFileSync(join(home,"config/projects.yaml"),JSON.stringify({projects:{alpha:{owner:"Example",project_number:1,repository:"Example/Alpha",status_field:"Status",statuses:{backlog:"Backlog",active:"Doing",review:"Review",done:"Done",deferred:"Later"}}}}));
const db=new DatabaseSync(join(home,"state/orchestrator.db"));
const migrationRoot=resolve(import.meta.dirname,"../../migrations");
for(const file of readdirSync(migrationRoot).filter(name=>/^\d+_.*\.sql$/.test(name)).sort())db.exec(readFileSync(join(migrationRoot,file),"utf8"));
db.prepare("INSERT INTO project_events(event_id,observed_at,project,item_id,content_type,payload_json) VALUES('event',?,'alpha','item12','Issue','{}')").run(at);
db.exec("INSERT INTO runs(run_id,trigger_event_id,project,item_id,content_id,repository,issue_number,interaction_policy,state,owner_state,execution_mode) VALUES('r_current','event','alpha','item12','issue12','Example/Alpha',12,'autonomous','parked_review','none','live')");
db.exec("INSERT INTO run_resources(run_id,resource_state,worktree_path,branch_name) VALUES('r_current','provisioned','/tmp/synthetic-pr-worktree','synthetic-branch')");
db.prepare("INSERT INTO project_items(project,item_id,content_type,repository,issue_number,title,url,status,present,first_seen_at,last_seen_at) VALUES('alpha','item12','Issue','Example/Alpha',12,'Fixture','https://github.com/Example/Alpha/issues/12','Review',1,?,?)").run(at,at);
db.prepare("INSERT INTO project_poll_state(project,initialized_at,last_captured_at,item_count,last_attempt_state) VALUES('alpha',?,?,1,'succeeded')").run(at,at);
db.prepare("INSERT INTO run_ci_snapshots(run_id,repository,pull_request_number,pull_request_url,head_sha,aggregate_state,checks_json,content_digest,first_observed_at,last_observed_at,completed_at) VALUES('r_current','Example/Alpha',20,'https://github.com/Example/Alpha/pull/20',?,'passed','[]','digest',?,?,?)").run(head,at,at,at);
const template:PullRequestState={id:"PR_fixture",url:"https://github.com/Example/Alpha/pull/20",head,base:"main",state:"OPEN",draft:true,canUpdate:true,canMerge:true,mergeable:"MERGEABLE",mergeState:"CLEAN",methods:["squash","rebase","merge"],queued:false,queueEnabled:false,stacked:false,defaultBase:true};
let remote=structuredClone(template),instant=new Date(at),writes=0,reads=0,timeout=false,applyBeforeTimeout=false,reject=false,pendingMerge=false,resultFailed=false;
let readGate:Promise<void>|null=null;
const uuid=randomUUID();
const github:PullRequestClient={
  async read(repository,number){reads++;assert.equal(repository,"Example/Alpha");assert.equal(number,20);if(readGate)await readGate;return structuredClone(remote);},
  async ready(id){writes++;assert.equal(id,remote.id);if(!timeout||applyBeforeTimeout)remote.draft=false;if(reject)throw new GitHubPrRejected('private refusal');if(timeout)throw new Error('private timeout');},
  async merge(repository,number,sha,method){writes++;assert.equal(repository,"Example/Alpha");assert.equal(number,20);assert.equal(sha,head);assert.ok(remote.methods.includes(method));if(reject)throw new GitHubPrRejected('private refusal');if(!pendingMerge&&(!timeout||applyBeforeTimeout))remote.state="MERGED";if(timeout)throw new Error('private timeout');return {state:pendingMerge?"pending":"merged",uuid:pendingMerge?uuid:null};},
  async result(repository,number,key){assert.equal(repository,"Example/Alpha");assert.equal(number,20);assert.equal(key,uuid);return {state:resultFailed?"failed":"pending",uuid};},
};
const options={home,now:()=>instant,github};
const inspect=()=>inspectProjectPr("alpha","item12",options);
async function input():Promise<PrActionInput>{const v=await inspect();return {project:"alpha",itemId:"item12",action:v.action??"ready",head:v.head,fingerprint:v.fingerprint,key:randomUUID(),confirmed:true,method:v.action==="merge"?v.methods[0]!:null};}
function reset(){db.exec("DELETE FROM project_pr_requests; DELETE FROM project_status_requests; DELETE FROM run_control_requests; UPDATE runs SET state='parked_review',owner_state='none'; UPDATE project_items SET present=1,status='Review'");db.prepare("UPDATE project_poll_state SET last_captured_at=?,last_attempt_state='succeeded'").run(at);db.prepare("UPDATE run_ci_snapshots SET head_sha=?").run(head);remote=structuredClone(template);instant=new Date(at);writes=reads=0;timeout=applyBeforeTimeout=reject=pendingMerge=resultFailed=false;readGate=null;}
try {
  assert.equal((await inspect()).action,"ready");
  for(const requestState of ["checking","writing","awaiting_sync","uncertain"]){
    reset();
    db.prepare("UPDATE project_items SET last_seen_at=?").run(at);
    db.prepare("INSERT INTO project_status_requests(request_id,project,item_id,actor_subject,idempotency_key,client_key,from_status,to_status,request_state,created_at,updated_at) VALUES('status','alpha','item12','owner','status','status','Review','Doing',?,?,?)").run(requestState,at,at);
    assert.equal((await inspect()).enabled,false,'unsettled status operation blocks PR actions');
    db.prepare("UPDATE project_items SET last_seen_at=?").run(new Date(Date.parse(at)+1000).toISOString());
    assert.equal((await inspect()).enabled,requestState==="awaiting_sync",'only a positively observed settled status write stops blocking');
    const receipt=db.prepare("SELECT request_state FROM project_status_requests").get();
    assert.equal(receipt!.request_state,requestState,'read-only inspection preserves the original receipt');
    if(requestState==="awaiting_sync"){
      db.exec("UPDATE project_items SET status='Doing'");
      assert.equal((await inspect()).enabled,true,'observed target status also unblocks a finished write');
      db.prepare("UPDATE project_poll_state SET last_captured_at=?").run(new Date(Date.parse(at)-120001).toISOString());
      assert.equal((await inspect()).enabled,false,'settled status cannot bypass the freshness guard');
    }
    assert.equal(writes,0);
  }
  reset();db.prepare("UPDATE project_items SET last_seen_at=?").run(at);
  const original=await input(),items=db.prepare("SELECT * FROM project_items").all();
  const ready=await requestProjectPr(original,"owner",options);assert.equal(ready.state,"applied");assert.equal(remote.draft,false);assert.equal(writes,1);
  assert.equal((await requestProjectPr(original,"owner",options)).requestId,ready.requestId);assert.equal(writes,1,"nonce retry does not promote twice");
  assert.equal((await inspect()).action,"merge");
  const merge=await input();assert.equal((await requestProjectPr(merge,"owner",options)).state,"applied");assert.equal(writes,2);
  assert.equal((await inspect()).reason,"PR merged.");
  assert.deepEqual(db.prepare("SELECT * FROM project_items").all(),items,"GitHub owns Done; no local status write");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM project_events").get()!.n,1,"no synthetic board events");
  assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(),[]);

  for(const [field,value] of [["head","b".repeat(40)],["canUpdate",false],["state","CLOSED"]] as const){reset();const i=await input();Object.assign(remote,{[field]:value});await assert.rejects(requestProjectPr(i,"owner",options));assert.equal(writes,0);}
  for(const changes of [{canMerge:false},{mergeState:"BLOCKED"},{mergeState:"BEHIND"},{mergeState:"UNKNOWN"},{mergeState:"UNSTABLE"},{mergeable:"CONFLICTING"},{queueEnabled:true},{queued:true},{stacked:true},{defaultBase:false},{methods:[]}] as Partial<PullRequestState>[]){reset();remote.draft=false;const i=await input();Object.assign(remote,changes);assert.equal((await inspect()).enabled,false);await assert.rejects(requestProjectPr(i,"owner",options));assert.equal(writes,0);}
  reset();remote.draft=false;const changedMethod=await input();remote.methods=["rebase"];await assert.rejects(requestProjectPr(changedMethod,"owner",options));assert.equal(writes,0);
  reset();const stale=await input();instant=new Date(Date.parse(at)+120001);assert.equal((await inspect()).enabled,false);await assert.rejects(requestProjectPr(stale,"owner",options));assert.equal(writes,0);
  reset();const unstable=await input();db.exec("UPDATE runs SET owner_state='remote'");await assert.rejects(requestProjectPr(unstable,"owner",options));assert.equal(writes,0);
  reset();const cancelledIntent=await input();db.exec("UPDATE project_items SET status='Backlog'");await assert.rejects(requestProjectPr(cancelledIntent,"owner",options));assert.equal(writes,0,"unprocessed cancellation intent still blocks merging");
  reset();const invalid=await input();for(const change of [{confirmed:false},{head:"1234"},{key:"bad"},{fingerprint:"<script>"},{action:"delete"},{method:"squash"},{checkOnly:"yes"}])assert.throws(()=>parsePrAction({...invalid,...change}));
  await assert.rejects(requestProjectPr({...invalid,checkOnly:true},"owner",options));assert.equal(writes,0,"check-only never starts a write");

  reset();timeout=true;applyBeforeTimeout=true;const lost=await input();assert.equal((await requestProjectPr(lost,"owner",options)).state,"uncertain");instant=new Date(Date.parse(at)+31000);
  const readOnlyBefore=db.prepare("SELECT * FROM project_pr_requests").all();assert.equal((await inspect()).checkOnly,true);assert.deepEqual(db.prepare("SELECT * FROM project_pr_requests").all(),readOnlyBefore,"GET inspection changes no request receipt");
  assert.equal((await requestProjectPr({...lost,checkOnly:true},"owner",options)).state,"applied");assert.equal(writes,1,"restart recovery observes without another mutation");
  reset();timeout=true;const unknown=await input();assert.equal((await requestProjectPr(unknown,"owner",options)).state,"uncertain");instant=new Date(Date.parse(at)+31000);assert.equal((await requestProjectPr(unknown,"owner",options)).state,"uncertain");assert.equal(writes,1,"ambiguous timeout never authorizes another write");
  assert.throws(()=>requestRunControl(db,"r_current","stop","discord",true,{home}),/PR action/);
  assert.throws(()=>requestProjectsReview({runId:"r_current",project:"alpha",itemId:"item12",head,key:randomUUID()},"owner",{home,now:instant}),/processing/);
  await assert.rejects(requestProjectStatus({project:"alpha",itemId:"item12",from:"Review",target:"Done",observedAt:at,key:randomUUID()},"owner",{home,now:()=>instant,github:{read:async()=>{throw new Error('should not read');},write:async()=>{throw new Error('should not write');}}}),/processing/);
  assert.equal(collectProjectsSnapshot({home,now:instant,controlsEnabled:true}).items[0]!.aiReview!.enabled,false);

  reset();reject=true;const denied=await input();assert.equal((await requestProjectPr(denied,"owner",options)).state,"failed");assert.equal(writes,1);
  reset();remote.draft=false;pendingMerge=true;const queued=await input();assert.equal((await requestProjectPr(queued,"owner",options)).state,"pending");assert.equal(writes,1);
  instant=new Date(Date.parse(at)+31000);assert.equal((await requestProjectPr(queued,"owner",options)).state,"pending");assert.equal(writes,1);
  remote.state="MERGED";instant=new Date(Date.parse(at)+62000);assert.equal((await requestProjectPr({...queued,checkOnly:true},"owner",options)).state,"applied");assert.equal(writes,1);
  reset();remote.draft=false;pendingMerge=true;const failedMerge=await input();await requestProjectPr(failedMerge,"owner",options);instant=new Date(Date.parse(at)+31000);resultFailed=true;assert.equal((await requestProjectPr({...failedMerge,checkOnly:true},"owner",options)).state,"failed");assert.equal(writes,1);

  reset();const concurrent=await input();let release!:()=>void;readGate=new Promise<void>(done=>release=done);
  const one=requestProjectPr(concurrent,"owner",options),two=requestProjectPr({...concurrent,key:randomUUID()},"owner",options);release();readGate=null;
  const results=await Promise.all([one,two]);assert.equal(writes,1);assert.equal(results[0]!.requestId,results[1]!.requestId,"concurrent renders share one claimed operation");

  const calls:{path:string;method:string;body:any}[]=[];
  const transport=createPullRequestClient(async(path,method="GET",body?:any)=>{
    calls.push({path,method,body});
    if(path==="graphql"&&body.query.includes("ProjectsPullRequest"))return {data:{repository:{nameWithOwner:"Example/Alpha",viewerPermission:"ADMIN",isArchived:false,mergeCommitAllowed:true,squashMergeAllowed:true,rebaseMergeAllowed:true,defaultBranchRef:{name:"main"},pullRequest:{id:"PR_fixture",url:template.url,headRefOid:head,baseRefName:"main",state:"OPEN",isDraft:false,viewerCanUpdate:true,mergeable:"MERGEABLE",mergeStateStatus:"CLEAN",isInMergeQueue:false,isMergeQueueEnabled:false,stack:null}}}};
    if(path.includes("rules/branches"))return [{type:"required_linear_history"},{type:"pull_request",parameters:{allowed_merge_methods:["rebase","merge"]}}];
    if(path.includes("branches/"))return {name:"main",protected:true};
    if(path==="graphql")return {data:{markPullRequestReadyForReview:{clientMutationId:body.variables.key,pullRequest:{id:body.variables.id,isDraft:false}}}};
    return {status:"pending",details:{uuid}};
  });
  assert.deepEqual((await transport.read("Example/Alpha",20)).methods,["rebase"],"effective branch rules intersect repo settings");
  await transport.ready("PR_fixture","mutation");await transport.merge("Example/Alpha",20,head,"rebase");await transport.result("Example/Alpha",20,uuid);
  const mutation=calls.find(call=>call.method==="PUT")!;assert.deepEqual(mutation.body,{sha:head,merge_method:"rebase",merge_action:"direct_merge",bypass_rules:false});
  assert.ok(calls.some(call=>call.path.endsWith(uuid)&&call.method==="GET"));

  let httpWrites=0,httpReads=0;
  const server=createProjectsServer({authorize:async req=>req.headers.authorization==="owner"?"owner":null,origin:"https://kurami.example",prInspect:async()=>{httpReads++;return {action:"ready",enabled:true,reason:"",head,fingerprint:"f".repeat(64),methods:["squash"],number:20,base:"main"};},prAction:async()=>{httpWrites++;return {state:"applied",requestId:"fixture"};}});
  await new Promise<void>(done=>server.listen(0,"127.0.0.1",done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    assert.equal((await fetch(origin+"/api/pr-controls?project=alpha&item=item12")).status,403);assert.equal(httpReads,0);
    assert.equal((await fetch(origin+"/api/pr-controls?project=alpha&item=item12",{headers:{authorization:"owner"}})).status,200);
    await fetch(origin+"/api/pr-controls?project=alpha&item=item12",{headers:{authorization:"owner"}});assert.equal(httpReads,1,"only selected PR read, short cache, owner auth each time");
    const post=(headers:Record<string,string>)=>fetch(origin+"/api/pr-action",{method:"POST",headers:{"Content-Type":"application/json",authorization:"owner",...headers},body:"{}"});
    assert.equal((await post({origin:"https://evil.example"})).status,403);assert.equal(httpWrites,0);
    assert.equal((await post({origin:"https://kurami.example","Sec-Fetch-Site":"cross-site"})).status,403);assert.equal(httpWrites,0);
    assert.equal((await post({origin:"https://kurami.example"})).status,200);assert.equal(httpWrites,1);
  } finally {await new Promise<void>(done=>server.close(()=>done()));}
} finally {db.close();rmSync(home,{recursive:true,force:true});}
console.log("Projects PR actions: live capabilities, exact SHA, confirmations, concurrency, ambiguous recovery, GitHub-owned Done and HTTP authorization verified");

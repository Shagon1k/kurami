import {createHash,randomUUID} from "node:crypto";
import {resolve} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {resolveKuramiHome} from "../core/kurami-home.ts";
import {inspectAiReview} from "../orchestrator/controls/ai-review.ts";
import {githubPullRequests,GitHubPrRejected,type PullRequestClient,type PullRequestState,type MergeMethod} from "../orchestrator/integrations/github/pull-request-actions.ts";
import {ProjectsActionError} from "./actions.ts";
import {projectsRegistry} from "./snapshot.ts";
import {PROJECTS_STALE_AFTER_MS} from "./model.ts";

export type PrActionInput={project:string;itemId:string;action:"ready"|"merge";head:string;fingerprint:string;key:string;confirmed:boolean;method:MergeMethod|null;checkOnly?:boolean};
type RequestState="checking"|"writing"|"pending"|"applied"|"failed"|"conflict"|"uncertain";
export type PrActionResult={state:RequestState;requestId:string};
export type PrActionView={action:"ready"|"merge"|null;enabled:boolean;reason:string;noteTone?:"neutral"|"info"|"warning"|"failure";head:string;fingerprint:string;methods:MergeMethod[];number:number|null;base:string;key?:string;method?:MergeMethod|null;checkOnly?:boolean};
type Options={home?:string;now?:()=>Date;github?:PullRequestClient};
type Context={runId:string;repository:string;number:number;head:string;url:string};
type Row={request_id:string;project:string;item_id:string;run_id:string;actor_subject:string;client_key:string;action:"ready"|"merge";merge_method:MergeMethod|null;repository:string;pr_number:number;pr_id:string;head_sha:string;fingerprint:string;request_state:RequestState;github_request_uuid:string|null;updated_at:string};
const active=["checking","writing","pending","uncertain"];
const unavailable=(reason="unavailable"):PrActionView=>({action:null,enabled:false,reason,head:"",fingerprint:"",methods:[],number:null,base:""});
function open(options:Options,readOnly=false) {
  const home=options.home??resolveKuramiHome(resolve(import.meta.dirname,"../../.."));
  return {home,db:new DatabaseSync(resolve(home,"state/orchestrator.db"),{readOnly,timeout:1_000})};
}
function context(db:DatabaseSync,home:string,project:string,itemId:string,now:Date,stable=true):Context {
  const config=projectsRegistry(resolve(home,"config/projects.yaml"))[project];
  const item=db.prepare("SELECT present,repository,status FROM project_items WHERE project=? AND item_id=?").get(project,itemId) as {present:number;repository:string;status:string|null}|undefined;
  const run=db.prepare("SELECT run_id FROM runs WHERE project=? AND item_id=? ORDER BY rowid DESC LIMIT 1").get(project,itemId) as {run_id:string}|undefined;
  const inspection=run?inspectAiReview(db,run.run_id):null;
  if(!config||!item?.present||item.repository?.toLowerCase()!==config.repository.toLowerCase()||!inspection||inspection.repository.toLowerCase()!==config.repository.toLowerCase())
    throw new ProjectsActionError(409,"This run is no longer current.");
  const poll=db.prepare("SELECT last_captured_at,last_attempt_state FROM project_poll_state WHERE project=?").get(project) as {last_captured_at:string;last_attempt_state:string}|undefined;
  const age=now.getTime()-Date.parse(poll?.last_captured_at??"");
  if(!poll||poll.last_attempt_state!=="succeeded"||!Number.isFinite(age)||age<0||age>=PROJECTS_STALE_AFTER_MS)
    throw new ProjectsActionError(409,"Wait for fresh sync data.");
  if(stable&&!["eligible","ready"].includes(inspection.reason))throw new ProjectsActionError(409,"PR actions unlock when current work finishes.");
  if(stable&&![config.statuses.active,config.statuses.review].includes(item.status??""))throw new ProjectsActionError(409,"PR actions require an active or review task.");
  if(stable&&db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_status_requests'").get()&&
    db.prepare("SELECT 1 FROM project_status_requests WHERE project=? AND item_id=? AND request_state IN ('checking','writing','awaiting_sync','uncertain') LIMIT 1").get(project,itemId))
    throw new ProjectsActionError(409,"A status change is still synchronizing.");
  const url=new URL(inspection.prUrl??"https://invalid.local"),segments=url.pathname.split("/");
  if(url.origin!=="https://github.com"||url.username||url.password||url.search||url.hash||segments.length!==5||
    `${segments[1]}/${segments[2]}`.toLowerCase()!==config.repository.toLowerCase()||segments[3]!=="pull"||!/^\d+$/.test(segments[4]!)||Number(segments[4])<1||!inspection.head)
    throw new ProjectsActionError(409,"The current PR commit is not verified yet.");
  return {runId:run!.run_id,repository:config.repository,number:Number(segments[4]),head:inspection.head,url:url.href};
}
function fingerprint(c:Context,p:PullRequestState):string {
  return createHash("sha256").update(JSON.stringify([c.runId,p.id,p.head,p.base,p.state,p.draft,p.methods])).digest("hex");
}
function view(c:Context,p:PullRequestState):PrActionView {
  if(p.url.toLowerCase()!==c.url.toLowerCase())throw new Error("GitHub PR identity changed");
  const result:PrActionView={action:p.draft?"ready":"merge",enabled:false,reason:"",head:p.head,fingerprint:fingerprint(c,p),methods:p.methods,number:c.number,base:p.base};
  if(p.state!=="OPEN")return {...result,action:null,noteTone:"neutral",reason:p.state==="MERGED"?"PR merged.":"PR closed."};
  if(p.head!==c.head)return {...result,reason:"PR commit changed. Wait for CI sync."};
  if(p.draft)return {...result,enabled:p.canUpdate,reason:p.canUpdate?"":"GitHub permissions do not allow this action."};
  const reason=p.rulesKnown===false?"GitHub branch rules could not be checked.":!p.canMerge?"GitHub permissions do not allow this action.":p.stacked||!p.defaultBase?"Merge this branch or stack in GitHub.":
    p.queueEnabled||p.queued?"Manage the merge queue in GitHub.":!p.methods.length?"No merge method is available.":
    p.mergeable==="CONFLICTING"||p.mergeState==="DIRTY"?"Resolve merge conflicts in GitHub.":
    p.mergeState==="BEHIND"?"Update the PR branch in GitHub.":p.mergeState==="BLOCKED"?"GitHub requirements block merging.":
    !["CLEAN","HAS_HOOKS"].includes(p.mergeState)||p.mergeable!=="MERGEABLE"?"Waiting for GitHub checks and mergeability.":"";
  return {...result,enabled:!reason,reason};
}
async function observed(row:Row,p:PullRequestState,github:PullRequestClient):Promise<RequestState> {
  if(!active.includes(row.request_state))return row.request_state;
  if(p.id!==row.pr_id)return "conflict";
  if(row.action==="ready"&&!p.draft)return "applied";
  if(row.action==="merge"&&p.state==="MERGED")return p.head===row.head_sha?"applied":"conflict";
  if(row.github_request_uuid) {
    const result=await github.result(row.repository,row.pr_number,row.github_request_uuid);
    if(result.state==="failed")return "failed";
    // Only the live PR read proves a merge. Accepted/enqueued is not completion.
    return "pending";
  }
  if(p.head!==row.head_sha||p.state!=="OPEN")return "conflict";
  return row.request_state;
}

/** Reads only the selected task's GitHub state; table snapshots remain local and network-free. */
export async function inspectProjectPr(project:string,itemId:string,options:Options={}):Promise<PrActionView> {
  let db:DatabaseSync|undefined;
  try {
    const opened=open(options,true);db=opened.db;
    if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_pr_requests'").get())return unavailable();
    const c=context(db,opened.home,project,itemId,(options.now??(()=>new Date()))(),false);
    const github=options.github??githubPullRequests,p=await github.read(c.repository,c.number);
    const row=db.prepare("SELECT * FROM project_pr_requests WHERE lower(repository)=lower(?) AND pr_number=? ORDER BY rowid DESC LIMIT 1").get(c.repository,c.number) as Row|undefined;
    if(row&&active.includes(row.request_state)) {
      const state=await observed(row,p,github);
      return {...view(c,p),action:row.action,head:row.head_sha,fingerprint:row.fingerprint,key:row.client_key,method:row.merge_method,checkOnly:true,
        noteTone:state==="uncertain"?"warning":state==="failed"||state==="conflict"?"failure":"info",
        enabled:(options.now??(()=>new Date()))().getTime()-Date.parse(row.updated_at)>=30_000,
        reason:state==="applied"?"Action confirmed. Finish checking.":state==="failed"||state==="conflict"?"GitHub did not complete this PR action.":state==="uncertain"?"PR action unconfirmed. Check its result in GitHub.":"GitHub is processing this PR action."};
    }
    if(p.state!=="OPEN")return view(c,p);
    const final=context(db,opened.home,project,itemId,(options.now??(()=>new Date()))());
    if(final.runId!==c.runId||final.head!==c.head||final.url!==c.url)return unavailable("PR action changed. Reopen the confirmation.");
    return view(c,p);
  } catch(error) {return unavailable(error instanceof ProjectsActionError?error.message:"PR actions are temporarily unavailable.");}
  finally {db?.close();}
}
export function parsePrAction(value:unknown):PrActionInput {
  const p=value as PrActionInput;
  if(!p||typeof p!=="object"||typeof p.project!=="string"||!/^[-a-z0-9_]{1,100}$/.test(p.project)||typeof p.itemId!=="string"||!p.itemId||p.itemId.length>200||
    !["ready","merge"].includes(p.action)||typeof p.head!=="string"||!/^([a-f0-9]{40}|[a-f0-9]{64})$/.test(p.head)||
    typeof p.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(p.fingerprint)||typeof p.key!=="string"||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(p.key)||
    p.confirmed!==true||(p.checkOnly!==undefined&&typeof p.checkOnly!=="boolean")||(p.action==="merge"?!["squash","rebase","merge"].includes(p.method??""):p.method!==null))
    throw new ProjectsActionError(400,"Invalid PR action or missing confirmation.");
  return p;
}
export async function requestProjectPr(value:unknown,actor:string,options:Options={}):Promise<PrActionResult> {
  const input=parsePrAction(value),{home,db}=open(options),now=options.now??(()=>new Date()),github=options.github??githubPullRequests;
  const result=(row:Row):PrActionResult=>({state:row.request_state,requestId:row.request_id});
  const set=(row:Row,state:RequestState)=>{
    db.prepare("UPDATE project_pr_requests SET request_state=?,updated_at=? WHERE request_id=? AND request_state IN ('checking','writing','pending','uncertain')").run(state,now().toISOString(),row.request_id);
    row.request_state=(db.prepare("SELECT request_state FROM project_pr_requests WHERE request_id=?").get(row.request_id) as {request_state:RequestState}).request_state;return result(row);
  };
  const reconcile=async(row:Row)=>{
    if(!active.includes(row.request_state)||now().getTime()-Date.parse(row.updated_at)<30_000)return result(row);
    try {
      const p=await github.read(row.repository,row.pr_number);
      if(row.request_state==="checking")return set(row,"failed");
      return set(row,await observed(row,p,github));
    }
    catch {return set(row,"uncertain");}
  };
  try {
    db.exec("PRAGMA foreign_keys=ON");
    const idempotency=createHash("sha256").update(JSON.stringify([actor,input.project,input.itemId,input.action,input.key])).digest("hex");
    const previous=db.prepare("SELECT * FROM project_pr_requests WHERE idempotency_key=?").get(idempotency) as Row|undefined;
    if(previous) {
      if(previous.head_sha!==input.head||previous.fingerprint!==input.fingerprint||previous.merge_method!==input.method)
        throw new ProjectsActionError(409,"PR action changed. Reopen the confirmation.");
      return await reconcile(previous);
    }
    if(input.checkOnly)throw new ProjectsActionError(409,"PR action changed. Reopen the confirmation.");
    const c=context(db,home,input.project,input.itemId,now());
    const pending=db.prepare("SELECT * FROM project_pr_requests WHERE lower(repository)=lower(?) AND pr_number=? AND request_state IN ('checking','writing','pending','uncertain')").get(c.repository,c.number) as Row|undefined;
    if(pending&&active.includes((await reconcile(pending)).state))return result(pending);
    const p=await github.read(c.repository,c.number),control=view(c,p);
    if(!control.enabled||control.action!==input.action||control.head!==input.head||control.fingerprint!==input.fingerprint||
      input.action==="merge"&&!control.methods.includes(input.method!))throw new ProjectsActionError(409,control.reason||"PR action changed. Reopen the confirmation.");
    const row:Row={request_id:`ppr_${randomUUID().replaceAll("-","")}`,project:input.project,item_id:input.itemId,run_id:c.runId,actor_subject:actor,client_key:input.key,
      action:input.action,merge_method:input.method,repository:c.repository,pr_number:c.number,pr_id:p.id,head_sha:p.head,fingerprint:control.fingerprint,
      request_state:"checking",github_request_uuid:null,updated_at:now().toISOString()};
    db.exec("BEGIN IMMEDIATE");
    try {
      const final=context(db,home,input.project,input.itemId,now());
      if(final.runId!==c.runId||final.head!==c.head||final.url!==c.url)throw new ProjectsActionError(409,"PR action changed. Reopen the confirmation.");
      const other=db.prepare("SELECT * FROM project_pr_requests WHERE lower(repository)=lower(?) AND pr_number=? AND request_state IN ('checking','writing','pending','uncertain')").get(c.repository,c.number) as Row|undefined;
      if(other){db.exec("COMMIT");return result(other);}
      const completed=db.prepare("SELECT * FROM project_pr_requests WHERE lower(repository)=lower(?) AND pr_number=? AND action=? AND fingerprint=? AND request_state='applied' ORDER BY rowid DESC LIMIT 1").get(c.repository,c.number,input.action,input.fingerprint) as Row|undefined;
      if(completed){db.exec("COMMIT");return result(completed);}
      db.prepare(`INSERT INTO project_pr_requests(request_id,project,item_id,run_id,actor_subject,idempotency_key,client_key,action,merge_method,repository,pr_number,pr_id,head_sha,fingerprint,request_state,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'checking',?,?)`).run(row.request_id,row.project,row.item_id,row.run_id,actor,idempotency,input.key,row.action,row.merge_method,row.repository,row.pr_number,row.pr_id,row.head_sha,row.fingerprint,row.updated_at,row.updated_at);
      db.exec("COMMIT");
    } catch(error){if(db.isTransaction)db.exec("ROLLBACK");throw error;}
    let writing=false;
    try {
      context(db,home,input.project,input.itemId,now());
      set(row,"writing");
      writing=true;
      if(input.action==="ready")await github.ready(p.id,row.request_id);
      else {
        const accepted=await github.merge(c.repository,c.number,p.head,input.method!);
        if(accepted.uuid)db.prepare("UPDATE project_pr_requests SET github_request_uuid=? WHERE request_id=?").run(accepted.uuid,row.request_id);
        row.github_request_uuid=accepted.uuid;
        if(accepted.state==="failed")return set(row,"failed");
      }
      return set(row,await observed(row,await github.read(c.repository,c.number),github));
    } catch(error){return set(row,!writing?"conflict":error instanceof GitHubPrRejected?"failed":"uncertain");}
  } finally {db.close();}
}

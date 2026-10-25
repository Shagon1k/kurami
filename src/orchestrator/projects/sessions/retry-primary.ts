import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { primaryAgent, type IdleAgentSession } from "../../integrations/primary-agent.ts";
import { LATEST_ATTENTION_VALUE_SQL } from "../../runtime/run-projections.ts";
import { hasActivePrRequest } from "../../controls/pr-boundary.ts";

export type RetryProject = { repository:string; workspace:{worktree_root:string;canonical_repository:string} };
export type PrimaryRetryContext = { provider:string;threadId:string;turnId:string;headSha:string;session:string;sessionIdentity:IdleAgentSession;dispatchStartedAt?:string };
function requireRetry(value:unknown, message:string):asserts value { if(!value)throw new Error(`Retry refused: ${message}`); }
function command(bin:string,args:string[]):string {
  return execFileSync(bin,args,{encoding:"utf8",timeout:15000,env:{...process.env,GIT_OPTIONAL_LOCKS:"0"},stdio:["ignore","pipe","pipe"]}).trimEnd();
}
/** Read-only eligibility, repeated at enqueue and immediately before the single dispatch. */
export function inspectPrimaryRetry(database:DatabaseSync,runId:string,project:RetryProject,requestId:string|null=null):PrimaryRetryContext {
  const run=database.prepare(`SELECT r.state,r.owner_state,r.stop_reason,r.execution_mode,r.repository,
    rr.primary_agent_provider,rr.resource_state,rr.worktree_path,rr.branch_name,rr.tmux_session_name,rr.codex_thread_id,rr.previous_codex_thread_id,
    ${LATEST_ATTENTION_VALUE_SQL} AS attention FROM runs r JOIN run_resources rr USING(run_id) WHERE r.run_id=?`).get(runId);
  requireRetry(run&&run.state==="needs_attention"&&run.owner_state==="cli"&&run.stop_reason===null&&run.execution_mode==="live"&&
    run.resource_state==="provisioned"&&run.previous_codex_thread_id===null&&run.attention==="primary_attempt_failed", "run is not an owner-controlled failed primary attempt");
  requireRetry(project&&run.repository===project.repository&&typeof run.worktree_path==="string"&&typeof run.branch_name==="string"&&
    typeof run.tmux_session_name==="string"&&typeof run.codex_thread_id==="string","managed identity is incomplete");
  requireRetry(!hasActivePrRequest(database,runId),"a PR action is pending");
  requireRetry(!database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=? AND request_state IN ('pending','processing') AND (? IS NULL OR request_id<>?)`).get(runId,requestId,requestId),"another control is pending");
  requireRetry(!database.prepare(`SELECT 1 FROM run_codex_tasks WHERE run_id=? AND released_at IS NULL`).get(runId),"a technical worker owns this run");
  requireRetry(!database.prepare(`SELECT 1 FROM run_ai_reviews WHERE run_id=? AND review_state='running'`).get(runId),"a review is running");
  const provider=String(run.primary_agent_provider),agent=primaryAgent(provider);
  requireRetry(agent,"this provider has no manual retry adapter");
  const path=realpathSync(run.worktree_path),canonical=realpathSync(project.workspace.canonical_repository);
  requireRetry(path===run.worktree_path&&path.startsWith(resolve(project.workspace.worktree_root)+sep),"worktree path changed");
  const git=(...args:string[])=>command("git",["-C",path,...args]);
  const common=command("git",["-C",canonical,"rev-parse","--path-format=absolute","--git-dir"]);
  requireRetry(git("rev-parse","--path-format=absolute","--git-common-dir")===common&&git("branch","--show-current")===run.branch_name&&
    git("remote","get-url","origin")===command("git",["-C",canonical,"remote","get-url","origin"]),"repository or branch changed");
  requireRetry(git("remote","get-url","origin").replace(/\.git$/u,"")===`https://github.com/${project.repository}`&&
    git("rev-parse","--path-format=absolute","--git-dir").startsWith(common+"/worktrees/"),"wrong origin or unregistered worktree");
  const headSha=git("rev-parse","HEAD");
  const first=agent.readAttempt(run.codex_thread_id,path);
  requireRetry(first?.state==="failed","the latest native attempt is not failed");
  requireRetry(!database.prepare(`SELECT 1 FROM run_control_requests WHERE run_id=? AND action='retry'
    AND json_extract(retry_context_json,'$.threadId')=? AND json_extract(retry_context_json,'$.turnId')=?
    AND (json_extract(retry_context_json,'$.dispatchStartedAt') IS NOT NULL OR request_state IN ('pending','processing','applied'))
    AND (? IS NULL OR request_id<>?)`).get(runId,first.threadId,first.turnId,requestId,requestId),"this failed turn already has a retry");
  const sessionIdentity=agent.inspectIdleSession(run.tmux_session_name,path);
  const last=agent.readAttempt(run.codex_thread_id,path);
  requireRetry(last?.state==="failed"&&last.turnId===first.turnId,"native attempt changed during inspection");
  return {provider,threadId:first.threadId,turnId:first.turnId,headSha,session:run.tmux_session_name,sessionIdentity};
}

export function retryPrimary(database:DatabaseSync,runId:string,requestId:string,project:RetryProject):Record<string,unknown> {
  requireRetry(process.env.KURAMI_CONTROLLER_ACTION==="retry","only the managed controller may dispatch a retry");
  const request=database.prepare(`SELECT request_state,retry_context_json FROM run_control_requests WHERE request_id=? AND run_id=? AND action='retry'`).get(requestId,runId);
  requireRetry(request&&["pending","processing"].includes(String(request.request_state))&&typeof request.retry_context_json==="string","missing owner request");
  const expected=JSON.parse(request.retry_context_json) as PrimaryRetryContext;
  requireRetry(!expected.dispatchStartedAt,"dispatch was already attempted; inspect the same session through chat");
  const current=inspectPrimaryRetry(database,runId,project,requestId);
  requireRetry(JSON.stringify(current)===JSON.stringify(expected),"the queued session, turn, pane, or Git head changed");
  const claimed={...current,dispatchStartedAt:new Date().toISOString()};
  const claim=database.prepare(`UPDATE run_control_requests SET request_state='processing',retry_context_json=?
    WHERE request_id=? AND retry_context_json=? AND request_state IN ('pending','processing')`).run(JSON.stringify(claimed),requestId,request.retry_context_json);
  requireRetry(claim.changes===1,"retry claim changed");
  // The durable claim precedes input. A crash or ambiguous send must never replay it.
  database.exec("BEGIN IMMEDIATE");
  try {
    const checked=inspectPrimaryRetry(database,runId,project,requestId);
    requireRetry(JSON.stringify(checked)===JSON.stringify(current),"identity changed before dispatch");
    primaryAgent(current.provider)!.sendContinuation(current.sessionIdentity,
      "Continue only the unfinished work from the interrupted attempt. Inspect the existing work and prior tool results before continuing. Preserve the original scope, approval requirements, model, and configuration; do not repeat completed external actions.");
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES(?,'needs_attention','needs_attention','primary_retry_requested',?)`)
      .run(runId,JSON.stringify({requestId,threadId:current.threadId,sourceTurnId:current.turnId}));
    database.exec("COMMIT");
  } catch(error) {
    database.exec("ROLLBACK");
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json)
      SELECT run_id,state,state,'primary_retry_unconfirmed',? FROM runs WHERE run_id=? AND state='needs_attention' AND owner_state='cli' AND stop_reason IS NULL`)
      .run(JSON.stringify({requestId,threadId:current.threadId,sourceTurnId:current.turnId}),runId);
    throw error;
  }
  return {ok:true,action:"retry_requested",threadId:current.threadId,sourceTurnId:current.turnId,confirmed:false};
}

/** Reconcile observation only; never sends input or changes model/configuration. */
export function observePrimaryAttempt(database:DatabaseSync,runId:string):void {
  const run=database.prepare(`SELECT r.state,r.owner_state,r.stop_reason,r.execution_mode,rr.codex_thread_id,rr.worktree_path,
    rr.previous_codex_thread_id,rr.tmux_session_name,rr.primary_agent_provider FROM runs r JOIN run_resources rr USING(run_id) WHERE r.run_id=?`).get(runId);
  if(!run||run.owner_state!=="cli"||run.stop_reason!==null||run.execution_mode!=="live"||run.previous_codex_thread_id!==null||
    !["starting","running","parked_review","needs_attention"].includes(String(run.state))||
    typeof run.codex_thread_id!=="string"||typeof run.worktree_path!=="string"||!run.tmux_session_name)return;
  if(database.prepare("SELECT 1 FROM run_codex_tasks WHERE run_id=? AND released_at IS NULL").get(runId))return;
  const agent=primaryAgent(String(run.primary_agent_provider));
  if(!agent)return;
  const attempt=agent.readAttempt(run.codex_thread_id,run.worktree_path);
  if(!attempt)return;
  const latest=database.prepare(`SELECT h.reason,h.details_json FROM runs r JOIN run_state_history h USING(run_id) WHERE r.run_id=? AND h.to_state='needs_attention' AND h.reason=${LATEST_ATTENTION_VALUE_SQL} ORDER BY h.sequence DESC LIMIT 1`).get(runId);
  const details=latest?.details_json?JSON.parse(String(latest.details_json)):{};
  if(run.state === "needs_attention" && latest && !["primary_attempt_failed","primary_attempt_interrupted","primary_retry_requested","primary_retry_unconfirmed","primary_model_decision_required"].includes(String(latest.reason)))return;
  if(latest?.reason === "primary_model_decision_required" && (!details.sourceTurnId || attempt.turnId === details.sourceTurnId))return;
  if(attempt.state==="failed"||attempt.state==="interrupted"){
    const reason=attempt.state === "failed" ? "primary_attempt_failed" : "primary_attempt_interrupted";
    if(run.state==="needs_attention"&&details.threadId===attempt.threadId&&
      ((latest?.reason===reason&&details.turnId===attempt.turnId)||
       (["primary_retry_requested","primary_retry_unconfirmed"].includes(String(latest?.reason))&&details.sourceTurnId===attempt.turnId)))return;
    database.prepare("UPDATE runs SET state='needs_attention',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?").run(runId);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES(?,?,'needs_attention',?,?)`)
      .run(runId,run.state,reason,JSON.stringify(attempt));
    database.prepare(`INSERT OR IGNORE INTO run_control_events(event_id,run_id,event_kind,payload_json) VALUES(?,?,'attention_required',?)`)
      .run(`ce_${runId}_${attempt.state}_${attempt.turnId}`,runId,JSON.stringify({source:"agent",kind:reason,detail:attempt.errorMessage??(attempt.state === "interrupted" ? "The agent attempt was interrupted. Inspect the session through chat." : "The agent request failed. Work was preserved; retry manually."),threadId:attempt.threadId,turnId:attempt.turnId}));
  } else if(run.state==="needs_attention"&&["primary_attempt_failed","primary_attempt_interrupted","primary_retry_requested","primary_retry_unconfirmed","primary_model_decision_required"].includes(String(latest?.reason))&&
    attempt.threadId===details.threadId&&typeof (details.turnId??details.sourceTurnId)==="string"&&attempt.turnId!==(details.turnId??details.sourceTurnId)){
    database.prepare("UPDATE runs SET state='running',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE run_id=?").run(runId);
    database.prepare(`INSERT INTO run_state_history(run_id,from_state,to_state,reason,details_json) VALUES(?,'needs_attention','running','primary_retry_confirmed',?)`).run(runId,JSON.stringify({threadId:attempt.threadId,turnId:attempt.turnId}));
  }
}

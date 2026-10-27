import { parseOwnerDecisionSummary } from "../integrations/codex/owner-decision-summary.ts";
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { inspectReviewFixRetry } from "./sessions/prepare-review-fix-retry.ts";
import { originalReviewContext } from "./sessions/original-review-context.ts";
import { reviewFixPrompt } from "./sessions/prompts.ts";
import { redactSecretLikeText } from "../security/prompt-safety.ts";
import type { DecisionGitHub, DecisionPull, DecisionThread } from "./owner-decision-github.ts";
import type { ReviewFixContext } from "./sessions/session-types.ts";

export const decisionDigest = (value:unknown):string => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const requireDecision = (ok:unknown,reason:string):void => { if (!ok) throw new Error(`Owner decision refused: ${reason}`); };
const refusalMessages = {
  reply:"Decision refused: Reply as the configured OWNER in the exact blocker thread.",
  stale:"Decision refused: The card is stale; refresh and reconfirm the exact attempt.",
  merged:"Decision refused: The PR is closed or merged.",
  source:"Decision refused: The PR head or source changed; refresh and reconfirm.",
  preview:"Decision refused: Stop the active preview before reconfirming.",
  dirty:"Decision refused: Preserved local changes or a different head require inspection.",
  context:"Decision refused: The complete original review context is unknown or conflicting.",
  writer:"Decision refused: Another writer or control owns the working copy; wait for it to finish.",
  changed:"Decision refused: The owner replies changed while queued; reconfirm the current replies.",
  bound:"Decision refused: Complete evidence exceeds the supported bound; inspect the thread and original context.",
  unavailable:"Decision refused: Required evidence is unavailable; refresh the thread and inspect the refusal before reconfirming.",
};
export function decisionRefusal(error:unknown):string {
  const message=error instanceof Error ? error.message : "";
  return /no configured OWNER reply/u.test(message) ? refusalMessages.reply :
    /stale card|attempt changed/u.test(message) ? refusalMessages.stale :
    /closed or merged/u.test(message) ? refusalMessages.merged :
    /head changed|PR source changed|source changed|PR identity/u.test(message) ? refusalMessages.source :
    /preview lease/u.test(message) ? refusalMessages.preview :
    /local changes|dirty worktree|different head/u.test(message) ? refusalMessages.dirty :
    /original review context|original review snapshot|legacy round/u.test(message) ? refusalMessages.context :
    /writer|worker is active|control request|ownership/u.test(message) ? refusalMessages.writer :
    /replies changed|decision changed/u.test(message) ? refusalMessages.changed :
    /budget|bounded|64 KiB/u.test(message) ? refusalMessages.bound : refusalMessages.unavailable;
}
const activeDecisionRoundSql = `NOT EXISTS (SELECT 1 FROM run_owner_decisions d
  WHERE d.new_round_id=f.round_id AND d.aborted_at IS NOT NULL)`;
export function inspectOwnerDecision(database:DatabaseSync,runId:string,requestId:string|null=null) {
  const ready = inspectReviewFixRetry(database,runId,requestId);
  const r = ready.round, t = ready.task;
  const current=database.prepare(`SELECT r.completion_requested_at,r.archived_at,
    EXISTS(SELECT 1 FROM runs n WHERE n.project=r.project AND n.item_id=r.item_id AND n.rowid>r.rowid) AS superseded,
    EXISTS(SELECT 1 FROM project_events e WHERE e.project=r.project AND e.item_id=r.item_id AND e.processing_state='pending'
      AND e.from_status IS NOT e.to_status AND e.event_id<>r.trigger_event_id) AS transition_pending
    FROM runs r WHERE run_id=?`).get(runId)!;
  requireDecision(!current.completion_requested_at && !current.archived_at && !current.superseded && !current.transition_pending,
    "run is superseded, completing or awaiting a Project transition");
  const ci=database.prepare("SELECT repository,head_sha,pull_request_number,pull_request_url FROM run_ci_snapshots WHERE run_id=?").get(runId);
  requireDecision(ci?.repository === r.repository && ci.head_sha === r.source_head_sha && ci.pull_request_number === r.pull_request_number &&
    ci.pull_request_url === r.pull_request_url,"current PR source changed");
  requireDecision(!database.prepare(`SELECT 1 FROM run_codex_tasks n WHERE n.run_id=? AND n.rowid>(SELECT rowid FROM run_codex_tasks WHERE task_id=?)
    AND NOT EXISTS(SELECT 1 FROM run_owner_decisions d WHERE d.new_round_id=n.context_id AND d.aborted_at IS NOT NULL)`).get(runId,t.task_id!),
    "a newer worker supersedes this attempt");

  requireDecision(r.owner_decision_eligible === 1 || (runId === "r_e0670d883186bbcfc808" &&
    r.round_id === "rfr_6dab2380515646ff86d6c1dca95e6e81" && t.task_id === "ct_ef6d993bc6094f0382d43be9d53ac5cc" &&
    r.source_head_sha === "28d793e60c7161afbafe9a154e8c920e74b902c8"), "round predates this workflow");
  const context = originalReviewContext(database,String(r.round_id));
  reviewFixPrompt(ready.run,context);
  const contextDigest = decisionDigest(context);
  const blockerId = decisionDigest([runId,r.round_id,t.task_id,t.turn_id,r.source_head_sha,contextDigest]).slice(0,24);
  return {...ready,context,contextDigest,blockerId};
}
function safePublicationText(value:string):string {
  return redactSecretLikeText(value).replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+\S+)/giu,"[credential omitted]")
    .replace(/\b[\w.-]*(?:token|secret|password|credential)[\w.-]*\s*[:=]\s*(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/giu,"[credential omitted]")
    .replace(/(?:~\/|(?<![\w:/])\/(?!\/)|[A-Za-z]:\\)[^\s`"<>]+/gu,"[local path omitted]")
    .replace(/\b[a-z][a-z\d+.-]*:\/\/[^\s<>]+/giu,"[URL omitted]")
    .replace(/[@<>]/gu," ").replace(/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/gu,"");
}
export function blockerBody(ready:ReturnType<typeof inspectOwnerDecision>):string {
  let summary;
  try { summary=parseOwnerDecisionSummary(JSON.parse(String(ready.task.owner_decision_summary_json))); } catch { /* Never guess from clipped reports. */ }
  requireDecision(summary,"structured blocker summary unavailable");
  const clean=(text:string)=>{
    const safe=safePublicationText(text);
    requireDecision(safe === text && !/[`{}]|(?:ct_|rfr_|rq_|air_)[a-f0-9]{8,}/u.test(text),"structured blocker summary contains unsupported publication data");
    return safe.replace(/[*_\[\]\\#]/gu," ").replace(/\s+/gu," ").trim();
  };
  const body = `<!-- kurami-owner-decision:${ready.blockerId} -->\n## Decision needed: ${clean(summary!.title)}\n\n`+
    `${clean(summary!.problem)}\n\n${clean(summary!.request)}\n\n`+
    `Reply in this thread, then click Decision ready. The next fix will address the original review findings using your decision.\n`;
  requireDecision(Buffer.byteLength(body) <= 3000,"structured blocker summary exceeds publication budget");
  return body;
}
type Blocker = {blocker_id:string;run_id:string;round_id:string;task_id:string;turn_id:string;source_head_sha:string;context_digest:string;
  context_json:string;body:string;author_type:"Bot"|"User";author_id:string|null;thread_id:string|null;root_comment_id:number|null;thread_url:string|null;create_pending:number;delivery_error:string|null};
export function decisionBlocker(database:DatabaseSync,blockerId:string):Blocker|undefined {
  return database.prepare("SELECT * FROM run_owner_decision_blockers WHERE blocker_id=?").get(blockerId) as Blocker|undefined;
}
function exactThread(pull:DecisionPull,b:Blocker,authorId:string):DecisionThread|undefined {
  const marker = `<!-- kurami-owner-decision:${b.blocker_id} -->`;
  const matches = pull.threads.filter(t => t.comments.some(c => c.body.includes(marker)));
  requireDecision(matches.length <= 1,"duplicate blocker markers; inspect GitHub");
  if (!matches.length) { requireDecision(!b.thread_id,"recorded blocker missing; inspect GitHub"); return; }
  requireDecision(b.create_pending === 1 || b.thread_id,"unrecorded marker has no controller create provenance");
  const t = matches[0]!, root = t.comments[0]!;
  requireDecision(root.authorId === authorId && root.type === b.author_type && root.body === b.body &&
    (!b.author_id || b.author_id === authorId) && (!b.thread_id || b.thread_id === t.id && b.root_comment_id === root.id),
    "blocker author, body or external identity changed");
  return t;
}
/** Invoked in the applied controller delivery lane under the existing feedback lock. */
export function reconcileOwnerDecisionBlockers(database:DatabaseSync,projects:Record<string,{owner:string}>,github:DecisionGitHub):void {
  const candidates = database.prepare(`SELECT f.run_id FROM run_review_fix_rounds f JOIN runs r USING(run_id)
    WHERE r.state='needs_attention' AND f.round_state='needs_attention' AND f.failure_reason='review_fix_no_new_head'
      AND ${activeDecisionRoundSql} AND (f.owner_decision_eligible=1 OR (f.run_id='r_e0670d883186bbcfc808'
        AND f.round_id='rfr_6dab2380515646ff86d6c1dca95e6e81'))
      AND f.round_number=(SELECT MAX(n.round_number) FROM run_review_fix_rounds n WHERE n.run_id=f.run_id
        AND NOT EXISTS(SELECT 1 FROM run_owner_decisions d WHERE d.new_round_id=n.round_id AND d.aborted_at IS NOT NULL))
    ORDER BY f.rowid LIMIT 10`).all();
  for (const row of candidates) {
    const runId=String(row.run_id); let blockerId:string|undefined;
    try {
      const ready=inspectOwnerDecision(database,runId); blockerId=ready.blockerId;
      const body=decisionBlocker(database,blockerId)?.body ?? "";
      database.prepare(`INSERT OR IGNORE INTO run_owner_decision_blockers
        (blocker_id,run_id,round_id,task_id,turn_id,source_head_sha,context_json,context_digest,body) VALUES(?,?,?,?,?,?,?,?,?)`)
        .run(blockerId,runId,ready.round.round_id!,ready.task.task_id!,ready.task.turn_id!,ready.context.sourceHeadSha,
          JSON.stringify(ready.context),ready.contextDigest,body);
      let b=decisionBlocker(database,blockerId)!;
      if (!b.body) {
        requireDecision(!b.create_pending && !b.thread_id && !b.author_id,"empty blocker has publication provenance");
        const rendered=blockerBody(ready);
        database.prepare("UPDATE run_owner_decision_blockers SET body=? WHERE blocker_id=?").run(rendered,blockerId);
        b={...b,body:rendered};
      }
      const owner=projects[ready.run.project]?.owner;
      requireDecision(owner,"configured owner missing");
      const authorId=b.author_type === "User" ? github.identity(owner!) : github.botIdentity();
      requireDecision(b.author_type !== "User" || b.thread_id && b.root_comment_id && b.author_id === authorId,"legacy author requires an already recorded root");
      let pull=github.pull(ready.run.repository,ready.context.pullRequestNumber,ready.context.sourceHeadSha);
      let thread=exactThread(pull,b,authorId);
      if (!thread) {
        requireDecision(!b.create_pending,"delivery uncertain; awaiting discovery, no duplicate POST");
        // Autocommit this fence BEFORE the network mutation. An ambiguous create
        // can only be recovered by discovering its authenticated exact root.
        database.prepare("UPDATE run_owner_decision_blockers SET create_pending=1,author_id=? WHERE blocker_id=?").run(authorId,blockerId);
        try { github.create(pull,b.body); } catch { /* Discover even after ambiguous delivery. */ }
        pull=github.pull(ready.run.repository,ready.context.pullRequestNumber,ready.context.sourceHeadSha);
        thread=exactThread(pull,{...b,author_id:authorId,create_pending:1},authorId);
        requireDecision(thread,"delivery uncertain; awaiting discovery, no duplicate POST");
      }
      database.prepare(`UPDATE run_owner_decision_blockers SET author_id=?,thread_id=?,root_comment_id=?,thread_url=?,
        create_pending=0,delivery_error=NULL WHERE blocker_id=?`).run(authorId,thread!.id,thread!.comments[0]!.id,thread!.comments[0]!.url,blockerId);
    } catch(error) {
      // An error-only write also survives failures outside the delivery lock.
      if (blockerId) {
        const reason=error instanceof Error && /structured blocker summary/u.test(error.message) ? "blocker_summary_unavailable" : "blocker_delivery_pending";
        database.prepare("UPDATE run_owner_decision_blockers SET delivery_error=? WHERE blocker_id=?").run(reason,blockerId);
      }
    }
  }
}
export type OwnerDecisionSnapshot = {blockerId:string;roundId:string;taskId:string;turnId:string;head:string;contextDigest:string;
  threadId:string;rootCommentId:number;replies:{id:number;body:string;digest:string}[]};
export function readOwnerDecisionReplies(b:Blocker,owner:string,github:DecisionGitHub,repository:string,number:number) {
  const authorId=github.identity(owner);
  const pull=github.pull(repository,number,b.source_head_sha);
  const thread=exactThread(pull,b,b.author_type === "User" ? authorId : github.botIdentity());
  requireDecision(thread && !thread.resolved && !thread.outdated,"blocker thread resolved or outdated");
  const replies=thread!.comments.slice(1).filter(c => c.type === "User" && c.authorId === authorId &&
    c.login.toLowerCase() === owner.toLowerCase() && c.association === "OWNER").map(c => ({id:c.id,body:c.body,digest:decisionDigest(c.body)}));
  requireDecision(replies.length && replies.every(r => r.body.trim()),"no configured OWNER reply in the exact blocker thread");
  requireDecision(new Set(replies.map(r=>r.id)).size === replies.length,"duplicate reply IDs");
  return {thread:thread!,replies};
}
export function captureOwnerDecision(database:DatabaseSync,runId:string,owner:string,expected:string,github:DecisionGitHub,recordFeedback=true):OwnerDecisionSnapshot {
  try {
    const result=captureOwnerDecisionChecked(database,runId,owner,expected,github);
    if(recordFeedback)database.prepare("UPDATE run_owner_decision_blockers SET decision_error=NULL WHERE blocker_id=?").run(expected);
    return result;
  } catch(error) {
    if(recordFeedback)database.prepare("UPDATE run_owner_decision_blockers SET decision_error=? WHERE blocker_id=? AND run_id=?").run(decisionRefusal(error),expected,runId);
    throw error;
  }
}
function captureOwnerDecisionChecked(database:DatabaseSync,runId:string,owner:string,expected:string,github:DecisionGitHub):OwnerDecisionSnapshot {
  const prior=database.prepare(`SELECT d.request_id FROM run_owner_decisions d JOIN run_control_requests q USING(request_id)
    WHERE q.run_id=? AND d.blocker_id=? AND d.aborted_at IS NULL ORDER BY q.rowid DESC LIMIT 1`).get(runId,expected);
  const ready=inspectOwnerDecision(database,runId,prior ? String(prior.request_id) : null);
  requireDecision(ready.blockerId === expected,"stale card; refresh and reconfirm the exact attempt");
  const b=decisionBlocker(database,expected);
  requireDecision(b?.thread_id && b.root_comment_id && b.author_id && b.context_digest === ready.contextDigest,"blocker thread is not delivered");
  const {thread,replies}=readOwnerDecisionReplies(b!,owner,github,ready.run.repository,ready.context.pullRequestNumber);

  requireDecision(thread && !thread.resolved && !thread.outdated,"blocker thread resolved or outdated");
  const result={blockerId:expected,roundId:String(ready.round.round_id),taskId:String(ready.task.task_id),turnId:String(ready.task.turn_id),
    head:ready.context.sourceHeadSha,contextDigest:ready.contextDigest,threadId:thread!.id,rootCommentId:b!.root_comment_id!,replies};
  reviewFixPrompt(ready.run,{...ready.context,ownerDecision:result});
  return result;
}
/** Called only by the supported owner control route, inside its short transaction. */
export function storeOwnerDecision(database:DatabaseSync,runId:string,via:string,snapshot:OwnerDecisionSnapshot,apply:boolean,key?:string):Record<string,unknown> {
  const existing=database.prepare(`SELECT q.request_id,q.request_state,d.snapshot_digest FROM run_owner_decisions d
    JOIN run_control_requests q USING(request_id) WHERE q.run_id=? AND d.blocker_id=? AND d.aborted_at IS NULL ORDER BY q.rowid DESC LIMIT 1`)
    .get(runId,snapshot.blockerId);
  const ready=inspectOwnerDecision(database,runId,existing ? String(existing.request_id) : null);
  requireDecision(ready.blockerId === snapshot.blockerId && ready.contextDigest === snapshot.contextDigest,"attempt changed while capturing replies");
  if (existing) {
    requireDecision(existing.snapshot_digest === decisionDigest(snapshot),"queued replies changed; wait for refusal, then reconfirm");
    return {action:"existing",runId,requestId:existing.request_id,requestState:existing.request_state};
  }
  const requestId=`rq_${randomUUID().replaceAll("-","")}`;
  if (apply) {
    database.prepare(`INSERT INTO run_control_requests(request_id,run_id,action,requested_via,idempotency_key,review_profile,review_fix_all)
      VALUES(?,?,'review_fix',?,?,?,?)`).run(requestId,runId,via,key ?? `owner-decision:${requestId}`,ready.context.profile!,Number(ready.context.allReviews));
    database.prepare(`INSERT INTO run_owner_decisions(request_id,blocker_id,snapshot_json,snapshot_digest,new_round_id) VALUES(?,?,?,?,?)`)
      .run(requestId,snapshot.blockerId,JSON.stringify(snapshot),decisionDigest(snapshot),`rfr_${requestId.slice(3)}`);
  }
  return {action:apply ? "created" : "create",runId,requestId,requestState:"pending",requestedAction:"decision_ready"};
}
export function ownerDecisionAwaitingDispatch(database:DatabaseSync,runId:string,profile:string|null=null):boolean {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_owner_decisions'").get()) return false;
  return Boolean(database.prepare(`SELECT 1 FROM run_owner_decisions d JOIN run_control_requests q USING(request_id)
    WHERE q.run_id=? AND q.request_state IN ('pending','processing') AND d.aborted_at IS NULL
      AND (? IS NULL OR q.review_profile=? OR q.review_fix_all=1)`).get(runId,profile,profile));
}
export function ownerDecisionStatus(database:DatabaseSync,runId:string):string|null {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_owner_decisions'").get()) return null;
  const b=database.prepare(`SELECT blocker_id,delivery_error,decision_error,thread_url FROM run_owner_decision_blockers WHERE run_id=? ORDER BY rowid DESC LIMIT 1`).get(runId);
  const row=database.prepare(`SELECT q.request_state,q.result_json,r.state AS run_state,d.dispatch_started_at,d.aborted_at,f.round_state FROM run_owner_decisions d
    JOIN run_control_requests q USING(request_id) JOIN runs r ON r.run_id=q.run_id LEFT JOIN run_review_fix_rounds f ON f.round_id=d.new_round_id
    WHERE q.run_id=? AND (? IS NULL OR d.blocker_id=?) ORDER BY q.rowid DESC LIMIT 1`).get(runId,b?.blocker_id ?? null,b?.blocker_id ?? null);
  if (row?.dispatch_started_at && (["failed","rejected"].includes(String(row.request_state)) || row.run_state === "needs_attention"))
    return "Decision dispatch needs inspection; the worker result is uncertain. Cancel remains available.";
  if (row && (row.aborted_at || ["failed","rejected"].includes(String(row.request_state)))) {
    let reason:string=refusalMessages.unavailable;
    try {
      const result=JSON.parse(String(row.result_json));
      if(result?.action === "owner_decision_refused" && Object.values(refusalMessages).includes(result.reason))reason=result.reason;
    } catch { /* Missing historical results use the fixed safe refusal. */ }
    return reason+" Cancel remains available.";
  }
  if (row) {
    if (row.request_state !== "applied") return row.dispatch_started_at
      ? "Decision dispatch attempted; worker startup not yet confirmed."
      : "Decision ready queued; no worker dispatch confirmed.";
    return row.round_state === "succeeded" ? "Decision fix completed; CI and snapshotted thread reconciliation finished." :
      "Decision fix dispatched; waiting for its actual result.";
  }
  if (b?.decision_error) return String(b.decision_error);
  return b?.delivery_error === "blocker_summary_unavailable" ? "Owner decision summary unavailable: inspect the worker report and original review; no thread published or worker started." : b?.delivery_error ? "Owner decision thread delivery pending; check reviewer App permissions; no worker started." : b?.thread_url ?
    `Reply to the Kurami owner-decision review thread, then click Decision ready. ${b.thread_url}` :
    database.prepare(`SELECT 1 FROM runs r WHERE r.run_id=? AND r.state='needs_attention' AND
      (SELECT reason FROM run_state_history h WHERE h.run_id=r.run_id AND h.to_state='needs_attention'
        AND h.reason NOT IN ('review_fix_task_archived','preview_slot_released','preview_slot_leased') ORDER BY sequence DESC LIMIT 1)='review_fix_no_new_head'`).get(runId)
      ? "Owner decision unavailable until the exact released task and complete original review context are verified." : null;
}

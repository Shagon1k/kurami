import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { DatabaseSync } from "node:sqlite";
import type { ReviewFixContext } from "./session-types.ts";

/** Unknown legacy summaries are never inferred empty. The original applied
 * launch receipt can supply them only when every stored scope field agrees. */
export function originalReviewContext(database: DatabaseSync, roundId: string): ReviewFixContext {
  const r = database.prepare("SELECT * FROM run_review_fix_rounds WHERE round_id=?").get(roundId);
  if (!r) throw new Error("Original round is missing");
  const threads = JSON.parse(String(r.snapshot_json));
  const fail = () => { throw new Error("Unknown or conflicting original review context"); };
  let summaries: unknown;
  if (r.summary_findings_json === null) {
    const q = database.prepare("SELECT * FROM run_control_requests WHERE request_id=? AND action='review_fix' AND request_state='applied'").get(r.request_id!);
    const launch = JSON.parse(String(q?.result_json ?? "null")), fix = launch?.reviewFix;
    if (!(launch?.ok === true && launch.apply === true && launch.action === "review_fix_started" && launch.runId === r.run_id &&
      fix?.requestId === r.request_id && fix.roundId === r.round_id && fix.roundNumber === r.round_number &&
      fix.sourceHeadSha === r.source_head_sha && fix.pullRequestNumber === r.pull_request_number && fix.pullRequestUrl === r.pull_request_url &&
      fix.profile === r.review_profile && fix.allReviews === Boolean(r.review_fix_all) &&
      q?.review_profile === r.review_profile && q.review_fix_all === r.review_fix_all && isDeepStrictEqual(fix.threads, threads) &&
      Array.isArray(fix.summaryOnlyFindings))) fail();
    summaries = fix.summaryOnlyFindings;
  } else summaries = JSON.parse(String(r.summary_findings_json));
  if (!Array.isArray(threads) || !Array.isArray(summaries) || !threads.length && !summaries.length) fail();
  const rows = database.prepare("SELECT thread_id,root_comment_id,source_kind,path,line FROM run_review_fix_threads WHERE round_id=? ORDER BY thread_id").all(roundId);
  if (!isDeepStrictEqual(rows.map(r => ({...r})), threads.map((t: ReviewFixContext["threads"][number]) => ({
    thread_id:t.threadId,root_comment_id:t.rootCommentId,source_kind:t.sourceKind,path:t.path,line:t.line,
  })).sort((a: {thread_id:string},b: {thread_id:string}) => a.thread_id.localeCompare(b.thread_id)))) fail();
  for (const t of threads) if (typeof t.rootBody !== "string" || !t.rootBody.trim() || !Array.isArray(t.ownerReplies) ||
    t.ownerReplies.some((body:unknown) => typeof body !== "string")) fail();
  for (const f of summaries as ReviewFixContext["summaryOnlyFindings"]) if (typeof f.body !== "string" || !f.body.trim() || typeof f.title !== "string") fail();
  const context:ReviewFixContext = {requestId:String(r.request_id),roundId,roundNumber:Number(r.round_number),sourceHeadSha:String(r.source_head_sha),
    pullRequestNumber:Number(r.pull_request_number),pullRequestUrl:String(r.pull_request_url),threads,
    summaryOnlyFindings:summaries as ReviewFixContext["summaryOnlyFindings"],profile:r.review_profile as ReviewFixContext["profile"],allReviews:Boolean(r.review_fix_all)};
  if(database.prepare("SELECT 1 FROM sqlite_master WHERE name='run_owner_decisions'").get()) {
    const decision=database.prepare(`SELECT d.*,b.context_json,b.context_digest FROM run_owner_decisions d
      JOIN run_owner_decision_blockers b USING(blocker_id) WHERE d.request_id=?`).get(r.request_id!);
    if(decision) {
      const previous=JSON.parse(String(decision.context_json)) as ReviewFixContext;
      const snapshot=JSON.parse(String(decision.snapshot_json));
      const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
      if(decision.new_round_id !== roundId || !decision.dispatch_started_at || snapshot.head !== context.sourceHeadSha ||
        digest(snapshot) !== decision.snapshot_digest || digest(previous) !== decision.context_digest ||
        !isDeepStrictEqual(previous.threads,threads) || !isDeepStrictEqual(previous.summaryOnlyFindings,summaries)) fail();
      // The previous blocker saved the entire original input. Retain its owner
      // decisions too when a later completed no-edit attempt needs clarification.
      context.priorOwnerDecisions=[...(previous.priorOwnerDecisions ?? []),snapshot];
    }
  }
  return context;
}

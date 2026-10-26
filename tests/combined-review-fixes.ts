// Child fixture: KURAMI_HOME and GitHub are isolated before importing session code.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { loadReviewFixContext, claimReviewFixSession } from "../src/orchestrator/projects/sessions/session-start.ts";
import type { ProjectConfig, SessionRun, StartPlan } from "../src/orchestrator/projects/sessions/session-types.ts";
import { reviewFixPrompt } from "../src/orchestrator/projects/sessions/prompts.ts";
import { readReviewEvidence } from "../src/orchestrator/projects/reviews/read-model.ts";

const db = new DatabaseSync(resolve(process.env.KURAMI_HOME!, "state/orchestrator.db"));
try {
  const head = "a".repeat(40), oldHead = "b".repeat(40);
  const reviews = db.prepare("SELECT review_id,review_profile FROM run_ai_reviews WHERE review_state='ready'").all();
  const general = String(reviews.find(row => row.review_profile === "general")!.review_id);
  const clarity = String(reviews.find(row => row.review_profile === "clarity")!.review_id);
  const spec = String(reviews.find(row => row.review_profile === "spec")!.review_id);
  const thread = (id: string, reviewId: string, sha = head, resolved = false, author = "kurami-ai[bot]") => ({
    id, path: "src/example.ts", line: 3, isResolved: resolved, isOutdated: false,
    comments: { nodes: [{ databaseId: id === "general" ? 1 : 2, author: { login: author },
      body: `Finding\n<!-- kurami-ai-finding:${reviewId}:1;head=${sha} -->` }], pageInfo: {hasNextPage:false} },
  });
  const summary = (reviewId: string) => {
    const findings = [1, 2].map(number => ({findingNumber:number,severity:"suggestion",confidence:"high",title:`Finding ${number}`,body:"Preserve behavior.",path:"src/example.ts",line:3}));
    // The summary uses the published review contract; finding numbers follow its order.
    const data = Buffer.from(JSON.stringify(findings)).toString("base64url");
    return {commit_id:head,body:`<!-- kurami-ai-summary-findings:${reviewId};head=${head};data=${data} -->`};
  };
  globalThis.fetch = async input => {
    const url = String(input);
    if (url.endsWith("/access_tokens")) return Response.json({token:"synthetic-app-token",expires_at:new Date(Date.now()+3600000).toISOString()});
    if (url.endsWith("/graphql")) return Response.json({data:{repository:{pullRequest:{reviewThreads:{nodes:[
      thread("general",general),thread("clarity",clarity),thread("spec",spec),thread("old",general,oldHead),
      thread("resolved",clarity,head,true),thread("owner","",head,false,"Example"),
    ],pageInfo:{hasNextPage:false}}}}}});
    if (url.endsWith("/reviews/11")) return Response.json(summary(clarity));
    if (url.endsWith("/reviews/22")) return Response.json(summary(general));
    if (url.endsWith("/reviews/33")) return Response.json(summary(spec));
    throw new Error(`Unexpected fixture request ${url}`);
  };
  const run = db.prepare("SELECT r.*,r.state AS run_state,rr.* FROM runs r JOIN run_resources rr USING(run_id) WHERE run_id='r_profile'").get() as SessionRun;
  const project = {owner:"Example"} as ProjectConfig;
  db.prepare("UPDATE run_ai_reviews SET head_sha=? WHERE review_profile='general'").run(oldHead);
  const clarityOnly = await loadReviewFixContext(db,run,project,process.argv[2]!);
  assert.deepEqual(clarityOnly.threads.map(row=>row.threadId),['clarity','spec','owner'],'old General findings do not enter the combined snapshot');
  assert.deepEqual(clarityOnly.summaryOnlyFindings.map(row=>row.reviewId),[clarity,spec]);
  db.prepare("UPDATE run_ai_reviews SET head_sha=? WHERE review_profile='general'").run(head);
  const fix = await loadReviewFixContext(db,run,project,process.argv[2]!);
  assert.equal(fix.allReviews,true);
  assert.deepEqual(fix.threads.map(row=>row.threadId),["general","clarity","spec","owner"]);
  assert.deepEqual(fix.summaryOnlyFindings.map(row=>[row.reviewId,row.findingNumber]),[[clarity,2],[spec,2],[general,2]],"inline findings are not repeated from summaries");
  assert.equal(fix.sourceHeadSha,head);
  const prompt=reviewFixPrompt({...run,issue_url:null},fix);
  assert.match(prompt,/one combined fix task/);assert.match(prompt,/General, Clarity and Spec/);assert.match(prompt,/Deduplicate overlapping findings/);
  assert.match(prompt,/Fix exactly these 7 review item/);
  claimReviewFixSession(db,run,{tmuxSessionName:"cx-combined",reviewFix:fix} as StartPlan,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM run_review_fix_rounds").get()?.n,1);
  assert.equal(db.prepare("SELECT review_fix_all FROM run_review_fix_rounds").get()?.review_fix_all,1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM run_review_fix_threads").get()?.n,4);
  assert.equal(readReviewEvidence(db,run.run_id,"general",head).fix?.state,"running");
  assert.equal(readReviewEvidence(db,run.run_id,"clarity",head).fix?.state,"running");
  assert.equal(readReviewEvidence(db,run.run_id,"spec",head).fix?.state,"running");
  await assert.rejects(loadReviewFixContext(db,run,project,process.argv[2]!),/already active/);
} finally { db.close(); }

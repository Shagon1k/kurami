import type { DatabaseSync } from "node:sqlite";
import { withFeedbackLock } from "../lifecycle-feedback-production.ts";
import { ownerDecisionGitHub, type DecisionGitHub } from "../owner-decision-github.ts";
import { captureOwnerDecision, decisionBlocker, decisionDigest, decisionRefusal, inspectOwnerDecision, readOwnerDecisionReplies, type OwnerDecisionSnapshot } from "../owner-decision.ts";
import { loadOwnerGitHubTokenFromFile } from "../../integrations/github/app-auth.ts";
import { ownerSourceEffects, type SourceEffects } from "../worktrees/refresh-source.ts";
import { prepareReviewFixRetry } from "./prepare-review-fix-retry.ts";
import { startSession, validateAndPlan } from "./session-start.ts";
import { appendHistory, git, loadRun, orchestratorHome, tmuxSessionExists } from "./session-shared.ts";
import type { OrchestratorConfig, ProjectsRegistry } from "./session-types.ts";

/** A queued decision creates one fresh round from the complete original scope.
 * Dispatch uncertainty stays claimed. A proven predispatch abort is released
 * atomically so another controller cycle cannot strand its own request. */
export async function startOwnerDecisionFix(database:DatabaseSync,runId:string,registry:ProjectsRegistry,config:OrchestratorConfig,
  requestId:string,apply:boolean,supplied?:{github:DecisionGitHub;source:SourceEffects;cleanup:typeof import("./manager.ts").cleanupReviewFixSession}) {
  return withFeedbackLock(orchestratorHome,async () => {
    try {
      if (!apply || config.mode !== "live") throw new Error("Owner decision dispatch requires applied live controller mode");
      const receipt=database.prepare(`SELECT d.*,q.request_state,q.run_id FROM run_owner_decisions d JOIN run_control_requests q USING(request_id) WHERE request_id=?`).get(requestId);
      if (!receipt || receipt.run_id !== runId || receipt.request_state !== "pending" || receipt.claimed_at) throw new Error("Decision request already claimed or changed");
      const snapshot=JSON.parse(String(receipt.snapshot_json)) as OwnerDecisionSnapshot;
      const original=inspectOwnerDecision(database,runId,requestId), project=registry.projects[original.run.project]!;
      const github=supplied?.github ?? ownerDecisionGitHub(orchestratorHome);
      const source=supplied?.source ?? ownerSourceEffects(await loadOwnerGitHubTokenFromFile(orchestratorHome));
      const fresh=captureOwnerDecision(database,runId,project.owner,snapshot.blockerId,github);
      if (decisionDigest(fresh) !== receipt.snapshot_digest) throw new Error("Queued decision replies changed; reconfirm before dispatch");
      database.exec("BEGIN IMMEDIATE");
      try {
        if (inspectOwnerDecision(database,runId,requestId).blockerId !== snapshot.blockerId) throw new Error("Decision attempt changed before claim");
        if (database.prepare("UPDATE run_control_requests SET request_state='processing' WHERE request_id=? AND request_state='pending'").run(requestId).changes !== 1)
          throw new Error("Decision already claimed");
        database.prepare("UPDATE run_owner_decisions SET claimed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=?").run(requestId);
        database.exec("COMMIT");
      } catch(error) { database.exec("ROLLBACK"); throw error; }
      let primary:string|null=null;
      try {
        const capture = async () => original.context;
        const cleanup = supplied?.cleanup ?? (await import("./manager.ts")).cleanupReviewFixSession;
        await prepareReviewFixRetry(database,runId,registry,true,{source,capture,cleanup},requestId);
        const run=loadRun(database,runId); primary=run.codex_thread_id;
        const next=Number(database.prepare("SELECT MAX(round_number) AS n FROM run_review_fix_rounds WHERE run_id=?").get(runId)!.n)+1;
        const context={...original.context,requestId,roundId:String(receipt.new_round_id),roundNumber:next,ownerDecision:snapshot};
        const plan=await validateAndPlan(run,registry,null,context);
        plan.tmuxSessionName=`cx-decision-${requestId.slice(3)}`;
        await startSession(database,run,plan,config,true,undefined,() => {
          const b=decisionBlocker(database,snapshot.blockerId)!;
          const replies=readOwnerDecisionReplies(b,project.owner,github,run.repository,context.pullRequestNumber).replies;
          if (decisionDigest({...snapshot,replies}) !== receipt.snapshot_digest) throw new Error("Queued owner decision changed; reconfirm");
          source.noWriter(run.worktree_path!);
          const pr=source.pull(run.repository,context.pullRequestNumber);
          if (pr.state !== "open" || pr.merged || pr.number !== context.pullRequestNumber || pr.html_url !== context.pullRequestUrl ||
            pr.head.sha !== snapshot.head || pr.head.ref !== run.branch_name || pr.head.repo.full_name !== run.repository ||
            pr.base.repo.full_name !== run.repository || pr.base.ref !== project.workspace.base_branch ||
            source.remoteHead(run.repository,run.branch_name!) !== snapshot.head ||
            git(run.worktree_path!,["rev-parse","HEAD"]) !== snapshot.head || git(run.worktree_path!,["status","--porcelain","--untracked-files=all"]))
            throw new Error("Decision source changed before dispatch");
          database.exec("BEGIN IMMEDIATE");
          try {
            const mapped=loadRun(database,runId);
            if (mapped.run_state !== "parked_review" || mapped.owner_state !== "cli" || mapped.stop_reason ||
              mapped.tmux_session_name !== plan.tmuxSessionName || mapped.codex_thread_id !== null || mapped.previous_codex_thread_id !== primary ||
              mapped.worktree_path !== run.worktree_path || mapped.branch_name !== run.branch_name ||
              database.prepare("SELECT 1 FROM run_control_requests WHERE run_id=? AND request_id<>? AND request_state IN ('pending','processing')").get(runId,requestId) ||
              database.prepare(`SELECT 1 FROM preview_leases p JOIN run_resources rr USING(run_id) WHERE rr.worktree_path=? AND p.state<>'released'`).get(run.worktree_path!))
              throw new Error("Decision ownership changed before dispatch");
            if(database.prepare(`UPDATE run_owner_decisions SET dispatch_started_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
              WHERE request_id=? AND dispatch_started_at IS NULL AND aborted_at IS NULL AND EXISTS
                (SELECT 1 FROM run_control_requests WHERE request_id=? AND request_state='processing')`).run(requestId,requestId).changes !== 1)
              throw new Error("Decision dispatch already attempted or cancelled");
            database.exec("COMMIT");
          } catch(error) { database.exec("ROLLBACK"); throw error; }
        });
        return {ok:true,action:"owner_decision_dispatched",runId,requestId,roundId:context.roundId};
      } catch(error) {
        database.exec("BEGIN IMMEDIATE");
        try {
          const d=database.prepare("SELECT dispatch_started_at FROM run_owner_decisions WHERE request_id=?").get(requestId)!;
          const task=database.prepare("SELECT * FROM run_codex_tasks WHERE run_id=? AND context_id=? ORDER BY rowid DESC LIMIT 1").get(runId,receipt.new_round_id!);
          const current=loadRun(database,runId);
          if (!d.dispatch_started_at && current.worktree_path === original.run.worktree_path && current.branch_name === original.run.branch_name &&
              (!primary || (current.codex_thread_id === null || current.codex_thread_id === primary) &&
                (current.previous_codex_thread_id === null || current.previous_codex_thread_id === primary)) &&
              (!task || task.worktree_path === original.run.worktree_path && task.thread_id === null && task.turn_id === null &&
              !tmuxSessionExists(String(task.session_name))) && current.owner_state !== "remote" &&
              (current.tmux_session_name === null || current.tmux_session_name === `cx-decision-${requestId.slice(3)}`)) {
            if (task) database.prepare(`UPDATE run_codex_tasks SET stopped_at=COALESCE(stopped_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              released_at=COALESCE(released_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')),failure_code='protocol_launch_failed' WHERE task_id=?`).run(task.task_id!);
            if (primary) database.prepare("UPDATE run_resources SET tmux_session_name=NULL,codex_thread_id=?,previous_codex_thread_id=NULL WHERE run_id=?").run(primary,runId);
            database.prepare("UPDATE runs SET state='needs_attention',owner_state='none' WHERE run_id=? AND stop_reason IS NULL").run(runId);
            database.prepare("UPDATE run_owner_decisions SET aborted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=?").run(requestId);
            database.prepare("UPDATE run_control_requests SET request_state='failed',result_json=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=? AND request_state IN ('pending','processing')")
              .run(JSON.stringify({action:"owner_decision_refused",reason:decisionRefusal(error)}),requestId);
            appendHistory(database,runId,current.run_state,"needs_attention","review_fix_no_new_head",{roundId:snapshot.roundId,decisionRequestId:requestId,predispatchAborted:true});
          }
          database.exec("COMMIT");
        } catch(recordError) { database.exec("ROLLBACK"); throw recordError; }
        throw error;
      }
    } catch(error) {
      // Only the holder of the delivery/dispatch lane may prove a preclaim
      // refusal. A competing controller's lock timeout leaves this request alone.
      if(apply) {
        database.exec("BEGIN IMMEDIATE");
        try {
          const d=database.prepare("SELECT * FROM run_owner_decisions WHERE request_id=?").get(requestId);
          if(d && d.claimed_at === null && d.dispatch_started_at === null) {
            database.prepare("UPDATE run_owner_decisions SET aborted_at=COALESCE(aborted_at,strftime('%Y-%m-%dT%H:%M:%fZ','now')) WHERE request_id=?").run(requestId);
            database.prepare("UPDATE run_control_requests SET request_state='failed',result_json=?,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE request_id=? AND request_state='pending'")
              .run(JSON.stringify({action:"owner_decision_refused",reason:decisionRefusal(error)}),requestId);
          }
          database.exec("COMMIT");
        } catch(recordError) { database.exec("ROLLBACK");throw recordError; }
      }
      throw error;
    }
  });
}

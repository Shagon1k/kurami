import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { loadOwnerGitHubTokenFromFile } from "../integrations/github/app-auth.ts";
import { lifecycleFeedbackKey, reconcileLifecycleFeedback, LifecycleGitHubError,
  type FeedbackDelivery, type FeedbackStore, type IssueEndpoint, type LifecycleComment,
  type LifecycleGitHub, type LifecycleSnapshot, type FeedbackResult } from "./lifecycle-feedback.ts";

import { reconcileProgressCards } from "../runtime/reconcile-progress.ts";
import type { OrchestratorConfig } from "../runtime/controller-types.ts";

// Migration-added event kinds and the merge observer audit are explicit new
// triggers, not a time-based licence to backfill historical terminal attempts.
const eligibleFeedbackRuns = `SELECT r.*,rr.resource_state FROM runs r
  LEFT JOIN run_resources rr USING(run_id)
  WHERE r.execution_mode='live' AND (
    EXISTS (SELECT 1 FROM github_lifecycle_snapshots s
      WHERE json_extract(s.snapshot_json,'$.runId')=r.run_id)
    OR (NOT EXISTS (SELECT 1 FROM runs newer WHERE newer.project=r.project
        AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      AND (r.state NOT IN ('rejected','cancelled','archived')
        OR EXISTS (SELECT 1 FROM run_state_history h WHERE h.run_id=r.run_id
          AND h.reason='merged_delivery_completion_requested')
        OR EXISTS (SELECT 1 FROM project_events e WHERE e.project=r.project
          AND e.item_id=r.item_id AND e.event_kind='issue_state'
          AND e.rowid>(SELECT rowid FROM project_events WHERE event_id=r.trigger_event_id))))
  ) ORDER BY r.rowid`;

type Project = { owner: string; repository: string; workspace: { base_branch: string } };
type RestIssue = { url: string; state: "open" | "closed"; pull_request?: unknown };
type RestComment = { id: number; issue_url: string; user: { id: number }; body: string };
type RestPr = { number: number; url: string; merged: boolean; merged_at: string | null;
  merge_commit_sha: string | null; head: { sha: string }; base: { ref: string; repo: { full_name: string } } };
export type GitHubRequest = (method: string, endpoint: string, body?: string) => unknown;

function endpointFromUrl(value: string): IssueEndpoint {
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)$/u.exec(value);
  if (!match) throw new Error("identity_mismatch");
  return { repository: match[1]!, issueNumber: Number(match[2]) };
}
function comment(value: unknown): LifecycleComment {
  const c = value as RestComment;
  return { id: c.id, endpoint: endpointFromUrl(c.issue_url), authorId: c.user.id, body: c.body };
}
export function githubFeedbackAdapter(request: GitHubRequest): LifecycleGitHub {
  const path = (e: IssueEndpoint) => `repos/${e.repository}/issues/${e.issueNumber}`;
  return {
    async authenticatedAuthorId() { return (request("GET", "user") as { id: number }).id; },
    async issue(e) { const i = request("GET", path(e)) as RestIssue;
      return { ...endpointFromUrl(i.url), state: i.state, isPullRequest: !!i.pull_request }; },
    async comments(e) {
      const result: LifecycleComment[] = [];
      // gh REST pages are requested individually; an error never becomes an empty page.
      for (let page = 1; page <= 1000; page++) {
        const values = request("GET", `${path(e)}/comments?per_page=100&page=${page}`);
        if (!Array.isArray(values)) throw new Error("invalid_comment_page");
        result.push(...values.map(comment));
        if (values.length < 100) return result;
      }
      throw new Error("comment_pagination_limit");
    },
    async create(e, body) { return comment(request("POST", `${path(e)}/comments`, body)); },
    async update(e, id, body) { return comment(request("PATCH", `repos/${e.repository}/issues/comments/${id}`, body)); },
  };
}

/** Existing Linux flock convention, with a bounded wait. Parent fd keeps the
 * shared open-file-description lock alive after flock exits. No DB transaction
 * spans network IO. One global feedback lane also fences snapshot revisions. */
export async function withFeedbackLock<T>(home: string, work: () => Promise<T>): Promise<T> {
  mkdirSync(resolve(home, "state"), { recursive: true, mode: 0o700 });
  const fd = openSync(resolve(home, "state/github-lifecycle-feedback.lock"), "a", 0o600);
  try {
    execFileSync("flock", ["-w", "2", "3"], { stdio: ["ignore", "pipe", "pipe", fd], timeout: 3_000 });
    return await work();
  } finally { closeSync(fd); }
}

export function feedbackStore(database: DatabaseSync): FeedbackStore {
  return {
    // The whole production batch is under withFeedbackLock, including snapshots.
    async withLock(_key, work) { return work(); },
    async load(key) {
      const r = database.prepare("SELECT * FROM github_lifecycle_feedback WHERE delivery_key=?").get(key);
      return r ? { revision: Number(r.revision), commentId: r.comment_id === null ? null : Number(r.comment_id),
        deliveredDigest: r.delivered_digest as string | null, createPending: r.create_pending === 1,
        error: r.delivery_error as FeedbackDelivery["error"] } : null;
    },
    async save(key, d) {
      database.prepare(`INSERT INTO github_lifecycle_feedback VALUES(?,?,?,?,?,?)
        ON CONFLICT(delivery_key) DO UPDATE SET revision=excluded.revision,
        comment_id=excluded.comment_id, delivered_digest=excluded.delivered_digest,
        create_pending=excluded.create_pending, delivery_error=excluded.delivery_error`)
        .run(key, d.revision, d.commentId, d.deliveredDigest, Number(d.createPending), d.error);
    },
  };
}

/** Safe even after lock acquisition fails: never replace a concurrent delivery fence. */
export function recordFeedbackError(database: DatabaseSync, key: string, error: FeedbackDelivery["error"]): void {
  database.prepare(`INSERT INTO github_lifecycle_feedback
    (delivery_key,revision,comment_id,delivered_digest,create_pending,delivery_error)
    VALUES(?,0,NULL,NULL,0,?) ON CONFLICT(delivery_key)
    DO UPDATE SET delivery_error=excluded.delivery_error`).run(key, error);
}

/** Revision is committed only when semantic facts change, never on a heartbeat. */
export function commitFeedbackSnapshot(database: DatabaseSync, snapshot: LifecycleSnapshot): LifecycleSnapshot {
  const key = lifecycleFeedbackKey(snapshot);
  const json = JSON.stringify({ ...snapshot, revision: 0 });
  const old = database.prepare("SELECT revision,snapshot_json FROM github_lifecycle_snapshots WHERE delivery_key=?").get(key);
  const revision = old ? Number(old.revision) + Number(old.snapshot_json !== json) : 1;
  database.prepare(`INSERT INTO github_lifecycle_snapshots VALUES(?,?,?) ON CONFLICT(delivery_key)
    DO UPDATE SET revision=excluded.revision,snapshot_json=excluded.snapshot_json`).run(key, revision, json);
  return { ...snapshot, revision };
}

export async function reconcileCommittedTicketFeedback(
  database: DatabaseSync, projects: Record<string, Project>, github: LifecycleGitHub,
  request: GitHubRequest, store: FeedbackStore,
): Promise<Array<FeedbackResult & { runId: string }>> {
  const results: Array<FeedbackResult & { runId: string }> = [];
  const runs = database.prepare(eligibleFeedbackRuns).all();
  for (const r of runs) {
    const project = projects[String(r.project)];
    if (!project || project.repository !== r.repository) continue;
    try {
      const endpoint = { repository: String(r.repository), issueNumber: Number(r.issue_number) };
      const item = database.prepare("SELECT status,present,issue_state FROM project_items WHERE project=? AND item_id=?").get(r.project!, r.item_id!);
      const ci = database.prepare("SELECT * FROM run_ci_snapshots WHERE run_id=?").get(r.run_id!);
      const history = database.prepare(`SELECT reason,details_json FROM run_state_history WHERE run_id=?
        ORDER BY sequence DESC LIMIT 1`).get(r.run_id!);
      const released = database.prepare(`SELECT details_json FROM run_state_history WHERE run_id=?
        AND reason='merged_worktree_release_completed' ORDER BY sequence DESC LIMIT 1`).get(r.run_id!);
      const release = released?.details_json ? JSON.parse(String(released.details_json)) as { headSha?: string; mergedPullRequestNumber?: number } : null;
      const number = ci?.pull_request_number ?? release?.mergedPullRequestNumber;
      const head = ci?.head_sha ?? release?.headSha;
      const expectedPr = number && head ? { number: Number(number), headSha: String(head), base: project.workspace.base_branch } : null;
      const newer = database.prepare(`SELECT run_id FROM runs WHERE project=? AND item_id=?
        AND rowid>(SELECT rowid FROM runs WHERE run_id=?) ORDER BY rowid DESC LIMIT 1`).get(r.project!, r.item_id!, r.run_id!);
      const events = database.prepare(`SELECT event_id,event_kind,from_status,to_status,processing_state,processing_note,payload_json
        FROM project_events WHERE project=? AND item_id=? ORDER BY rowid DESC LIMIT 20`).all(r.project!, r.item_id!);
      const eventSummary = events.reverse().map(e => {
        const observation = JSON.parse(String(e.payload_json)) as { previousIssueState?: string; issueState?: string };
        const transition = e.event_kind === "issue_state"
          ? `issue ${observation.previousIssueState ?? "unknown"} -> ${observation.issueState ?? "unknown"}`
          : `${e.from_status ?? "none"} -> ${e.to_status ?? "none"}`;
        const note = e.event_kind === "issue_state" ? "observation only; no start/cancel/board move"
          : e.processing_note === "Rejected by WIP gate" ? "WIP limit; activation refused"
          : e.processing_note === "Rejected by resource guard" ? "Resource guard; activation refused"
          : e.processing_state === "ignored" ? "outside applicable transition or no eligible run"
          : e.processing_state === "failed" ? "transition refused; inspect admission result"
          : e.processing_state === "pending" ? "awaiting admission"
          : "admission processed; actual run state reported separately";
        return `${e.event_id} ${e.event_kind} ${transition}: ${e.processing_state} (${note})`;
      }).join("; ");
      const requests = database.prepare(`SELECT request_id,action,request_state,result_json FROM run_control_requests WHERE run_id=?
        ORDER BY rowid DESC LIMIT 20`).all(r.run_id!);
      const q = requests[0];
      const requestSummary = requests.map(q => `${q.request_id} ${q.action}: ${q.request_state}`).join("; ");
      const requestResult = q?.result_json ? JSON.parse(String(q.result_json)) as { reason?: unknown } : null;
      const requestReason = typeof requestResult?.reason === "string" && ["cancellation_requested", "run_terminal",
        "run_needs_attention", "codex_thread_not_ready", "remote_successor_not_safe",
        "ci_repair_cleanup_pending", "preview_not_configured", "run_not_review_ready"].includes(requestResult.reason)
        ? requestResult.reason : "see actual run state; no request completion inferred";
      const accepted = database.prepare(`SELECT 1 FROM run_state_history WHERE run_id=?
        AND reason='merged_task_accepted'`).get(r.run_id!);
      // Local facts wake a delivered terminal run; poll timestamps do not.
      const localFactsDigest = createHash("sha256").update(JSON.stringify({
        owner: project.owner, endpoint, base: project.workspace.base_branch,
        state: r.state, stopReason: r.stop_reason, resources: r.resource_state,
        item, history, release, expectedPr, newer, events, requests, accepted: !!accepted,
      })).digest("hex");
      if (["rejected", "cancelled", "archived"].includes(String(r.state))) {
        const key = lifecycleFeedbackKey({ runId: String(r.run_id), endpoint });
        const previous = database.prepare("SELECT revision,snapshot_json FROM github_lifecycle_snapshots WHERE delivery_key=?").get(key);
        const delivery = await store.load(key);
        if (previous && delivery && delivery.error === null && !delivery.createPending &&
          delivery.commentId !== null && delivery.deliveredDigest !== null &&
          delivery.revision === Number(previous.revision) &&
          (JSON.parse(String(previous.snapshot_json)) as LifecycleSnapshot).localFactsDigest === localFactsDigest)
          continue;
      }
      const owner = request("GET", `users/${project.owner}`) as { id: number };
      const liveIssue = await github.issue(endpoint);
      let merge: LifecycleSnapshot["merge"] = null;
      if (expectedPr) {
        const pr = request("GET", `repos/${endpoint.repository}/pulls/${expectedPr.number}`) as RestPr;
        if (pr.url !== `https://api.github.com/repos/${endpoint.repository}/pulls/${expectedPr.number}` ||
          pr.number !== expectedPr.number || pr.base.repo.full_name !== endpoint.repository)
          throw new Error("identity_mismatch");
        if (pr.merged && pr.merged_at && pr.merge_commit_sha) merge = {
          repository: pr.base.repo.full_name, number: pr.number, headSha: pr.head.sha,
          base: pr.base.ref, mergeCommitSha: pr.merge_commit_sha, mergedAt: pr.merged_at,
        };
      }
      const snapshot = commitFeedbackSnapshot(database, {
        runId: String(r.run_id), revision: 0, localFactsDigest, endpoint, runState: String(r.state),
        cancelled: r.stop_reason === "cancelled" || r.state === "cancelled", newerRunId: newer ? String(newer.run_id) : null,
        projectState: item?.present === 1 ? String(item.status ?? "unknown") : null,
        cleanup: r.resource_state === "released" ? "done" : r.state === "needs_attention" ? "blocked" : "pending",
        reason: `Live issue ${liveIssue.state}; ${accepted ? `task accepted by verified merge; resource cleanup ${released ? "released" : r.state === "needs_attention" ? "blocked; work preserved" : "pending"}` : released ? "merged delivery resources released (not ticket acceptance)" : history?.reason === "worktree_release_blocked" ? "resource cleanup blocked; preserved work" : "committed lifecycle state"}. Recent board outcomes: ${eventSummary || "none"}. Recent explicit requests: ${requestSummary || "none"}`,
        expectedPr, merge,
        request: q ? { id: String(q.request_id), action: String(q.action),
          outcome: q.request_state === "applied" ? "applied" : ["pending", "processing"].includes(String(q.request_state)) ? "pending" : "refused",
          reason: `durable request state: ${q.request_state}; ${requestReason}` } : null,
      });
      const result = await reconcileLifecycleFeedback(snapshot, owner.id, github, store);
      if (result.status === "failed") {
        // Validation failures can occur before the component has entered its store.
        const key = lifecycleFeedbackKey(snapshot);
        const delivery = await store.load(key) ?? { revision: snapshot.revision, commentId: null, deliveredDigest: null, createPending: false, error: null };
        await store.save(key, { ...delivery, error: result.error });
      }
      results.push({ runId: String(r.run_id), ...result });
    } catch {
      const key = lifecycleFeedbackKey({ runId: String(r.run_id), endpoint: { repository: String(r.repository), issueNumber: Number(r.issue_number) } });
      const delivery = await store.load(key) ?? { revision: 0, commentId: null, deliveredDigest: null, createPending: false, error: null };
      await store.save(key, { ...delivery, error: "github_unavailable" });
      results.push({ runId: String(r.run_id), status: "failed", commentId: delivery.commentId, error: "github_unavailable" });
    }
  }
  return results;
}

/** Called only from the controller's applied cycle, after authoritative writes. */
export async function deliverControllerTicketFeedback(database: DatabaseSync, home: string): Promise<boolean> {
  try {
    await withFeedbackLock(home, async () => {
      const registry = parse(await readFile(resolve(home, "config/projects.yaml"), "utf8")) as { projects: Record<string, Project> };
      const token = await loadOwnerGitHubTokenFromFile(home);
      const request: GitHubRequest = (method, endpoint, body) => {
        try {
          return JSON.parse(execFileSync("gh", ["api", "--method", method, endpoint,
            ...(body === undefined ? [] : ["--input", "-"])], {
            encoding: "utf8", input: body === undefined ? undefined : JSON.stringify({ body }),
            env: { ...process.env, GH_TOKEN: token }, stdio: ["pipe", "pipe", "pipe"], timeout: 30_000,
          }));
        } catch { throw new LifecycleGitHubError("github_unavailable"); }
      };
      const results = await reconcileCommittedTicketFeedback(database, registry.projects,
        githubFeedbackAdapter(request), request, feedbackStore(database));
      for (const result of results) {
        // Rejected/historical runs may not yet have a notifier card. Seed only
        // missing failure cards; normal progress owns their truthful state/digest.
        if (result.status === "failed") database.prepare(`INSERT OR IGNORE INTO run_progress_cards(run_id,stage,detail,content_digest)
          VALUES(?,'ticket_feedback_pending','Ticket feedback delivery pending','ticket_feedback_pending')`).run(result.runId);
        if (result.status === "failed") process.stderr.write(`${JSON.stringify({ level: "warn", event: "ticket_feedback_pending", ...result })}\n`);
      }
    });
    return true;
  } catch {
    for (const r of database.prepare(eligibleFeedbackRuns).all()) {
      const key = lifecycleFeedbackKey({ runId: String(r.run_id), endpoint: {
        repository: String(r.repository), issueNumber: Number(r.issue_number),
      } });
      recordFeedbackError(database, key, "github_unavailable");
      database.prepare(`INSERT OR IGNORE INTO run_progress_cards(run_id,stage,detail,content_digest)
        VALUES(?,'ticket_feedback_pending','Ticket feedback delivery pending','ticket_feedback_pending')`).run(r.run_id!);
    }
    // Use the same semantic projection as ordinary cycles: repeated batch
    // failures must not append text or re-arm an already delivered notifier.
    try {
      const config = parse(await readFile(resolve(home, "config/orchestrator.yaml"), "utf8")) as OrchestratorConfig;
      reconcileProgressCards(database, config);
    } catch {
      // If even the progress configuration is unavailable, preserve existing
      // state and add the safe error once. Recovery uses the normal projection.
      for (const r of database.prepare(eligibleFeedbackRuns).all()) database.prepare(`
        UPDATE run_progress_cards SET detail=detail || '\nTicket feedback pending: github_unavailable.',
          content_digest=content_digest || ':ticket_feedback_unavailable',delivery_state='pending'
        WHERE run_id=? AND instr(detail,'Ticket feedback pending: github_unavailable.')=0`).run(r.run_id!);
    }
    process.stderr.write(`${JSON.stringify({ level: "warn", event: "ticket_feedback_pending", error: "delivery_unavailable" })}\n`);
    return false;
  }
}

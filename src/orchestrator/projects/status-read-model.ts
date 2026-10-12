import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export type ProjectStatuses = { backlog: string; active: string; review: string; done: string; deferred: string };
export type ProjectRunFacts = {
  run_state: string;
  stage?: string | null;
  ci_head_sha: string | null;
  ci_aggregate_state: string | null;
  ci_repair_state: string | null;
  ci_repair_head_sha?: string | null;
  ci_repair_result_head_sha?: string | null;
  ci_repair_request_active_count?: number;
  ai_review_state: string | null;
  ai_review_head_sha: string | null;
  ai_review_critical_count: number;
  ai_review_important_count: number;
  ai_review_suggestion_count: number;
  review_fix_state: string | null;
  review_fix_request_active_count: number;
  review_fix_active_count?:number;
  review_active_count?:number;
};
export type ProjectAttention = { code: "run_attention" | "owner_input" | "ci_unrepaired" | "review_unrepaired"; severity: "warning" | "critical" };

export function projectRunStatus(facts: ProjectRunFacts, head = facts.ci_head_sha) {
  const ciRepairQueued = (facts.ci_repair_request_active_count ?? 0) > 0 ||
    ["ci_repair_queued", "ci_repair_working", "ci_repair_waiting"].includes(facts.stage ?? "");
  const ciRepairRunning = ["running", "waiting_ci"].includes(facts.ci_repair_state ?? "");
  const ciRepairBusy = ciRepairQueued || ciRepairRunning;
  const ciRepairCurrent = ciRepairQueued || (ciRepairRunning && Boolean(head) &&
    [facts.ci_repair_head_sha, facts.ci_repair_result_head_sha].includes(head));
  const reviewFixBusy = facts.review_fix_request_active_count > 0 || (facts.review_fix_active_count??0)>0 ||
    ["running", "waiting_ci", "resolving"].includes(facts.review_fix_state ?? "") ||
    ["review_fix_queued", "review_fix_working", "review_fix_waiting", "review_fix_resolving"].includes(facts.stage ?? "");
  const reviewCurrent = Boolean(head) && facts.ai_review_head_sha === head;
  const majorFindings = reviewCurrent && facts.ai_review_state === "ready"
    ? facts.ai_review_critical_count + facts.ai_review_important_count : 0;
  const reviewFindings = majorFindings + (reviewCurrent && facts.ai_review_state === "ready" ? facts.ai_review_suggestion_count : 0);
  const attention: ProjectAttention[] = [];
  const inactive = ["completed", "cancelled", "archived", "discarded"].includes(facts.run_state) ||
    ["completed", "cancelled", "cancelled_work_preserved"].includes(facts.stage ?? "");
  if (!inactive) {
    if (["needs_attention", "failed"].includes(facts.run_state)) attention.push({code: "run_attention", severity: "critical"});
    else if (facts.run_state === "waiting_human" || facts.stage === "waiting_human") attention.push({code: "owner_input", severity: "warning"});
    if (["failed", "missing"].includes(facts.ci_aggregate_state ?? "") && !ciRepairCurrent && !reviewFixBusy) attention.push({code: "ci_unrepaired", severity: "warning"});
    if (majorFindings > 0 && !reviewFixBusy) attention.push({code: "review_unrepaired", severity: "warning"});
  }
  return { ciRepairBusy, ciRepairCurrent, reviewFixBusy, reviewCurrent, majorFindings, reviewFindings, attention,
    ciFailed: !inactive && ["failed", "missing"].includes(facts.ci_aggregate_state ?? ""),
    working: !inactive && ["starting", "running", "handoff_pending", "remote_owned"].includes(facts.run_state) };
}

// Both queries must join runs as r and run_ci_snapshots as ci.
export const PROJECT_RUN_FACTS_SQL = `
  (SELECT COUNT(*) FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id) AS ci_repair_attempt_count,
  (SELECT attempt_state FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id ORDER BY a.attempt_number DESC LIMIT 1) AS ci_repair_state,
  (SELECT source_head_sha FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id ORDER BY a.attempt_number DESC LIMIT 1) AS ci_repair_head_sha,
  (SELECT result_head_sha FROM run_ci_repair_attempts a WHERE a.run_id=r.run_id ORDER BY a.attempt_number DESC LIMIT 1) AS ci_repair_result_head_sha,
  (SELECT COUNT(*) FROM run_control_requests q WHERE q.run_id=r.run_id AND q.action='ci_repair' AND q.request_state IN ('pending','processing')) AS ci_repair_request_active_count,
  (SELECT review_state FROM run_ai_reviews ar WHERE ar.run_id=r.run_id AND ar.review_profile='general' ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_state,
  (SELECT head_sha FROM run_ai_reviews ar WHERE ar.run_id=r.run_id AND ar.review_profile='general' ORDER BY ar.review_number DESC LIMIT 1) AS ai_review_head_sha,
  COALESCE((SELECT critical_count FROM run_ai_reviews ar WHERE ar.run_id=r.run_id AND ar.review_profile='general' ORDER BY ar.review_number DESC LIMIT 1),0) AS ai_review_critical_count,
  COALESCE((SELECT important_count FROM run_ai_reviews ar WHERE ar.run_id=r.run_id AND ar.review_profile='general' ORDER BY ar.review_number DESC LIMIT 1),0) AS ai_review_important_count,
  COALESCE((SELECT suggestion_count FROM run_ai_reviews ar WHERE ar.run_id=r.run_id AND ar.review_profile='general' ORDER BY ar.review_number DESC LIMIT 1),0) AS ai_review_suggestion_count,
  (SELECT COUNT(*) FROM run_ai_reviews a WHERE a.run_id=r.run_id AND a.review_state='running') AS review_active_count,
  (SELECT COUNT(*) FROM run_review_fix_rounds f WHERE f.run_id=r.run_id AND f.round_state IN ('running','waiting_ci','resolving')) AS review_fix_active_count,
  (SELECT round_state FROM run_review_fix_rounds rf WHERE rf.run_id=r.run_id AND rf.review_profile='general' ORDER BY rf.round_number DESC LIMIT 1) AS review_fix_state,
  (SELECT COUNT(*) FROM run_control_requests q WHERE q.run_id=r.run_id AND q.action='review_fix' AND q.request_state IN ('pending','processing')) AS review_fix_request_active_count`;

export type CurrentProjectRun = ProjectRunFacts & {run_id: string; project: string; issue_number: number; repository: string; pull_request_url: string | null; item_status: string};
export type ProjectStatusReadModel = {
  available: boolean;
  runs: CurrentProjectRun[];
  projects: Record<string, {
    board: Record<keyof ProjectStatuses, number>;
    runs: {working: number; attention: number; ciFailed: number};
    poll: {capturedAt: string | null; state: "fresh" | "stale" | "unavailable"};
  }>;
};

export function readProjectStatus(databasePath: string, registry: Record<string, {statuses: ProjectStatuses}>, now: Date): ProjectStatusReadModel {
  const unavailable: ProjectStatusReadModel = {available: false, runs: [], projects: {}};
  if (!existsSync(databasePath)) return unavailable;
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, {readOnly: true, timeout: 1_000});
    database.exec("BEGIN");
    const counts = database.prepare("SELECT project,status,count(*) n FROM project_items WHERE present=1 GROUP BY project,status").all() as {project: string; status: string; n: number}[];
    const polls = database.prepare("SELECT project,last_captured_at,last_attempt_state FROM project_poll_state").all() as {project: string; last_captured_at: string | null; last_attempt_state: string | null}[];
    const candidates = database.prepare(`SELECT r.run_id,r.project,r.issue_number,r.repository,r.state AS run_state,
      p.status AS item_status,pc.stage,ci.head_sha AS ci_head_sha,ci.aggregate_state AS ci_aggregate_state,ci.pull_request_url,
      ${PROJECT_RUN_FACTS_SQL}
      FROM runs r JOIN project_items p ON p.project=r.project AND p.item_id=r.item_id AND p.present=1
      LEFT JOIN run_ci_snapshots ci USING(run_id) LEFT JOIN run_progress_cards pc USING(run_id)
      WHERE NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.project=r.project AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      ORDER BY r.updated_at DESC`).all() as CurrentProjectRun[];
    const runs = candidates.filter(run => {
      const statuses = registry[run.project]?.statuses;
      return statuses && run.item_status !== statuses.done && run.item_status !== statuses.deferred;
    });
    const projects: ProjectStatusReadModel["projects"] = {};
    for (const [key, {statuses}] of Object.entries(registry)) {
      const poll = polls.find(row => row.project === key);
      const capturedAt = poll?.last_captured_at ?? null;
      const capturedMs = Date.parse(capturedAt ?? "");
      const projectRuns = runs.filter(run => run.project === key).map(run => projectRunStatus(run));
      projects[key] = {
        board: Object.fromEntries(Object.entries(statuses).map(([role, name]) => [role, counts.find(row => row.project === key && row.status === name)?.n ?? 0])) as Record<keyof ProjectStatuses, number>,
        runs: {working: projectRuns.filter(run => run.working).length,
          attention: projectRuns.filter(run => run.attention.some(issue => ["run_attention", "owner_input"].includes(issue.code))).length,
          ciFailed: projectRuns.filter(run => run.ciFailed).length},
        poll: {capturedAt, state: !poll ? "unavailable" : poll.last_attempt_state === "succeeded" && Number.isFinite(capturedMs) && now.getTime() - capturedMs < 15 * 60_000 ? "fresh" : "stale"},
      };
    }
    database.exec("COMMIT");
    return {available: true, runs, projects};
  } catch {
    return unavailable;
  } finally { database?.close(); }
}

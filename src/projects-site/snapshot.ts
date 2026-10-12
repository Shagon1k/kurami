import { readReviewEvidence } from "../orchestrator/projects/reviews/read-model.ts";
import { REVIEW_PROFILES } from "../orchestrator/projects/reviews/profiles.ts";
import { reviewFixStartupFailure } from "./review-fix-failure.ts";
import { observedStatusRequest, type StatusRequestRow } from "./status-state.ts";
import { collectIdeasView } from "./ideas.ts";
import {taskStartProgress,type ActivationEvent} from "./task-start.ts";
import { parseCiChecks } from "./ci-checks.ts";
import { projectRunActions } from "./run-actions.ts";
import { inspectAiReview } from "../orchestrator/controls/ai-review.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import { PROJECT_RUN_FACTS_SQL, projectRunStatus, type ProjectRunFacts, type ProjectStatuses } from "../orchestrator/projects/status-read-model.ts";
import { PROJECTS_STALE_AFTER_MS, needsOwner, type ProjectItem, type ProjectsSnapshot } from "./model.ts";
import {hasActivePrRequest} from "../orchestrator/controls/pr-boundary.ts";

import { technicalWorkerDiagnostic, workerDiagnosticText } from "../orchestrator/integrations/codex/worker-diagnostic.ts";
import { PROJECT_ICONS, projectColor } from "../core/projects-registry.ts";

type Config = { owner: string; project_number: number; status_field?: string; repository: string; icon?: string; color?: string; statuses: ProjectStatuses; discord?: { guild_id: string; channel_id: string } };
type ItemRow = ProjectRunFacts & {
  item_id: string; project: string; issue_number: number | null; title: string | null; content_type: string | null;
  status: string | null; last_seen_at: string; url: string | null; run_id: string | null; run_updated_at: string | null;
  detail: string | null; owner_state: string | null; pull_request_url: string | null; review_url: string | null;
  trigger_event_id:string|null;rejection_reason:string|null;
  review_pending: number; review_request_failed: number | null; preview_state: string | null; preview_hostname: string | null; preview_expires_at: string | null;
  preview_reviewed_at: string | null; preview_head: string | null;
  guild_id: string | null; parent_channel_id: string | null; thread_id: string | null;
  ci_checks_json: string | null; ci_observed_at: string | null;
  review_fix_round_number: number | null;
  review_fix_startup_failure?: string | null;
};

export function projectsRegistry(path: string): Record<string, Config> {
  const value = parse(readFileSync(path, "utf8")) as { projects?: Record<string, Config> };
  if (!value?.projects || typeof value.projects !== "object") throw new Error("Invalid projects registry");
  for (const [key, config] of Object.entries(value.projects)) {
    if (!/^[a-z0-9_-]+$/.test(key) || !config || !/^[A-Za-z0-9_-]+$/.test(config.owner) ||
      !Number.isInteger(config.project_number) || config.project_number <= 0 ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository) ||
      !config.statuses || !["backlog", "active", "review", "done", "deferred"].every(role =>
        typeof config.statuses[role as keyof ProjectStatuses] === "string" && config.statuses[role as keyof ProjectStatuses].length > 0))
      throw new Error("Invalid project configuration");
  }
  return value.projects;
}

function githubUrl(raw: string | null, repository: string, kind: "issues" | "pull"): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.origin === "https://github.com" && !url.username && !url.password &&
      new RegExp(`^/${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/${kind}/[1-9][0-9]*$`).test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

function itemFromRow(row: ItemRow, config: Config, now: Date): ProjectItem {
  const run = row.run_id ? projectRunStatus(row) : null;
  const reviewStale = Boolean(row.ai_review_head_sha && row.ci_head_sha && row.ai_review_head_sha !== row.ci_head_sha);
  const reviewState = row.review_pending > 0 ? "queued" : row.review_request_failed ? "request_failed" : reviewStale ? "outdated" : row.ai_review_state === "ready" && !row.ci_head_sha ? "unverified" : row.ai_review_state ?? "none";
  const previewExpired = !Number.isFinite(Date.parse(row.preview_expires_at ?? "")) || Date.parse(row.preview_expires_at!) <= now.getTime();
  const previewState = row.preview_state === "running" && previewExpired ? "expired" : row.preview_state === "running" &&
    row.preview_head !== row.ci_head_sha ? "outdated" : row.preview_state ?? "none";
  const previewUrl = row.preview_state === "running" && !previewExpired && row.preview_hostname &&
    /^preview-[1-6]\.shagon1k\.win$/.test(row.preview_hostname) ? `https://${row.preview_hostname}/` : null;
  const discord = config.discord && row.guild_id === config.discord.guild_id && row.parent_channel_id === config.discord.channel_id &&
    /^\d+$/.test(row.guild_id ?? "") && /^\d+$/.test(row.thread_id ?? "") ? `https://discord.com/channels/${row.guild_id}/${row.thread_id}` : null;
  return {
    id: row.item_id, project: row.project, number: row.issue_number, title: row.title ?? "", kind: row.content_type ?? "Unknown",
    status: row.status, observedAt: row.last_seen_at, runUpdatedAt: row.run_updated_at, runId: row.run_id, runState: row.run_id ? row.run_state : null,
    stage: row.stage ?? null, detail: row.detail, owner: row.owner_state,
    ci: { state: row.ci_aggregate_state ?? "none", tone: row.ci_aggregate_state === "passed" ? "success" : ["failed", "missing"].includes(row.ci_aggregate_state ?? "") ? "failure" : "neutral", head: row.ci_head_sha,
      checks: parseCiChecks(row.ci_checks_json, config.repository), observedAt: row.ci_observed_at },
    reviewRequestFailed: Boolean(row.review_request_failed),
    reviewFixStartupFailure: row.review_fix_startup_failure ?? null,
    reviewFix: row.review_fix_request_active_count > 0 && !["running","waiting_ci","resolving"].includes(row.review_fix_state??"")
      ? {state:"queued",round:null} : row.review_fix_state ? {state:row.review_fix_state,round:row.review_fix_round_number} : undefined,
    review: { state: reviewState, tone: ["outdated", "superseded", "unverified"].includes(reviewState) ? "warning" : ["failed","request_failed"].includes(reviewState) ? "failure" : reviewState === "ready" ? (run?.majorFindings ? "warning" : "success") : "neutral",
      head: row.ai_review_head_sha, critical: row.ai_review_critical_count, important: row.ai_review_important_count, suggestions: row.ai_review_suggestion_count },
    preview: { state: previewState, tone: ["outdated", "expired"].includes(previewState) ? "warning" : previewState === "failed" ? "failure" : previewUrl ? "success" : "neutral",
      head: row.preview_head, expiresAt: row.preview_expires_at, reviewed: Boolean(row.preview_reviewed_at) },
    attention: run?.attention ?? [], links: { issue: githubUrl(row.url, config.repository, row.content_type === "PullRequest" ? "pull" : "issues"),
      pr: githubUrl(row.pull_request_url, config.repository, "pull"), discord,
      review: githubUrl(row.review_url, config.repository, "pull"), preview: previewUrl },
  };
}

/** Reads one SQLite snapshot; never initializes the store or contacts GitHub/Discord. */
export function collectProjectsSnapshot(options: { home?: string; now?: Date; controlsEnabled?: boolean; statusEnabled?: boolean } = {}): ProjectsSnapshot {
  const home = options.home ?? resolveKuramiHome(resolve(import.meta.dirname, "../../.."));
  const now = options.now ?? new Date();
  const unavailable: ProjectsSnapshot = { generatedAt: now.toISOString(), available: false, projects: [], items: [] };
  let database: DatabaseSync | undefined;
  try {
    const configs = projectsRegistry(resolve(home, "config/projects.yaml"));
    unavailable.projects = Object.entries(configs).map(([key, config], index) => ({ key, name: config.repository.split("/")[1]!, icon: (PROJECT_ICONS as readonly string[]).includes(config.icon ?? "") ? config.icon : "project", color: projectColor(config.color, index), repository: config.repository,
      boardUrl: `https://github.com/users/${config.owner}/projects/${config.project_number}`, statuses: config.statuses, capturedAt: null, freshness: "unavailable" }));
    database = new DatabaseSync(resolve(home, "state/orchestrator.db"), { readOnly: true, timeout: 1_000 });
    database.exec("BEGIN");
    const polls = database.prepare("SELECT project,last_captured_at,last_attempt_state FROM project_poll_state").all() as { project: string; last_captured_at: string | null; last_attempt_state: string }[];
    const rows = database.prepare(`SELECT p.project,p.item_id,p.issue_number,p.title,p.content_type,p.status,p.last_seen_at,p.url,
      r.run_id,r.state AS run_state,r.owner_state,r.updated_at AS run_updated_at,r.trigger_event_id,r.rejection_reason,pc.stage,pc.detail,
      ci.head_sha AS ci_head_sha,ci.aggregate_state AS ci_aggregate_state,ci.pull_request_url,ci.checks_json AS ci_checks_json,ci.last_observed_at AS ci_observed_at,${PROJECT_RUN_FACTS_SQL},
      (SELECT github_review_url FROM run_ai_reviews a WHERE a.run_id=r.run_id AND a.review_profile='general' ORDER BY a.review_number DESC LIMIT 1) AS review_url,
      (SELECT round_number FROM run_review_fix_rounds f WHERE f.run_id=r.run_id ORDER BY f.round_number DESC LIMIT 1) AS review_fix_round_number,
      (SELECT COUNT(*) FROM run_control_requests q WHERE q.run_id=r.run_id AND q.action='ai_review' AND q.review_profile='general' AND q.request_state IN ('pending','processing')) AS review_pending,
      (SELECT q.request_state IN ('failed','rejected') FROM run_control_requests q WHERE q.run_id=r.run_id AND q.action='ai_review' AND q.review_profile='general' ORDER BY q.rowid DESC LIMIT 1) AS review_request_failed,
      pl.state AS preview_state,ps.hostname AS preview_hostname,pl.expires_at AS preview_expires_at,pl.reviewed_at AS preview_reviewed_at,pl.verified_head_sha AS preview_head,
      ds.guild_id,ds.parent_channel_id,ds.thread_id
      FROM project_items p LEFT JOIN runs r ON r.project=p.project AND r.item_id=p.item_id
        AND NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.project=r.project AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      LEFT JOIN run_progress_cards pc ON pc.run_id=r.run_id LEFT JOIN run_ci_snapshots ci ON ci.run_id=r.run_id
      LEFT JOIN preview_leases pl ON pl.run_id=r.run_id AND pl.state<>'released'
      LEFT JOIN preview_slots ps ON ps.slot_number=pl.slot_number LEFT JOIN run_discord_surfaces ds ON ds.run_id=r.run_id
      WHERE p.present=1 ORDER BY p.project,p.issue_number,p.item_id`).all() as ItemRow[];
    const controls = new Map<string, ReturnType<typeof inspectAiReview>>();
    const runActions = new Map<string, ReturnType<typeof projectRunActions>>();
    const prControlsReady=(options.controlsEnabled??process.env.PROJECTS_CONTROLS_ENABLED==="1")&&Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_pr_requests'").get());
    if (options.controlsEnabled ?? process.env.PROJECTS_CONTROLS_ENABLED === "1") for (const row of rows) if (row.run_id && configs[row.project]) controls.set(row.run_id, inspectAiReview(database, row.run_id));
    if (options.controlsEnabled ?? process.env.PROJECTS_CONTROLS_ENABLED === "1") for (const row of rows) if (row.run_id && configs[row.project]) {
      try { runActions.set(row.run_id,projectRunActions(database,row.run_id,home,now,true)); }
      catch { runActions.set(row.run_id,{fingerprint:"",reason:"unavailable",actions:[]}); }
    }
    const statusEnabled = options.statusEnabled ?? process.env.PROJECTS_STATUS_ENABLED === "1";
    const statusReady = statusEnabled && Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_status_requests'").get());
    const statusRequests = statusReady ? database.prepare(`SELECT q.* FROM project_status_requests q WHERE NOT EXISTS(SELECT 1 FROM project_status_requests n WHERE n.project=q.project AND n.item_id=q.item_id AND n.rowid>q.rowid)`).all() as StatusRequestRow[] : [];
    const latestEvents=statusEnabled?database.prepare(`SELECT e.project,e.item_id,e.event_id,e.from_status,e.to_status,e.observed_at,e.processing_state,e.processing_note FROM project_events e WHERE NOT EXISTS(SELECT 1 FROM project_events n WHERE n.project=e.project AND n.item_id=e.item_id AND n.rowid>e.rowid)`).all() as ActivationEvent[]:[];
    const triageReady=database.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name IN ('project_triage_rankings','project_triage_state')").get() as {count:number};
    const suggestions=triageReady.count===2?database.prepare(`SELECT r.project,r.selected_item_id,r.selected_issue_number,r.suggested_since,r.ranked_at,r.explanation
      FROM project_triage_rankings r JOIN project_triage_state s ON s.project=r.project AND s.factual_hash=r.factual_hash
      WHERE r.selected_item_id IS NOT NULL`).all() as {project:string;selected_item_id:string;selected_issue_number:number;suggested_since:string;ranked_at:string;explanation:string}[]:[];
    for (const row of rows) if (row.run_id) {
      row.review_fix_startup_failure = reviewFixStartupFailure(database, row.run_id, row.ci_head_sha, row.pull_request_url);
      const diagnostic = workerDiagnosticText(technicalWorkerDiagnostic(database, row.run_id));
      if (diagnostic) row.detail = [row.detail, diagnostic].filter(Boolean).join(" · ");
    }
    const profileReviews = new Map<string, NonNullable<ProjectItem["reviews"]>>();
    for (const row of rows) if (row.run_id && configs[row.project]) {
      const reviews = {} as NonNullable<ProjectItem["reviews"]>;
      for (const profile of REVIEW_PROFILES) {
        const evidence=readReviewEvidence(database,row.run_id,profile,row.ci_head_sha);
        const state=evidence.state;
        reviews[profile] = {...evidence,
          tone:["outdated","superseded","unverified"].includes(state)?"warning":["failed","request_failed"].includes(state)?"failure":state==="ready"?evidence.critical+evidence.important>0?"warning":"success":"neutral",
          url:githubUrl(evidence.url,configs[row.project]!.repository,"pull"),requestFailed:state==="request_failed",
          fixStartupFailure:reviewFixStartupFailure(database,row.run_id,row.ci_head_sha,row.pull_request_url,profile)};
        if (options.controlsEnabled ?? process.env.PROJECTS_CONTROLS_ENABLED === "1") {
          const inspection = profile === "general" ? controls.get(row.run_id) : inspectAiReview(database,row.run_id,profile);
          if (inspection) reviews[profile].control = {enabled:inspection.eligible,reason:inspection.reason,head:inspection.head};
          reviews[profile].fixActions = profile === "general" ? runActions.get(row.run_id) : projectRunActions(database,row.run_id,home,now,true,profile);
        }
      }
      profileReviews.set(row.run_id,reviews);
    }
    database.exec("COMMIT");
    const projects = unavailable.projects.map(project => {
      const poll = polls.find(poll => poll.project === project.key);
      const ms = Date.parse(poll?.last_captured_at ?? "");
      return { ...project, capturedAt: poll?.last_captured_at ?? null, freshness: !poll ? "unavailable" as const :
        poll.last_attempt_state === "succeeded" && Number.isFinite(ms) && now.getTime() - ms >= 0 && now.getTime() - ms < PROJECTS_STALE_AFTER_MS ? "fresh" as const : "stale" as const };
    });
    const items = rows.filter(row => configs[row.project]).map(row => itemFromRow(row, configs[row.project]!, now));
    for (const item of items) {
      if (item.runId) item.reviews = profileReviews.get(item.runId);
      if (item.reviews) {
        const fresh = projects.find(project=>project.key===item.project)?.freshness === "fresh";
        for (const review of Object.values(item.reviews)) {
          if (review.control) review.control = {...review.control,enabled:review.control.enabled&&fresh,reason:fresh?review.control.reason:"stale"};
          if (review.fixActions) review.fixActions = {...review.fixActions,actions:review.fixActions.actions.map(action=>({...action,enabled:action.enabled&&fresh}))};
        }
      }
      item.prControlsEnabled=prControlsReady&&Boolean(item.runId&&item.links.pr);
      const prPending=Boolean(item.runId&&hasActivePrRequest(database,item.runId));
      if (prPending && item.reviews) for (const review of Object.values(item.reviews)) if (review.control) review.control={...review.control,enabled:false,reason:"pending"};
      const suggestion=suggestions.find(row=>row.project===item.project&&row.selected_item_id===item.id&&row.selected_issue_number===item.number);
      if(suggestion&&item.kind==="Issue"&&item.status===configs[item.project]!.statuses.backlog&&
        (!item.runId||["cancelled","archived","discarded","completed","rejected","failed"].includes(item.runState??""))&&
        projects.find(project=>project.key===item.project)?.freshness==="fresh"&&Number.isFinite(Date.parse(suggestion.ranked_at))&&Date.parse(suggestion.ranked_at)<=now.getTime())
        item.suggestedNext={since:suggestion.suggested_since,rankedAt:suggestion.ranked_at,explanation:suggestion.explanation};
      const control = item.runId ? controls.get(item.runId) : null;
      if (statusEnabled) {
        const config = configs[item.project]!;
        const fresh = projects.find(project => project.key === item.project)?.freshness === "fresh";
        const latest = statusRequests.find(request => request.project === item.project && request.item_id === item.id);
        const state = latest ? observedStatusRequest(latest,item.status,item.observedAt) : null;
        const runRow=rows.find(row=>row.project===item.project&&row.item_id===item.id)!;
        item.taskStart=taskStartProgress(item,projects.find(project=>project.key===item.project)!,latest,state,latestEvents.find(event=>event.project===item.project&&event.item_id===item.id),runRow.trigger_event_id,runRow.rejection_reason);
        const pending = ["checking","writing","awaiting_sync","uncertain"].includes(state ?? "");
        const historicalConflict=Boolean(latest&&state==="conflict"&&fresh&&Date.parse(item.observedAt)>Date.parse(latest.updated_at)&&now.getTime()-Date.parse(latest.updated_at)>=PROJECTS_STALE_AFTER_MS);
        const hints: Record<string,string> = item.kind === "Issue" ? {
          active: "Kurami обработает запуск задачи после синхронизации.",
          review: "Kurami обработает переход к проверке после синхронизации.",
          done: "Kurami проверит условия завершения, включая обязательное превью.",
          ...([config.statuses.active,config.statuses.review].includes(item.status ?? "") ? { backlog: "Текущая работа будет остановлена с сохранением результата.", deferred: "Текущая работа будет остановлена с сохранением результата." } : {}),
        } : {};
        item.statusChange = { enabled: statusReady && fresh && Boolean(config.status_field) && !pending&&!prPending,
          reason: !statusReady ? "unavailable" : !config.status_field ? "unsupported" : !fresh ? "stale" : pending ? "pending" : prPending?"pr_pending":"eligible",
          choices: Object.entries(config.statuses).map(([role,value]) => ({value,label:value,hint:hints[role] ?? ""})),
          ...(latest && state && state !== "synced" && !historicalConflict ? { request: {state,target:latest.to_status,from:latest.from_status,key:latest.client_key,checkAvailable: ["checking","writing","uncertain"].includes(state) && now.getTime()-Date.parse(latest.updated_at) >= 30_000} } : {}),
        };
      }
      if (control) {
        const fresh = projects.find(project => project.key === item.project)?.freshness === "fresh";
        item.aiReview = { enabled: control.eligible && fresh&&!prPending, reason: prPending?"pending":fresh ? control.reason : "stale", head: control.head };
      }
      const actions = item.runId ? runActions.get(item.runId) : undefined;
      if (actions) {
        const fresh = projects.find(project => project.key === item.project)?.freshness === "fresh";
        item.runActions = {...actions,reason:fresh ? actions.reason : "stale",actions:actions.actions.map(action => ({...action,enabled:action.enabled && fresh}))};
      }
    }
    items.sort((a, b) => Number(needsOwner(b, projects.find(p => p.key === b.project)!)) - Number(needsOwner(a, projects.find(p => p.key === a.project)!)));
    return { generatedAt: now.toISOString(), available: true, projects, items, ideas: collectIdeasView(home) };
  } catch { return { ...unavailable, ideas: collectIdeasView(home) }; }
  finally { database?.close(); }
}

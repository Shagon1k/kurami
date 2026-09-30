import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parse } from "yaml";
import { resolveKuramiHome } from "../core/kurami-home.ts";
import { PROJECT_RUN_FACTS_SQL, projectRunStatus, type ProjectRunFacts, type ProjectStatuses } from "../orchestrator/projects/status-read-model.ts";
import { PROJECTS_STALE_AFTER_MS, needsOwner, type ProjectItem, type ProjectsSnapshot } from "./model.ts";

type Config = { owner: string; project_number: number; repository: string; statuses: ProjectStatuses; discord?: { guild_id: string; channel_id: string } };
type ItemRow = ProjectRunFacts & {
  item_id: string; project: string; issue_number: number | null; title: string | null; content_type: string | null;
  status: string | null; last_seen_at: string; url: string | null; run_id: string | null; run_updated_at: string | null;
  detail: string | null; owner_state: string | null; pull_request_url: string | null; review_url: string | null;
  review_pending: number; preview_state: string | null; preview_hostname: string | null; preview_expires_at: string | null;
  preview_reviewed_at: string | null; preview_head: string | null;
  guild_id: string | null; parent_channel_id: string | null; thread_id: string | null;
};

function registry(path: string): Record<string, Config> {
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
  const reviewState = row.review_pending > 0 ? "queued" : reviewStale ? "outdated" : row.ai_review_state === "ready" && !row.ci_head_sha ? "unverified" : row.ai_review_state ?? "none";
  const previewExpired = !Number.isFinite(Date.parse(row.preview_expires_at ?? "")) || Date.parse(row.preview_expires_at!) <= now.getTime();
  const previewState = row.preview_state === "running" && previewExpired ? "expired" : row.preview_state === "running" &&
    row.preview_head !== row.ci_head_sha ? "outdated" : row.preview_state ?? "none";
  const previewUrl = row.preview_state === "running" && !previewExpired && row.preview_hostname &&
    /^preview-[1-6]\.shagon1k\.win$/.test(row.preview_hostname) ? `https://${row.preview_hostname}/` : null;
  const discord = config.discord && row.guild_id === config.discord.guild_id && row.parent_channel_id === config.discord.channel_id &&
    /^\d+$/.test(row.guild_id ?? "") && /^\d+$/.test(row.thread_id ?? "") ? `https://discord.com/channels/${row.guild_id}/${row.thread_id}` : null;
  return {
    id: row.item_id, project: row.project, number: row.issue_number, title: row.title ?? "Без названия", kind: row.content_type ?? "Unknown",
    status: row.status, observedAt: row.last_seen_at, runUpdatedAt: row.run_updated_at, runId: row.run_id, runState: row.run_id ? row.run_state : null,
    stage: row.stage ?? null, detail: row.detail, owner: row.owner_state,
    ci: { state: row.ci_aggregate_state ?? "none", tone: row.ci_aggregate_state === "passed" ? "success" : ["failed", "missing"].includes(row.ci_aggregate_state ?? "") ? "failure" : "neutral", head: row.ci_head_sha },
    review: { state: reviewState, tone: ["outdated", "superseded", "unverified"].includes(reviewState) ? "warning" : reviewState === "failed" ? "failure" : reviewState === "ready" ? (run?.majorFindings ? "warning" : "success") : "neutral",
      head: row.ai_review_head_sha, critical: row.ai_review_critical_count, important: row.ai_review_important_count, suggestions: row.ai_review_suggestion_count },
    preview: { state: previewState, tone: ["outdated", "expired"].includes(previewState) ? "warning" : previewState === "failed" ? "failure" : previewUrl ? "success" : "neutral",
      head: row.preview_head, expiresAt: row.preview_expires_at, reviewed: Boolean(row.preview_reviewed_at) },
    attention: run?.attention ?? [], links: { issue: githubUrl(row.url, config.repository, row.content_type === "PullRequest" ? "pull" : "issues"),
      pr: githubUrl(row.pull_request_url, config.repository, "pull"), discord,
      review: githubUrl(row.review_url, config.repository, "pull"), preview: previewUrl },
  };
}

/** Reads one SQLite snapshot; never initializes the store or contacts GitHub/Discord. */
export function collectProjectsSnapshot(options: { home?: string; now?: Date } = {}): ProjectsSnapshot {
  const home = options.home ?? resolveKuramiHome(resolve(import.meta.dirname, "../../.."));
  const now = options.now ?? new Date();
  const unavailable: ProjectsSnapshot = { generatedAt: now.toISOString(), available: false, projects: [], items: [] };
  let database: DatabaseSync | undefined;
  try {
    const configs = registry(resolve(home, "config/projects.yaml"));
    unavailable.projects = Object.entries(configs).map(([key, config]) => ({ key, name: config.repository.split("/")[1]!, repository: config.repository,
      boardUrl: `https://github.com/users/${config.owner}/projects/${config.project_number}`, statuses: config.statuses, capturedAt: null, freshness: "unavailable" }));
    database = new DatabaseSync(resolve(home, "state/orchestrator.db"), { readOnly: true, timeout: 1_000 });
    database.exec("BEGIN");
    const polls = database.prepare("SELECT project,last_captured_at,last_attempt_state FROM project_poll_state").all() as { project: string; last_captured_at: string | null; last_attempt_state: string }[];
    const rows = database.prepare(`SELECT p.project,p.item_id,p.issue_number,p.title,p.content_type,p.status,p.last_seen_at,p.url,
      r.run_id,r.state AS run_state,r.owner_state,r.updated_at AS run_updated_at,pc.stage,pc.detail,
      ci.head_sha AS ci_head_sha,ci.aggregate_state AS ci_aggregate_state,ci.pull_request_url,${PROJECT_RUN_FACTS_SQL},
      (SELECT github_review_url FROM run_ai_reviews a WHERE a.run_id=r.run_id ORDER BY a.review_number DESC LIMIT 1) AS review_url,
      (SELECT COUNT(*) FROM run_control_requests q WHERE q.run_id=r.run_id AND q.action='ai_review' AND q.request_state IN ('pending','processing')) AS review_pending,
      pl.state AS preview_state,ps.hostname AS preview_hostname,pl.expires_at AS preview_expires_at,pl.reviewed_at AS preview_reviewed_at,pl.verified_head_sha AS preview_head,
      ds.guild_id,ds.parent_channel_id,ds.thread_id
      FROM project_items p LEFT JOIN runs r ON r.project=p.project AND r.item_id=p.item_id
        AND NOT EXISTS(SELECT 1 FROM runs newer WHERE newer.project=r.project AND newer.item_id=r.item_id AND newer.rowid>r.rowid)
      LEFT JOIN run_progress_cards pc ON pc.run_id=r.run_id LEFT JOIN run_ci_snapshots ci ON ci.run_id=r.run_id
      LEFT JOIN preview_leases pl ON pl.run_id=r.run_id AND pl.state<>'released'
      LEFT JOIN preview_slots ps ON ps.slot_number=pl.slot_number LEFT JOIN run_discord_surfaces ds ON ds.run_id=r.run_id
      WHERE p.present=1 ORDER BY p.project,p.issue_number,p.item_id`).all() as ItemRow[];
    database.exec("COMMIT");
    const projects = unavailable.projects.map(project => {
      const poll = polls.find(poll => poll.project === project.key);
      const ms = Date.parse(poll?.last_captured_at ?? "");
      return { ...project, capturedAt: poll?.last_captured_at ?? null, freshness: !poll ? "unavailable" as const :
        poll.last_attempt_state === "succeeded" && Number.isFinite(ms) && now.getTime() - ms >= 0 && now.getTime() - ms < PROJECTS_STALE_AFTER_MS ? "fresh" as const : "stale" as const };
    });
    const items = rows.filter(row => configs[row.project]).map(row => itemFromRow(row, configs[row.project]!, now));
    items.sort((a, b) => Number(needsOwner(b, projects.find(p => p.key === b.project)!)) - Number(needsOwner(a, projects.find(p => p.key === a.project)!)));
    return { generatedAt: now.toISOString(), available: true, projects, items };
  } catch { return unavailable; }
  finally { database?.close(); }
}

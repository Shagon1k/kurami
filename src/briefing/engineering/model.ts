// Engineering signals for Daily: pull requests that have waited for the owner (Human Review) for more than a
// day, and on Sundays the week's completed tasks with median tokens per task. Read from the orchestrator's
// own database before publication, like the stocks cache: no network, and a failure only drops this block.
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { parse } from "yaml";
import type { BriefingAddonEnvelope, BriefingPayload } from "../model.ts";
import { readProjectStatus, type ProjectStatuses } from "../../orchestrator/projects/status-read-model.ts";
import { readProjectUsage, type UsagePeriod } from "../../orchestrator/projects/usage-read-model.ts";
import { readThreadUsage } from "../../core/codex-usage.ts";
import { projectColor } from "../../core/projects-registry.ts";
import type { ProjectColor } from "../../ui-library/tokens/index.ts";

export type WaitingPullRequest = { project: string; number: number | null; title: string; url: string; hours: number; color?: ProjectColor };
export type EngineeringData = { waiting: WaitingPullRequest[]; week: UsagePeriod | null };
export type EngineeringBrief = Omit<BriefingAddonEnvelope, "data"> & { version: 1; data: EngineeringData };

/** A pull request waiting this long for the owner is worth a line in the morning. */
export const WAITING_HOURS = 24;
const MAX_WAITING = 5;

type Registry = Record<string, { statuses: ProjectStatuses; repository?: string; color?: string }>;

/** When each item last entered the review status (from the project events the poller records), and its title. */
function reviewFacts(databasePath: string, items: { project: string; issue: number; status: string }[]): Map<string, { since: string | null; title: string }> {
  const facts = new Map<string, { since: string | null; title: string }>();
  if (!items.length) return facts;
  const database = new DatabaseSync(databasePath, { readOnly: true, timeout: 1_000 });
  try {
    const entered = database.prepare("SELECT max(observed_at) AS at FROM project_events WHERE project=? AND issue_number=? AND to_status=?");
    const titled = database.prepare("SELECT title FROM project_items WHERE project=? AND issue_number=? AND present=1 LIMIT 1");
    for (const item of items) facts.set(`${item.project}#${item.issue}`, {
      since: (entered.get(item.project, item.issue, item.status) as { at: string | null } | undefined)?.at ?? null,
      title: String((titled.get(item.project, item.issue) as { title: string | null } | undefined)?.title ?? ""),
    });
  } finally { database.close(); }
  return facts;
}

export function readEngineering(home: string, now: Date, options: { week: boolean; codexHome?: string }): EngineeringData | null {
  const databasePath = resolve(home, "state/orchestrator.db"), registryPath = resolve(home, "config/projects.yaml");
  if (!existsSync(databasePath) || !existsSync(registryPath)) return null;
  const registry = (parse(readFileSync(registryPath, "utf8")) as { projects?: Registry }).projects ?? {};
  const status = readProjectStatus(databasePath, registry, now);
  if (!status.available) return null;
  const inReview = status.runs.filter(run => run.pull_request_url && run.item_status === registry[run.project]?.statuses.review);
  const facts = reviewFacts(databasePath, inReview.map(run => ({ project: run.project, issue: run.issue_number, status: run.item_status })));
  const waiting = inReview.flatMap(run => {
    const fact = facts.get(`${run.project}#${run.issue_number}`);
    const at = Date.parse(fact?.since ?? "");
    const hours = Number.isFinite(at) ? Math.floor((now.getTime() - at) / 3_600_000) : null;
    if (hours === null || hours < WAITING_HOURS) return [];
    const number = Number(/\/pull\/(\d+)/.exec(run.pull_request_url ?? "")?.[1]) || null;
    return [{ project: registry[run.project]?.repository?.split("/")[1] ?? run.project, number, title: (fact?.title ?? "").slice(0, 120), url: run.pull_request_url!, hours,
      color: projectColor(registry[run.project]?.color, Object.keys(registry).indexOf(run.project)) }];
  }).sort((left, right) => right.hours - left.hours).slice(0, MAX_WAITING);
  let week: UsagePeriod | null = null;
  if (options.week) {
    const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? resolve(process.env.HOME ?? "/", ".codex");
    const usage = readProjectUsage(databasePath, Object.keys(registry), now, (ids, until) => readThreadUsage(codexHome, ids, until));
    week = usage.available ? usage.periods[7] : null;
  }
  return { waiting, week };
}

export function engineeringBrief(data: EngineeringData, at: string): EngineeringBrief {
  return { version: 1, state: data.waiting.length || data.week?.completed ? "ready" : "empty", capturedAt: at, data };
}

export function parseEngineeringBrief(payload: BriefingPayload): EngineeringBrief | null {
  const brief = payload.addons.engineering as unknown as EngineeringBrief | undefined;
  return brief?.version === 1 && Array.isArray(brief.data?.waiting) ? brief : null;
}

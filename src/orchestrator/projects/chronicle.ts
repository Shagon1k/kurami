// Project chronicle: what happened to the managed projects over the last days, as a short story per day —
// tasks started, sent to review, returned, finished; CI repairs; AI reviews and what they found. Read-only
// from the orchestrator database; Hub shows the week under its dashboard.
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { ProjectStatuses } from "./status-read-model.ts";

export type ChronicleKind = "started" | "review" | "returned" | "done" | "ci_repair" | "ai_review";
export type ChronicleEvent = { at: string; project: string; issue: number | null; title: string; kind: ChronicleKind; detail?: string };
export type ChronicleDay = { day: string; events: ChronicleEvent[] };

const MAX_PER_DAY = 12;

function localDay(at: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

export function readChronicle(databasePath: string, registry: Record<string, { statuses: ProjectStatuses }>, now: Date, options: { days?: number; timeZone?: string } = {}): ChronicleDay[] | null {
  if (!existsSync(databasePath)) return null;
  const days = options.days ?? 7, timeZone = options.timeZone ?? "Europe/Vilnius";
  const since = new Date(now.getTime() - days * 86_400_000).toISOString();
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true, timeout: 1_000 });
    const events: ChronicleEvent[] = [];
    const moves = database.prepare(`SELECT observed_at,project,issue_number,title,from_status,to_status FROM project_events
      WHERE observed_at>=? AND to_status IS NOT NULL AND (from_status IS NULL OR from_status<>to_status) ORDER BY observed_at`).all(since) as
      { observed_at: string; project: string; issue_number: number | null; title: string | null; from_status: string | null; to_status: string }[];
    for (const move of moves) {
      const statuses = registry[move.project]?.statuses;
      if (!statuses) continue;
      const kind: ChronicleKind | null = move.to_status === statuses.done ? "done"
        : move.to_status === statuses.review ? "review"
        : move.to_status === statuses.active ? (move.from_status === statuses.review ? "returned" : "started") : null;
      if (kind) events.push({ at: move.observed_at, project: move.project, issue: move.issue_number, title: move.title ?? "", kind });
    }
    const label = database.prepare("SELECT r.project,r.issue_number,(SELECT title FROM project_items p WHERE p.project=r.project AND p.item_id=r.item_id) AS title FROM runs r WHERE r.run_id=?");
    const ofRun = (runId: string) => label.get(runId) as { project: string; issue_number: number; title: string | null } | undefined;
    for (const repair of database.prepare("SELECT run_id,attempt_state,completed_at FROM run_ci_repair_attempts WHERE completed_at>=?").all(since) as { run_id: string; attempt_state: string; completed_at: string }[]) {
      const run = ofRun(repair.run_id);
      if (run && registry[run.project]) events.push({ at: repair.completed_at, project: run.project, issue: run.issue_number, title: run.title ?? "", kind: "ci_repair", detail: repair.attempt_state });
    }
    for (const review of database.prepare("SELECT run_id,review_state,critical_count,important_count,completed_at FROM run_ai_reviews WHERE completed_at>=?").all(since) as { run_id: string; review_state: string; critical_count: number; important_count: number; completed_at: string }[]) {
      const run = ofRun(review.run_id);
      if (run && registry[run.project]) events.push({ at: review.completed_at, project: run.project, issue: run.issue_number, title: run.title ?? "", kind: "ai_review",
        detail: review.review_state === "ready" ? String(review.critical_count + review.important_count) : review.review_state });
    }
    const byDay = new Map<string, ChronicleEvent[]>();
    for (const event of events.sort((a, b) => a.at.localeCompare(b.at))) {
      const day = localDay(event.at, timeZone), list = byDay.get(day) ?? [];
      list.push(event); byDay.set(day, list);
    }
    return [...byDay].sort(([a], [b]) => b.localeCompare(a)).map(([day, list]) => ({ day, events: list.slice(-MAX_PER_DAY) }));
  } catch { return null; } finally { database?.close(); }
}

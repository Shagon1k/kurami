import type { ProjectAttention, ProjectStatuses } from "../orchestrator/projects/status-read-model.ts";

export type Freshness = "fresh" | "stale" | "unavailable";
export type Signal = { state: string; tone: "neutral" | "success" | "warning" | "failure"; head: string | null };
export type ProjectSummary = { key: string; name: string; repository: string; boardUrl: string; statuses: ProjectStatuses; capturedAt: string | null; freshness: Freshness };
export type StatusChange = { enabled: boolean; reason: "eligible" | "stale" | "unsupported" | "unavailable" | "pending"; choices: {value: string; label: string; hint: string}[];
  request?: {state: import("./status-state.ts").StatusRequestState; target: string; from: string | null; key: string; checkAvailable: boolean}; };
export type ProjectItem = {
  id: string; project: string; number: number | null; title: string; kind: string; status: string | null;
  observedAt: string; runUpdatedAt: string | null; runId: string | null; runState: string | null;
  stage: string | null; detail: string | null; owner: string | null;
  ci: Signal; review: Signal & { critical: number; important: number; suggestions: number };
  preview: Signal & { expiresAt: string | null; reviewed: boolean };
  attention: ProjectAttention[];
  aiReview?: { enabled: boolean; reason: string; head: string | null };
  reviewRequestFailed?: boolean;
  statusChange?: StatusChange;
  runActions?: import("./run-actions.ts").RunActionView;
  links: { issue: string | null; pr: string | null; discord: string | null; review: string | null; preview: string | null };
};
export type ProjectsSnapshot = { generatedAt: string; available: boolean; projects: ProjectSummary[]; items: ProjectItem[] };
export type ViewFilters = { project: string; view: "all" | "attention" | "active" | "review"; status: string };

// Mirrors the orchestrator's two-minute admission freshness boundary.
export const PROJECTS_STALE_AFTER_MS = 120_000;
export const PROJECTS_REFRESH_MS = 30_000;

export function parseFilters(params: URLSearchParams): ViewFilters {
  const view = params.get("view");
  return { project: params.get("project") ?? "", status: params.get("status") ?? "",
    view: view === "attention" || view === "active" || view === "review" ? view : "all" };
}

export function needsOwner(item: ProjectItem, project: ProjectSummary): boolean {
  return item.attention.length > 0 || item.status === project.statuses.review &&
    !["cancelled", "archived", "discarded", "completed"].includes(item.runState ?? "");
}

export function selectItems(snapshot: ProjectsSnapshot, filters: ViewFilters): ProjectItem[] {
  return snapshot.items.filter(item => {
    const project = snapshot.projects.find(project => project.key === item.project);
    if (!project || filters.project && item.project !== filters.project || filters.status && item.status !== filters.status) return false;
    return filters.view === "all" || filters.view === "attention" && needsOwner(item, project) ||
      filters.view === "active" && item.status === project.statuses.active || filters.view === "review" && item.status === project.statuses.review;
  });
}

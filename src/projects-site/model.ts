import {stateLabel} from "./i18n.ts";
import type { ProjectAttention, ProjectStatuses } from "../orchestrator/projects/status-read-model.ts";

export type Freshness = "fresh" | "stale" | "unavailable";
export type Signal = { state: string; tone: "neutral" | "success" | "warning" | "failure"; head: string | null };
export type CiCheck = { name: string; state: "passed" | "failed" | "pending" | "missing" | "unknown"; detailsUrl: string | null };
export type ProjectSummary = { key: string; name: string; repository: string; boardUrl: string; statuses: ProjectStatuses; capturedAt: string | null; freshness: Freshness };
export type StatusChange = { enabled: boolean; reason: "eligible" | "stale" | "unsupported" | "unavailable" | "pending" | "pr_pending"; choices: {value: string; label: string; hint: string}[];
  request?: {state: import("./status-state.ts").StatusRequestState; target: string; from: string | null; key: string; checkAvailable: boolean}; };
export type ProjectItem = {
  id: string; project: string; number: number | null; title: string; kind: string; status: string | null;
  observedAt: string; runUpdatedAt: string | null; runId: string | null; runState: string | null;
  stage: string | null; detail: string | null; owner: string | null;
  ci: Signal & { checks?: CiCheck[]; observedAt?: string | null }; review: Signal & { critical: number; important: number; suggestions: number };
  preview: Signal & { expiresAt: string | null; reviewed: boolean };
  attention: ProjectAttention[];
  aiReview?: { enabled: boolean; reason: string; head: string | null };
  suggestedNext?: {since:string;rankedAt:string;explanation:string};
  reviewRequestFailed?: boolean;
  statusChange?: StatusChange;
  runActions?: import("./run-actions.ts").RunActionView;
  prControlsEnabled?:boolean;
  prActions?:import("./pr-actions.ts").PrActionView;
  links: { issue: string | null; pr: string | null; discord: string | null; review: string | null; preview: string | null };
};
export type ProjectsSnapshot = { generatedAt: string; available: boolean; projects: ProjectSummary[]; items: ProjectItem[] };
export type SortKey="task"|"status"|"kurami";
export type ViewFilters={project:string;activeOnly:boolean;attentionOnly:boolean;sort:SortKey|null;direction:"asc"|"desc"};

// Mirrors the orchestrator's two-minute admission freshness boundary.
export const PROJECTS_STALE_AFTER_MS = 120_000;
export const PROJECTS_REFRESH_MS = 30_000;

export function parseFilters(params:URLSearchParams):ViewFilters {
  const sort=params.get("sort");
  const attentionOnly=params.get("attention")==="1";
  return {project:params.get("project")??"",activeOnly:!attentionOnly&&params.get("active")==="1",attentionOnly,sort:sort==="task"||sort==="status"||sort==="kurami"?sort:null,direction:params.get("dir")==="desc"?"desc":"asc"};
}

export function needsOwner(item: ProjectItem, project: ProjectSummary): boolean {
  return item.attention.length > 0 || item.status === project.statuses.review &&
    !["cancelled", "archived", "discarded", "completed"].includes(item.runState ?? "");
}

export function projectStageLabel(item:ProjectItem,lang:import("./i18n.ts").Language="en"):string {
  return stateLabel(item.stage??item.runState??(item.runId?null:"no_agent_run"),lang);
}

export function selectItems(snapshot:ProjectsSnapshot,filters:ViewFilters,lang:import("./i18n.ts").Language="en"):ProjectItem[] {
  const items=snapshot.items.filter(item=>{
    const project=snapshot.projects.find(project=>project.key===item.project);
    if(!project||filters.project&&item.project!==filters.project)return false;
    if(filters.attentionOnly)return needsOwner(item,project);
    if(!filters.activeOnly)return true;
    if([project.statuses.backlog,project.statuses.deferred,project.statuses.done].includes(item.status??""))return false;
    return item.status===project.statuses.active||item.status===project.statuses.review||needsOwner(item,project)||item.owner==="cli"||item.owner==="remote";
  });
  if(!filters.sort)return items;
  const collator=new Intl.Collator(lang,{numeric:true,sensitivity:"base"});
  const value=(item:ProjectItem)=>filters.sort==="task"?item.title:filters.sort==="status"?item.status??"":projectStageLabel(item,lang);
  return items.sort((a,b)=>(filters.direction==="desc"?-1:1)*collator.compare(value(a),value(b))||a.project.localeCompare(b.project)||(a.number??0)-(b.number??0)||a.id.localeCompare(b.id));
}
